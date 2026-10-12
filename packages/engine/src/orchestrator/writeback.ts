import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { campaigns, learningRecords } from "../db/schema";
import { callTool, getConnection, listTools, openSession } from "../mcp/client";
import { fillArgs } from "../mcp/args";

/** Push a learning record into the Company Brain, if its MCP server accepts writes. */
export async function handleWriteback(db: DB, learningId: string) {
  const [lr] = await db.select().from(learningRecords).where(eq(learningRecords.id, learningId));
  if (!lr || lr.brainWriteStatus === "written") return;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, lr.campaignId));
  const conn = campaign ? await getConnection(db, campaign.orgId, "brain") : undefined;
  const writeTool = conn?.capabilities?.write;
  if (!conn || conn.status !== "connected" || !writeTool) {
    await db.update(learningRecords).set({ brainWriteStatus: "unsupported" }).where(eq(learningRecords.id, learningId));
    return;
  }
  const title = `Outbound learning: ${campaign?.name ?? "campaign"} — experiment ${String((lr.evidence as { experimentSeq?: number }).experimentSeq ?? "")}`;
  const content = [
    `Observation: ${lr.observation}`,
    `Scope: ${lr.scope}`,
    `Confidence: ${lr.confidence}`,
    `Limitations: ${lr.limitations}`,
    `Next action: ${lr.nextAction}`,
    `Learning ID: ${lr.id}`,
    `Evidence: ${JSON.stringify(lr.evidence)}`,
  ].join("\n");

  const session = await openSession(db, conn);
  try {
    const tool = (await listTools(session)).find((t) => t.name === writeTool);
    const { args, missing } = fillArgs(
      tool?.inputSchema,
      { title, content, type: "learning", tags: ["outbound", "experiment", lr.confidence] },
      {
        title: ["title", "name", "subject", "summary"],
        content: ["content", "body", "text", "markdown", "feedback", "description", "note", "message"],
        type: ["type", "category", "kind"],
        tags: ["tags", "labels"],
      },
    );
    if (missing.length) {
      await db.update(learningRecords).set({ brainWriteStatus: "unsupported", brainRef: `Missing args: ${missing.join(", ")}` }).where(eq(learningRecords.id, learningId));
      return;
    }
    const res = await callTool(session, writeTool, args);
    await db
      .update(learningRecords)
      .set({ brainWriteStatus: res.isError ? "failed" : "written", brainRef: res.text.slice(0, 300) })
      .where(eq(learningRecords.id, learningId));
  } finally {
    await session.close();
  }
}
