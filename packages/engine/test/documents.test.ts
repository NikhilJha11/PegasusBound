import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setEnvForTests } from "../src/env";
import { closeDb, getDb, type DB } from "../src/db/client";
import * as s from "../src/db/schema";
import {
  chunkText,
  deleteDocument,
  extractDocumentText,
  getContextProfile,
  ingestDocument,
  parseSampleEmails,
  retrieveChunks,
  voiceFromEmails,
} from "../src/knowledge/documents";
import { buildKnowledgeBrief } from "../src/agents/knowledge";
import { planCampaign, checkCopy } from "../src/agents/strategist";
import { composeEmail, fullTraits } from "../src/agents/mockCopy";
import { derivedTraits } from "../src/memory";
import { traitRate } from "../src/senders/mock";

let db: DB;
const ORG = "11111111-1111-1111-1111-111111111111";
const enc = (t: string) => new TextEncoder().encode(t);

beforeAll(async () => {
  setEnvForTests({ DATABASE_URL: "pglite://memory", LLM_MODE: "mock", SENDER_PROVIDER: "mock" });
  db = await getDb();
});
afterAll(() => closeDb());

const ICP = `# Ideal customer profile
Digital publishers with 1M+ monthly readers in the US and UK.
Media groups running several titles on one ad stack.

## Buyer personas
- Head of Audience: owns reader engagement and retention
- Chief Revenue Officer: owns ad yield and sponsorship revenue

## Pain points
- Readers bounce after one article, so pages per session stay flat
- Programmatic CPMs keep falling and direct sales can't fill the gap

## Do not say
- Never promise a specific revenue uplift without a cited case study
- Don't call the product a chatbot`;

const CASE = `Case study: Northwind News

Results
- Pages per session rose 38% within eight weeks
- Sponsored content revenue grew 2.1x year over year`;

const EMAILS = `Subject: reader engagement at Contoso
Hi Maya,

Saw Contoso relaunched its newsletter hub last month. Publishers we work with usually find the hardest part is getting a reader from one article to the next, not the first click.

Would it be useful if I sent over two examples of how similar titles handled it?

Best,
Nikhil
---
Subject: quick idea for your homepage
Hi Tom,

Your homepage gets a lot of traffic, but most of it seems to leave after one story. We help publishers turn that single visit into three or four with interactive formats readers actually use.

Worth a quick chat next week?

Best,
Nikhil`;

/** A minimal one-page PDF with real text, so the PDF path is exercised end to end. */
function tinyPdf(text: string) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return enc(out);
}

describe("document parsing", () => {
  it("extracts text from PDF, markdown and HTML", async () => {
    const pdf = await extractDocumentText(tinyPdf("Pegasusbound reads uploaded PDFs"), "brief.pdf", "application/pdf");
    expect(pdf.text).toContain("Pegasusbound reads uploaded PDFs");
    expect(pdf.pages).toBe(1);
    const html = await extractDocumentText(enc("<h1>Product</h1><ul><li>Fast setup</li></ul><script>x()</script>"), "p.html", "text/html");
    expect(html.text).toContain("- Fast setup");
    expect(html.text).not.toContain("x()");
  });

  it("chunks on paragraph boundaries", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"word ".repeat(40)}`).join("\n\n");
    const chunks = chunkText(text, 600);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 600)).toBe(true);
  });

  it("splits sample emails and learns the voice", () => {
    const emails = parseSampleEmails(EMAILS);
    expect(emails).toHaveLength(2);
    expect(emails[0]!.subject).toBe("reader engagement at Contoso");
    const voice = voiceFromEmails(emails)!;
    expect(voice.greeting).toBe("Hi");
    expect(voice.signoff).toBe("Best");
    expect(voice.usesQuestionsInCta).toBe(true);
    expect(voice.rules.some((r) => r.includes('"Hi {{first_name}},"'))).toBe(true);
  });
});

describe("understanding layer", () => {
  it("ingests documents, merges the context, feeds memory and the campaign brief", async () => {
    const icp = await ingestDocument(db, ORG, { kind: "icp", filename: "icp.md", mimeType: "text/markdown", data: enc(ICP) });
    expect(icp.status).toBe("ready");
    expect(icp.analysis!.personas.some((p) => p.includes("Head of Audience"))).toBe(true);
    expect(icp.analysis!.painPoints.some((p) => p.includes("pages per session"))).toBe(true);
    expect(icp.analysis!.prohibitedClaims.some((p) => p.includes("chatbot"))).toBe(true);
    await ingestDocument(db, ORG, { kind: "case_study", filename: "northwind.txt", mimeType: "text/plain", data: enc(CASE) });
    await ingestDocument(db, ORG, { kind: "email_samples", filename: "emails.txt", mimeType: "text/plain", data: enc(EMAILS) });
    const bad = await ingestDocument(db, ORG, { kind: "other", filename: "empty.txt", mimeType: "text/plain", data: enc("hi") });
    expect(bad.status).toBe("failed");

    const ctx = (await getContextProfile(db, ORG))!;
    expect(ctx.documents).toHaveLength(3);
    expect(ctx.proofPoints.some((p) => p.claim.includes("38%"))).toBe(true);
    expect(ctx.examples).toHaveLength(2);

    // Voice rules and prohibited claims become standing memory.
    const mem = await db.select().from(s.memoryEntries).where(eq(s.memoryEntries.orgId, ORG));
    expect(mem.some((m) => m.source === "document" && m.kind === "avoid" && m.text.includes("chatbot"))).toBe(true);
    expect(mem.some((m) => m.source === "document" && m.kind === "guideline")).toBe(true);

    const hits = await retrieveChunks(db, ORG, "chief revenue officer ad yield sponsorship");
    expect(hits[0]!.ref).toMatch(/^doc:/);

    const brief: s.CampaignBrief = {
      campaignType: "Pain-led",
      objective: "Book qualified meetings",
      icp: "Digital publishers",
      persona: "Head of Audience",
      offer: "Interactive engagement formats",
      style: "Short",
      context: "",
      senderName: "Nikhil",
      senderCompany: "Bridged",
    };
    const knowledge = await buildKnowledgeBrief(db, ORG, brief, []);
    expect(knowledge.painPoints.some((p) => p.includes("pages per session"))).toBe(true);
    expect(knowledge.prohibitedClaims.some((p) => p.includes("chatbot"))).toBe(true);
    expect(knowledge.styleExamples).toHaveLength(2);
    expect(knowledge.documentContext!.documents).toContain("icp.md");

    // The mock strategist writes from the documents, and its copy passes the guard.
    const plan = await planCampaign(brief, knowledge, "", [3, 4]);
    expect(plan.firstExperiment.variants).toHaveLength(3); // proof points unlock a proof arm
    for (const v of plan.firstExperiment.variants) expect(checkCopy(v, knowledge)).toEqual([]);
    expect(plan.firstExperiment.variants.map((v) => v.body).join("\n")).toMatch(/pages per session|38%/);

    // Deleting a document rebuilds the context and drops its memory.
    await deleteDocument(db, ORG, icp.id);
    const after = (await getContextProfile(db, ORG))!;
    expect(after.documents).toHaveLength(2);
    const mem2 = await db.select().from(s.memoryEntries).where(eq(s.memoryEntries.orgId, ORG));
    expect(mem2.some((m) => m.text.includes("chatbot"))).toBe(false);
  });
});

describe("mock copywriter and outcome model", () => {
  const brief = { campaignType: "", objective: "more meetings", icp: "publishers", persona: "Head of Audience", offer: "engagement formats", style: "", context: "", senderName: "N", senderCompany: "Bridged" };
  const k: s.KnowledgeBrief = {
    productSummary: "",
    approvedClaims: [],
    prohibitedClaims: [],
    painPoints: ["Readers leave after one article", "CPMs keep falling"],
    proofPoints: [{ claim: "Pages per session rose 38%", sourceRef: "doc:x#0" }],
    personaInsights: ["they are measured on retention"],
    documentContext: { icp: [], personas: [], valueProps: ["Interactive formats keep readers on site longer", "One script tag, no dev work", "Works with your existing ad stack"], objections: [], competitors: [], documents: [] },
    priorLearnings: [],
    gaps: [],
    sources: [],
  };
  it("produces the length bucket it was asked for", () => {
    for (const length of ["short", "medium", "long"] as const) {
      const e = composeEmail(brief, k, fullTraits({ length }));
      expect(derivedTraits(e.subject, e.body).length).toBe(length);
    }
  });
  it("trait model rewards proof and penalises long formal emails", () => {
    expect(traitRate({ angle: "proof", length: "short" })).toBeGreaterThan(traitRate({ angle: "offer", length: "long", tone: "formal" }));
  });
});
