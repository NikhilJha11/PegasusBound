import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  addHumanMemory,
  approveCampaign,
  approveExperiment,
  checkConnection,
  createCampaign,
  editDraftVariant,
  enrollContacts,
  ensureOrgKey,
  env as engineEnv,
  finishOAuth,
  getDb,
  LEAD_FILTERS,
  listCrmContacts,
  listCrmLists,
  listMemory,
  parseProspectCsv,
  pauseCampaign,
  playbookFor,
  queries,
  resumeCampaign,
  reviewReply,
  saveConnection,
  schema as s,
  setMemoryActive,
  startPlanning,
  traitPerformance,
  updateMeeting,
  DIMENSION_LABELS,
  deleteDocument,
  getContextProfile,
  getCampaignRanking,
  ingestDocument,
  KIND_LABELS,
  listDocuments,
  type LeadFilter,
} from "@iole/engine";
import { identityMiddleware, PERM, requirePerm, type Env } from "./auth";

const view = requirePerm(PERM.viewCampaigns, PERM.manageCampaigns);
const manage = requirePerm(PERM.manageCampaigns);
const launch = requirePerm(PERM.manageCampaigns | PERM.sendCampaigns);
const settings = requirePerm(PERM.manageSettings);
/** Uploads travel as base64 JSON through the backend proxy, which caps bodies at 10 MB. */
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

const BriefSchema = z.object({
  campaignType: z.string().min(1).max(200),
  objective: z.string().min(1).max(500),
  icp: z.string().min(1).max(500),
  persona: z.string().min(1).max(300),
  offer: z.string().max(500).default(""),
  style: z.string().max(200).default(""),
  context: z.string().max(4000).default(""),
  senderName: z.string().min(1).max(120),
  senderCompany: z.string().min(1).max(200),
  senderAddress: z.string().max(300).optional(),
});

const CreateCampaignSchema = z.object({
  name: z.string().max(200).optional(),
  brief: BriefSchema,
  audience: z.discriminatedUnion("source", [
    z.object({ source: z.literal("csv"), csv: z.string().min(1).max(15_000_000) }),
    z.object({ source: z.literal("crm"), listId: z.string().min(1) }),
  ]),
  limits: z
    .object({
      maxTotalProspects: z.number().int().min(10).max(100_000).default(850),
      dailySendCap: z.number().int().min(1).max(10_000).default(100),
      observationHours: z.number().int().min(1).max(24 * 30).default(72),
      followUpDelaysDays: z.array(z.number().int().min(1).max(14)).max(4).default([3, 4]),
      requireApprovalForNewCopy: z.boolean().default(false),
      timezone: z.string().max(64).regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/).optional(),
      sendStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
      sendEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("18:00"),
      sendDays: z.number().int().min(1).max(127).default(31),
    })
    .default({ maxTotalProspects: 850, dailySendCap: 100, observationHours: 72, followUpDelaysDays: [3, 4], requireApprovalForNewCopy: false, sendStart: "08:00", sendEnd: "18:00", sendDays: 31 }),
});

class NotFound extends Error {}

export function buildApp(opts: { internalToken: string }) {
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ ok: true }));

  // MCP OAuth return (public: a browser redirect from the provider, proxied by the backend).
  app.get("/oauth/callback", async (c) => {
    const dashboard = engineEnv().DASHBOARD_URL ?? "";
    const back = new URL("/app/intelligence/connections", dashboard || "http://localhost");
    const code = c.req.query("code");
    const state = c.req.query("state");
    try {
      if (!code || !state) throw new Error(c.req.query("error_description") ?? c.req.query("error") ?? "Missing code");
      const db = await getDb();
      const conn = await finishOAuth(db, state, code);
      await checkConnection(db, conn.id);
      back.searchParams.set("connected", "1");
    } catch (err) {
      back.searchParams.set("error", err instanceof Error ? err.message : String(err));
    }
    return c.redirect(dashboard ? back.toString() : back.pathname + back.search);
  });

  const api = new Hono<Env>();
  api.use("*", identityMiddleware(opts.internalToken));

  api.onError((err, c) => {
    if (err instanceof NotFound) return c.json({ error: "Not found" }, 404);
    if (err instanceof z.ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
    const message = err instanceof Error ? err.message : String(err);
    // Engine guard errors (wrong status, frozen copy...) are the caller's to fix.
    if (/not awaiting|not paused|only draft|no eligible|required|choose|invalid|frozen/i.test(message)) return c.json({ error: message }, 400);
    console.error("[intel] request failed:", err);
    return c.json({ error: "Something went wrong" }, 500);
  });

  // ---- ownership guards: every id in a URL must belong to the caller's org
  const own = {
    async campaign(orgId: string, id: string) {
      const db = await getDb();
      const [r] = await db.select().from(s.campaigns).where(and(eq(s.campaigns.id, id), eq(s.campaigns.orgId, orgId)));
      if (!r) throw new NotFound();
      return r;
    },
    async experiment(orgId: string, id: string) {
      const db = await getDb();
      const [r] = await db
        .select({ e: s.experiments })
        .from(s.experiments)
        .innerJoin(s.campaigns, eq(s.campaigns.id, s.experiments.campaignId))
        .where(and(eq(s.experiments.id, id), eq(s.campaigns.orgId, orgId)));
      if (!r) throw new NotFound();
      return r.e;
    },
    async variant(orgId: string, id: string) {
      const db = await getDb();
      const [r] = await db
        .select({ v: s.variants })
        .from(s.variants)
        .innerJoin(s.campaigns, eq(s.campaigns.id, s.variants.campaignId))
        .where(and(eq(s.variants.id, id), eq(s.campaigns.orgId, orgId)));
      if (!r) throw new NotFound();
      return r.v;
    },
    async reply(orgId: string, id: string) {
      const db = await getDb();
      const [r] = await db
        .select({ id: s.replies.id })
        .from(s.replies)
        .innerJoin(s.assignments, eq(s.assignments.id, s.replies.assignmentId))
        .innerJoin(s.campaigns, eq(s.campaigns.id, s.assignments.campaignId))
        .where(and(eq(s.replies.id, id), eq(s.campaigns.orgId, orgId)));
      if (!r) throw new NotFound();
    },
    async assignment(orgId: string, id: string) {
      const db = await getDb();
      const [r] = await db
        .select({ id: s.assignments.id })
        .from(s.assignments)
        .innerJoin(s.campaigns, eq(s.campaigns.id, s.assignments.campaignId))
        .where(and(eq(s.assignments.id, id), eq(s.campaigns.orgId, orgId)));
      if (!r) throw new NotFound();
    },
    async connection(orgId: string, id: string) {
      const db = await getDb();
      const [r] = await db.select().from(s.connections).where(and(eq(s.connections.id, id), eq(s.connections.orgId, orgId)));
      if (!r) throw new NotFound();
      return r;
    },
  };

  // ---- setup
  api.get("/setup", view, async (c) => {
    const { orgId } = c.get("identity");
    const db = await getDb();
    const [cred] = await db.select({ orgId: s.orgCredentials.orgId }).from(s.orgCredentials).where(eq(s.orgCredentials.orgId, orgId));
    const conns = await queries.getConnections(db, orgId);
    const pick = (kind: string) => conns.find((x) => x.kind === kind);
    const summary = (x: (typeof conns)[number] | undefined) =>
      x ? { id: x.id, name: x.name, url: x.url, status: x.status, statusDetail: x.statusDetail, capabilities: x.capabilities, tools: x.tools, authType: x.authType } : null;
    const docs = await db.select({ id: s.knowledgeDocuments.id }).from(s.knowledgeDocuments).where(and(eq(s.knowledgeDocuments.orgId, orgId), eq(s.knowledgeDocuments.status, "ready")));
    return c.json({ provisioned: Boolean(cred), brain: summary(pick("brain")), crm: summary(pick("crm")), documents: docs.length, llm: engineEnv().LLM_MODE });
  });

  api.post("/setup", manage, async (c) => {
    const { orgId, userId, userToken } = c.get("identity");
    if (!userToken) return c.json({ error: "Sign in again to finish setup" }, 401);
    await ensureOrgKey(await getDb(), orgId, userToken, userId);
    return c.json({ ok: true });
  });

  // ---- connections (Company Brain + CRM over MCP)
  api.post("/connections", settings, async (c) => {
    const { orgId } = c.get("identity");
    const body = z
      .object({
        kind: z.enum(["brain", "crm"]),
        name: z.string().max(100).optional(),
        url: z.string().url(),
        authType: z.enum(["none", "bearer", "oauth"]),
        token: z.string().max(4000).optional(),
      })
      .parse(await c.req.json());
    if (!/^https:\/\//.test(body.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(body.url)) return c.json({ error: "MCP servers must use https" }, 400);
    const db = await getDb();
    await db.delete(s.connections).where(and(eq(s.connections.orgId, orgId), eq(s.connections.kind, body.kind)));
    const conn = await saveConnection(db, {
      orgId,
      kind: body.kind,
      name: body.name || (body.kind === "crm" ? "CRM" : "Company Brain"),
      url: body.url,
      authType: body.authType,
      bearer: body.authType === "bearer" ? body.token : undefined,
    });
    return c.json(await checkConnection(db, conn.id));
  });

  api.post("/connections/:id/check", settings, async (c) => {
    const { orgId } = c.get("identity");
    await own.connection(orgId, c.req.param("id"));
    return c.json(await checkConnection(await getDb(), c.req.param("id")));
  });

  api.delete("/connections/:id", settings, async (c) => {
    const { orgId } = c.get("identity");
    await own.connection(orgId, c.req.param("id"));
    const db = await getDb();
    await db.delete(s.connections).where(eq(s.connections.id, c.req.param("id")));
    return c.json({ ok: true });
  });

  api.get("/crm/lists", view, async (c) => {
    const { orgId } = c.get("identity");
    try {
      return c.json({ lists: await listCrmLists(await getDb(), orgId) });
    } catch (err) {
      return c.json({ lists: [], error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- campaigns
  api.get("/campaigns", view, async (c) => {
    const { orgId } = c.get("identity");
    return c.json({ campaigns: await queries.getDashboard(await getDb(), orgId) });
  });

  api.post("/campaigns", manage, async (c) => {
    const { orgId, userId } = c.get("identity");
    const input = CreateCampaignSchema.parse(await c.req.json());
    const db = await getDb();
    const contacts =
      input.audience.source === "csv" ? parseProspectCsv(input.audience.csv).contacts : await listCrmContacts(db, orgId, input.audience.listId);
    if (contacts.length === 0) return c.json({ error: "The audience has no contacts with a valid email" }, 400);
    const max = input.limits.maxTotalProspects;
    const campaign = await createCampaign(db, {
      orgId,
      createdBy: userId,
      name: input.name || `${input.brief.persona} · ${input.brief.icp}`,
      brief: input.brief,
      senderProvider: "platform",
      limits: {
        ...input.limits,
        batchStages: [50, 100, 200, 500].filter((n) => n <= max).concat(max < 50 ? [max] : []),
      },
    });
    const enrolled = await enrollContacts(db, campaign.id, contacts, input.audience.source);
    await startPlanning(db, campaign.id);
    return c.json({ id: campaign.id, enrolled }, 201);
  });

  api.get("/campaigns/:id", view, async (c) => {
    const { orgId } = c.get("identity");
    const d = await queries.getCampaignDetail(await getDb(), orgId, c.req.param("id"));
    if (!d) throw new NotFound();
    return c.json({ ...d, counts: Object.fromEntries(d.counts) });
  });

  api.post("/campaigns/:id/approve", launch, async (c) => {
    const { orgId, userId } = c.get("identity");
    await own.campaign(orgId, c.req.param("id"));
    await approveCampaign(await getDb(), c.req.param("id"), userId);
    return c.json({ ok: true });
  });

  api.post("/campaigns/:id/pause", manage, async (c) => {
    const { orgId } = c.get("identity");
    await own.campaign(orgId, c.req.param("id"));
    await pauseCampaign(await getDb(), c.req.param("id"), "user", "Paused by you");
    return c.json({ ok: true });
  });

  api.post("/campaigns/:id/resume", launch, async (c) => {
    const { orgId } = c.get("identity");
    await own.campaign(orgId, c.req.param("id"));
    await resumeCampaign(await getDb(), c.req.param("id"));
    return c.json({ ok: true });
  });

  api.post("/experiments/:id/approve", launch, async (c) => {
    const { orgId, userId } = c.get("identity");
    await own.experiment(orgId, c.req.param("id"));
    await approveExperiment(await getDb(), c.req.param("id"), userId);
    return c.json({ ok: true });
  });

  api.patch("/variants/:id", manage, async (c) => {
    const { orgId, userId } = c.get("identity");
    await own.variant(orgId, c.req.param("id"));
    const body = z
      .object({
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(5000),
        followUps: z.array(z.object({ delayDays: z.number().int().min(1).max(14), body: z.string().min(1).max(3000) })).max(4),
      })
      .parse(await c.req.json());
    const problems = await editDraftVariant(await getDb(), c.req.param("id"), body, userId);
    return c.json({ ok: true, problems });
  });

  // ---- leads, threads, replies, meetings
  api.get("/campaigns/:id/leads", view, async (c) => {
    const { orgId } = c.get("identity");
    const filter = (LEAD_FILTERS as readonly string[]).includes(c.req.query("filter") ?? "") ? (c.req.query("filter") as LeadFilter) : "all";
    const res = await queries.getLeads(await getDb(), orgId, c.req.param("id"), filter, (c.req.query("q") ?? "").trim().slice(0, 200));
    if (!res) throw new NotFound();
    return c.json(res);
  });

  api.get("/leads/:assignmentId/thread", view, async (c) => {
    const { orgId } = c.get("identity");
    const t = await queries.getThread(await getDb(), orgId, c.req.param("assignmentId"));
    if (!t) throw new NotFound();
    return c.json(t);
  });

  api.post("/replies/:id/review", manage, async (c) => {
    const { orgId, userId } = c.get("identity");
    await own.reply(orgId, c.req.param("id"));
    const { category } = z.object({ category: z.enum(s.REPLY_CATEGORIES) }).parse(await c.req.json());
    await reviewReply(await getDb(), c.req.param("id"), category, userId);
    return c.json({ ok: true });
  });

  api.post("/leads/:assignmentId/meeting", manage, async (c) => {
    const { orgId, userId } = c.get("identity");
    await own.assignment(orgId, c.req.param("assignmentId"));
    const body = z
      .object({
        status: z.enum(["requested", "booked", "held", "no_show"]).optional(),
        qualified: z.boolean().nullable().optional(),
        notes: z.string().max(2000).optional(),
      })
      .parse(await c.req.json());
    await updateMeeting(await getDb(), c.req.param("assignmentId"), body, userId);
    return c.json({ ok: true });
  });

  // ---- email formats & memory
  api.get("/campaigns/:id/formats", view, async (c) => {
    const { orgId } = c.get("identity");
    await own.campaign(orgId, c.req.param("id"));
    const db = await getDb();
    const [here, everywhere] = await Promise.all([traitPerformance(db, { orgId, campaignId: c.req.param("id") }), traitPerformance(db, { orgId })]);
    return c.json({ dimensions: DIMENSION_LABELS, campaign: here, all: everywhere });
  });

  api.get("/campaigns/:id/ranking", view, async (c) => {
    const { orgId } = c.get("identity");
    const r = await getCampaignRanking(await getDb(), orgId, c.req.param("id"));
    return r ? c.json(r) : c.json({ error: "Not found" }, 404);
  });

  api.get("/memory", view, async (c) => {
    const { orgId } = c.get("identity");
    const db = await getDb();
    const persona = c.req.query("persona");
    const [entries, leaderboard] = await Promise.all([listMemory(db, orgId), traitPerformance(db, { orgId })]);
    return c.json({ entries, leaderboard, dimensions: DIMENSION_LABELS, preview: persona ? await playbookFor(db, orgId, persona) : null });
  });

  api.post("/memory", settings, async (c) => {
    const { orgId } = c.get("identity");
    const body = z
      .object({ kind: z.enum(["principle", "guideline", "avoid"]), text: z.string().min(3).max(1000), scope: z.string().max(200).optional() })
      .parse(await c.req.json());
    await addHumanMemory(await getDb(), orgId, body);
    return c.json({ ok: true }, 201);
  });

  api.patch("/memory/:id", settings, async (c) => {
    const { orgId } = c.get("identity");
    const { active } = z.object({ active: z.boolean() }).parse(await c.req.json());
    await setMemoryActive(await getDb(), orgId, c.req.param("id"), active);
    return c.json({ ok: true });
  });

  // ---- uploaded knowledge (ICP, product, case studies, sample emails)
  api.get("/documents", view, async (c) => {
    const { orgId } = c.get("identity");
    const db = await getDb();
    const [documents, context] = await Promise.all([listDocuments(db, orgId), getContextProfile(db, orgId)]);
    return c.json({ documents, context, kinds: KIND_LABELS, maxBytes: MAX_UPLOAD_BYTES });
  });

  api.post("/documents", manage, async (c) => {
    const { orgId, userId } = c.get("identity");
    const body = z
      .object({
        kind: z.enum(s.DOCUMENT_KINDS),
        filename: z.string().min(1).max(200),
        mimeType: z.string().max(120).default(""),
        // Either a base64 file or pasted text (e.g. email threads).
        data: z.string().max(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8).optional(),
        text: z.string().max(400_000).optional(),
      })
      .refine((b) => b.data || b.text, "Attach a file or paste some text")
      .parse(await c.req.json());
    const bytes = body.data ? new Uint8Array(Buffer.from(body.data, "base64")) : new TextEncoder().encode(body.text!);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: "File is larger than 7 MB" }, 413);
    const filename = body.data ? body.filename : body.filename.replace(/\.(txt|md)$/i, "") + ".txt";
    const doc = await ingestDocument(await getDb(), orgId, { kind: body.kind, filename, mimeType: body.data ? body.mimeType : "text/plain", data: bytes, createdBy: userId });
    return c.json({ document: doc }, doc.status === "failed" ? 422 : 201);
  });

  api.delete("/documents/:id", manage, async (c) => {
    const { orgId } = c.get("identity");
    const ok = await deleteDocument(await getDb(), orgId, c.req.param("id"));
    return ok ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404);
  });

  api.get("/learnings", view, async (c) => {
    const { orgId } = c.get("identity");
    return c.json({ learnings: await queries.getLearnings(await getDb(), orgId) });
  });

  app.route("/api", api);
  return app;
}
