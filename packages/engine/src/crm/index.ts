import type { DB } from "../db/client";
import { callTool, listTools, withConnection } from "../mcp/client";
import { fillArgs, findEmail, findRecords, parseToolPayload, pick } from "../mcp/args";

/**
 * CRM adapter over MCP. Tuned for Attio's hosted MCP server
 * (https://mcp.attio.com/mcp: list-lists, list-records-in-list, create-note,
 * create-task...) but works with any CRM server whose tools match the
 * capability patterns.
 */

export interface CrmList {
  id: string;
  name: string;
  object?: string;
}

export interface CrmContact {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  crmRecordId?: string;
}

const LIST_ID_SYNONYMS = ["list", "list_id", "listId", "list_slug", "list_api_slug", "slug", "id"];

export async function listCrmLists(db: DB, orgId: string): Promise<CrmList[]> {
  return withConnection(db, orgId, "crm", async (session, conn) => {
    const tool = conn.capabilities?.listLists;
    if (!tool) throw new Error("CRM connection has no tool for listing lists");
    const res = await callTool(session, tool, {});
    if (res.isError) throw new Error(res.text || "list lists failed");
    return findRecords(parseToolPayload(res.text, res.structured))
      .map((r) => ({
        id: pick(r, ["api_slug", "list_id", "id", "slug"]) ?? "",
        name: pick(r, ["name", "title"]) ?? "Untitled list",
        object: pick(r, ["parent_object", "object"]),
      }))
      .filter((l) => l.id);
  });
}

export async function listCrmContacts(db: DB, orgId: string, listId: string, max = 5000): Promise<CrmContact[]> {
  return withConnection(db, orgId, "crm", async (session, conn) => {
    const toolName = conn.capabilities?.listEntries;
    if (!toolName) throw new Error("CRM connection has no tool for listing list entries");
    const tool = (await listTools(session)).find((t) => t.name === toolName)!;
    const out = new Map<string, CrmContact>();
    const pageSize = 100;
    for (let offset = 0; offset < max; offset += pageSize) {
      const { args } = fillArgs(
        tool.inputSchema,
        { list: listId, limit: pageSize, offset },
        { list: LIST_ID_SYNONYMS, limit: ["limit", "page_size", "pageSize"], offset: ["offset", "skip"] },
      );
      const res = await callTool(session, toolName, args);
      if (res.isError) throw new Error(res.text || "list entries failed");
      const records = findRecords(parseToolPayload(res.text, res.structured));
      for (const r of records) {
        const email = findEmail(r);
        if (!email || out.has(email)) continue;
        const fullName = pick(r, ["full_name", "name"]);
        out.set(email, {
          email,
          firstName: pick(r, ["first_name", "firstname"]) ?? fullName?.split(" ")[0],
          lastName: pick(r, ["last_name", "lastname"]) ?? fullName?.split(" ").slice(1).join(" "),
          company: pick(r, ["company", "company_name", "organization", "account"]),
          title: pick(r, ["job_title", "title", "role"]),
          crmRecordId: pick(r, ["parent_record_id", "record_id"]),
        });
      }
      // Stop when the server ignores paging or returns a short page.
      if (records.length < pageSize || !("offset" in args)) break;
    }
    return [...out.values()];
  });
}

/** Best-effort CRM write-backs. Failures are reported, never thrown into the send path. */
export async function createCrmNote(db: DB, orgId: string, recordId: string | null, title: string, content: string) {
  return crmWrite(db, orgId, "createNote", {
    parent_object: "people",
    parent_record_id: recordId ?? undefined,
    title,
    content,
    format: "plaintext",
  });
}

export async function createCrmTask(db: DB, orgId: string, recordId: string | null, content: string) {
  const deadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  return crmWrite(db, orgId, "createTask", { content, deadline_at: deadline, linked_record_id: recordId ?? undefined });
}

async function crmWrite(db: DB, orgId: string, capability: "createNote" | "createTask", values: Record<string, unknown>) {
  try {
    return await withConnection(db, orgId, "crm", async (session, conn) => {
      const toolName = conn.capabilities?.[capability];
      if (!toolName) return { ok: false as const, reason: `CRM has no ${capability} tool` };
      const tool = (await listTools(session)).find((t) => t.name === toolName)!;
      const { args, missing } = fillArgs(tool.inputSchema, values, {
        parent_object: ["parent_object", "object", "parent_object_slug"],
        parent_record_id: ["parent_record_id", "record_id", "recordId"],
        linked_record_id: ["linked_record_id", "record_id", "linked_records"],
        title: ["title", "name", "subject"],
        content: ["content", "body", "text", "note", "description"],
        format: ["format"],
        deadline_at: ["deadline_at", "deadline", "due_at", "due_date"],
      });
      if (missing.length) return { ok: false as const, reason: `Missing required args: ${missing.join(", ")}` };
      const res = await callTool(session, toolName, args);
      return res.isError ? { ok: false as const, reason: res.text } : { ok: true as const, ref: res.text.slice(0, 200) };
    });
  } catch (err) {
    return { ok: false as const, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Look for a calendar meeting with this person in the CRM (Attio search-meetings). */
export async function findCrmMeeting(db: DB, orgId: string, email: string, since: Date): Promise<{ found: boolean; at?: string; reason?: string }> {
  try {
    return await withConnection(db, orgId, "crm", async (session, conn) => {
      const toolName = conn.capabilities?.searchMeetings;
      if (!toolName) return { found: false, reason: "CRM has no meetings search tool" };
      const tool = (await listTools(session)).find((t) => t.name === toolName)!;
      const { args } = fillArgs(
        tool.inputSchema,
        { participant: email, since: since.toISOString() },
        {
          participant: ["participant", "participants", "participant_email", "email", "attendee", "query"],
          since: ["start_after", "since", "from", "starts_after", "start_time_after"],
        },
      );
      const res = await callTool(session, toolName, args);
      if (res.isError) return { found: false, reason: res.text };
      const meetings = findRecords(parseToolPayload(res.text, res.structured)).filter((m) => JSON.stringify(m).toLowerCase().includes(email.toLowerCase()));
      if (meetings.length === 0) return { found: false };
      return { found: true, at: pick(meetings[0], ["start", "start_time", "starts_at", "start_at", "date"]) };
    });
  } catch (err) {
    return { found: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
