/**
 * Helpers for calling MCP tools we only know by their JSON Schema: fill
 * arguments by matching property names against synonyms, and dig records
 * out of whatever shape a server returns.
 */

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
}

export function fillArgs(
  schema: Record<string, unknown> | undefined,
  values: Record<string, unknown>,
  synonyms: Record<string, string[]>,
): { args: Record<string, unknown>; missing: string[] } {
  const s = (schema ?? {}) as JsonSchema;
  const props = s.properties ?? {};
  const args: Record<string, unknown> = {};
  for (const prop of Object.keys(props)) {
    const norm = prop.toLowerCase().replace(/[-_]/g, "");
    for (const [key, alts] of Object.entries(synonyms)) {
      if (values[key] === undefined) continue;
      if (alts.some((a) => a.toLowerCase().replace(/[-_]/g, "") === norm)) {
        const enumVals = props[prop]?.enum;
        if (enumVals && !enumVals.includes(values[key])) continue;
        args[prop] = values[key];
        break;
      }
    }
  }
  const missing = (s.required ?? []).filter((r) => args[r] === undefined);
  return { args, missing };
}

export function parseToolPayload(text: string, structured: unknown): unknown {
  if (structured !== undefined && structured !== null) return structured;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    return text;
  }
}

/** Return the largest array of objects found anywhere in the payload. */
export function findRecords(payload: unknown): Record<string, unknown>[] {
  let best: Record<string, unknown>[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      const objs = v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
      if (objs.length > best.length) best = objs;
      for (const x of v) visit(x, depth + 1);
      return;
    }
    for (const x of Object.values(v)) visit(x, depth + 1);
  };
  visit(payload, 0);
  return best;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Depth-first search for the first value under any of the given keys. */
export function pick(obj: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 6 || obj === null || typeof obj !== "object") return undefined;
  const norm = keys.map((k) => k.toLowerCase().replace(/[-_ ]/g, ""));
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (norm.includes(k.toLowerCase().replace(/[-_ ]/g, ""))) {
      const val = scalar(v);
      if (val) return val;
    }
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const found = pick(v, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function scalar(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = scalar(x);
      if (s) return s;
    }
  }
  if (v && typeof v === "object") {
    // Attio-style attribute values: { value }, { email_address }, { full_name }, { target_record_id }
    const o = v as Record<string, unknown>;
    for (const key of ["email_address", "full_name", "value", "title", "name", "record_id", "list_id", "target_record_id"]) {
      const s = scalar(o[key]);
      if (s) return s;
    }
  }
  return undefined;
}

export function findEmail(obj: unknown): string | undefined {
  const direct = pick(obj, ["email", "email_address", "email_addresses", "primary_email", "work_email"]);
  if (direct && EMAIL_RE.test(direct)) {
    EMAIL_RE.lastIndex = 0;
    return direct.match(EMAIL_RE)?.[0]?.toLowerCase();
  }
  EMAIL_RE.lastIndex = 0;
  return JSON.stringify(obj).match(EMAIL_RE)?.[0]?.toLowerCase();
}
