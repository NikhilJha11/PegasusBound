import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { auth, UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { DB } from "../db/client";
import { connections, type ConnectionKind } from "../db/schema";
import { decryptJson, encryptJson } from "../crypto";
import { env } from "../env";

type ConnectionRow = typeof connections.$inferSelect;

interface ConnectionSecret {
  bearer?: string;
  oauth?: {
    tokens?: OAuthTokens;
    clientInformation?: OAuthClientInformationMixed;
    codeVerifier?: string;
    state?: string;
    pendingAuthUrl?: string;
  };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

/** OAuth provider whose state lives (encrypted) on the connection row. */
class DbOAuthProvider implements OAuthClientProvider {
  constructor(
    private db: DB,
    private conn: ConnectionRow,
  ) {}

  private async load(): Promise<ConnectionSecret> {
    const [row] = await this.db.select().from(connections).where(eq(connections.id, this.conn.id));
    return decryptJson<ConnectionSecret>(row?.secret) ?? {};
  }

  private async patch(update: Partial<NonNullable<ConnectionSecret["oauth"]>>) {
    const secret = await this.load();
    secret.oauth = { ...secret.oauth, ...update };
    await this.db.update(connections).set({ secret: encryptJson(secret) }).where(eq(connections.id, this.conn.id));
  }

  get redirectUrl() {
    return env().OAUTH_REDIRECT_URL ?? `${env().APP_URL}/api/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Pegasusbound Intelligence",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async state() {
    const state = `${this.conn.id}.${crypto.randomBytes(12).toString("hex")}`;
    await this.patch({ state });
    return state;
  }

  async clientInformation() {
    return (await this.load()).oauth?.clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    await this.patch({ clientInformation });
  }

  async tokens() {
    return (await this.load()).oauth?.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.patch({ tokens, pendingAuthUrl: undefined });
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    // Server-side: we can't redirect a browser here, so we park the URL for
    // the UI to send the user to.
    await this.patch({ pendingAuthUrl: authorizationUrl.toString() });
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.patch({ codeVerifier });
  }

  async codeVerifier() {
    const v = (await this.load()).oauth?.codeVerifier;
    if (!v) throw new Error("Missing PKCE code verifier");
    return v;
  }
}

export class NeedsAuthError extends Error {
  constructor(public authUrl: string | undefined) {
    super("Authorization required");
  }
}

export interface McpSession {
  client: Client;
  close: () => Promise<void>;
}

export async function openSession(db: DB, conn: ConnectionRow): Promise<McpSession> {
  const secret = decryptJson<ConnectionSecret>(conn.secret) ?? {};
  const headers: Record<string, string> = {};
  if (conn.authType === "bearer" && secret.bearer) headers.Authorization = `Bearer ${secret.bearer}`;
  const authProvider = conn.authType === "oauth" ? new DbOAuthProvider(db, conn) : undefined;
  const url = new URL(conn.url);

  const tryConnect = async (useSse: boolean) => {
    const client = new Client({ name: "outbound-intelligence-engine", version: "0.1.0" });
    const transport = useSse
      ? new SSEClientTransport(url, { requestInit: { headers }, authProvider })
      : new StreamableHTTPClientTransport(url, { requestInit: { headers }, authProvider });
    await client.connect(transport);
    return { client, close: () => client.close() };
  };

  try {
    return await tryConnect(false);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      const latest = await db.select().from(connections).where(eq(connections.id, conn.id));
      throw new NeedsAuthError(decryptJson<ConnectionSecret>(latest[0]?.secret)?.oauth?.pendingAuthUrl);
    }
    // Older servers only speak HTTP+SSE.
    try {
      return await tryConnect(true);
    } catch {
      throw err;
    }
  }
}

/** Complete the OAuth code exchange after the user returns from the provider. */
export async function finishOAuth(db: DB, state: string, code: string) {
  const connId = state.split(".")[0]!;
  const [conn] = await db.select().from(connections).where(eq(connections.id, connId));
  if (!conn) throw new Error("Unknown connection");
  const saved = decryptJson<ConnectionSecret>(conn.secret)?.oauth?.state;
  if (!saved || saved !== state) throw new Error("OAuth state mismatch");
  const result = await auth(new DbOAuthProvider(db, conn), { serverUrl: conn.url, authorizationCode: code });
  if (result !== "AUTHORIZED") throw new Error("Authorization did not complete");
  return conn;
}

const WRITE_PATTERN = /(create|update|upsert|delete|remove|add|write|log|merge|send|set|post|put|patch|archive|pause|resume|qualify|assign|invite)/i;

function isReadOnly(tool: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }) {
  if (tool.annotations?.readOnlyHint === true) return true;
  if (tool.annotations?.readOnlyHint === false) return false;
  return !WRITE_PATTERN.test(tool.name);
}

export async function listTools(session: McpSession): Promise<McpTool[]> {
  const out: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await session.client.listTools(cursor ? { cursor } : undefined);
    for (const t of page.tools) {
      out.push({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        readOnly: isReadOnly(t),
      });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export interface ToolCallResult {
  text: string;
  structured?: unknown;
  isError: boolean;
}

export async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const res = await session.client.callTool({ name, arguments: args });
  const content = (res.content ?? []) as { type: string; text?: string }[];
  const text = content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  return { text, structured: res.structuredContent, isError: Boolean(res.isError) };
}

// ---------------------------------------------------------------------------
// Capability detection: map what the engine needs onto whatever tools the
// server exposes, so onboarding can explain what's missing.
// ---------------------------------------------------------------------------

const CAPABILITY_PATTERNS: Record<ConnectionKind, Record<string, RegExp[]>> = {
  brain: {
    search: [/search[-_]?brain/i, /semantic[-_]?search/i, /^search/i, /query/i, /find/i, /retrieve/i],
    read: [/read[-_]?page/i, /get[-_]?(page|doc|document|entity)/i, /^read/i, /fetch/i, /^get/i],
    list: [/list[-_]?(entities|pages|docs|documents)/i, /^list/i],
    write: [/log[-_]?feedback/i, /create[-_]?(page|doc|note|entry|record|task)/i, /write/i, /^add/i, /upsert/i],
  },
  crm: {
    listLists: [/^list[-_]?lists$/i, /list[-_]?lists/i, /lists/i],
    listEntries: [/list[-_]?records[-_]?in[-_]?list/i, /list[-_]?entries/i, /list[-_]?members/i],
    searchRecords: [/search[-_]?records/i, /search[-_]?(people|contacts|crm)/i, /^search/i],
    getRecords: [/get[-_]?records/i, /get[-_]?(person|contact)/i],
    createNote: [/create[-_]?note/i, /add[-_]?note/i, /log[-_]?(activity|note)/i],
    createTask: [/create[-_]?task/i],
    searchMeetings: [/search[-_]?meetings/i, /list[-_]?meetings/i, /search[-_]?(events|calendar)/i],
  },
};

export const REQUIRED_CAPABILITIES: Record<ConnectionKind, string[]> = {
  brain: ["search"],
  crm: ["listLists", "listEntries"],
};

export function detectCapabilities(kind: ConnectionKind, tools: McpTool[]): Record<string, string | null> {
  const caps: Record<string, string | null> = {};
  for (const [cap, patterns] of Object.entries(CAPABILITY_PATTERNS[kind])) {
    const wantWrite = cap === "write" || cap === "createNote" || cap === "createTask";
    let match: string | null = null;
    for (const p of patterns) {
      const t = tools.find((tool) => p.test(tool.name) && (wantWrite ? !tool.readOnly : tool.readOnly));
      if (t) {
        match = t.name;
        break;
      }
    }
    caps[cap] = match;
  }
  return caps;
}

/** Connect, discover tools and capabilities, and persist the result. */
export async function checkConnection(db: DB, connId: string) {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connId));
  if (!conn) throw new Error("Connection not found");
  try {
    const session = await openSession(db, conn);
    try {
      const tools = await listTools(session);
      const capabilities = detectCapabilities(conn.kind, tools);
      const missing = REQUIRED_CAPABILITIES[conn.kind].filter((c) => !capabilities[c]);
      await db
        .update(connections)
        .set({
          status: missing.length ? "error" : "connected",
          statusDetail: missing.length ? `Missing required capabilities: ${missing.join(", ")}` : `${tools.length} tools available`,
          tools: tools.map(({ name, description, readOnly }) => ({ name, description, readOnly })),
          capabilities,
          lastCheckedAt: new Date(),
        })
        .where(eq(connections.id, connId));
      return { status: missing.length ? "error" : "connected", tools, capabilities, missing } as const;
    } finally {
      await session.close();
    }
  } catch (err) {
    if (err instanceof NeedsAuthError) {
      await db
        .update(connections)
        .set({ status: "needs_auth", statusDetail: "Sign-in required", lastCheckedAt: new Date() })
        .where(eq(connections.id, connId));
      return { status: "needs_auth", authUrl: err.authUrl } as const;
    }
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(connections)
      .set({ status: "error", statusDetail: message.slice(0, 500), lastCheckedAt: new Date() })
      .where(eq(connections.id, connId));
    return { status: "error", error: message } as const;
  }
}

export async function getConnection(db: DB, orgId: string, kind: ConnectionKind): Promise<ConnectionRow | undefined> {
  const rows = await db.select().from(connections).where(and(eq(connections.orgId, orgId), eq(connections.kind, kind)));
  return rows.find((r) => r.status === "connected") ?? rows[0];
}

/** Open a session, run fn, always close. */
export async function withConnection<T>(db: DB, orgId: string, kind: ConnectionKind, fn: (s: McpSession, conn: ConnectionRow) => Promise<T>) {
  const conn = await getConnection(db, orgId, kind);
  if (!conn) throw new Error(`No ${kind} connection configured`);
  const session = await openSession(db, conn);
  try {
    return await fn(session, conn);
  } finally {
    await session.close();
  }
}

export async function saveConnection(
  db: DB,
  input: { orgId: string; kind: ConnectionKind; name: string; url: string; authType: "none" | "bearer" | "oauth"; bearer?: string },
) {
  const secret: ConnectionSecret = input.bearer ? { bearer: input.bearer } : {};
  const [row] = await db
    .insert(connections)
    .values({ orgId: input.orgId, kind: input.kind, name: input.name, url: input.url, authType: input.authType, secret: encryptJson(secret) })
    .returning();
  return row!;
}
