import fs from "node:fs";
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env } from "../env";

export type DB = NodePgDatabase<typeof schema>;

interface DbHolder {
  db?: DB;
  ready?: Promise<DB>;
  close?: () => Promise<void>;
}

// Kept on globalThis so that every module graph in the process (Next.js route
// bundles, instrumentation, worker) shares one connection — essential for the
// embedded PGlite database, which must only be opened once per directory.
const holder: DbHolder = ((globalThis as Record<string, unknown>).__ioleDb ??= {}) as DbHolder;

export function findMigrationsDir(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), "drizzle"),
    path.resolve(process.cwd(), "packages/engine/drizzle"),
    path.resolve(process.cwd(), "../../packages/engine/drizzle"),
    path.resolve(process.cwd(), "../engine/drizzle"),
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(path.join(c, "meta", "_journal.json"))) return c;
  throw new Error(`Could not find drizzle migrations. Looked in: ${candidates.join(", ")}`);
}

function resolvePglitePath(url: string): string {
  const rel = url.replace(/^pglite:\/\//, "");
  if (rel === "memory") return "memory://";
  if (path.isAbsolute(rel)) return rel;
  // Resolve relative to the repo root so web and worker agree on location.
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, "packages", "engine"))) return path.join(dir, rel);
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), rel);
}

async function open(): Promise<DB> {
  const url = env().DATABASE_URL;
  const migrationsFolder = findMigrationsDir();
  if (url.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dataDir = resolvePglitePath(url);
    if (dataDir !== "memory://") fs.mkdirSync(dataDir, { recursive: true });
    const client = new PGlite(dataDir === "memory://" ? undefined : dataDir);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    holder.close = () => client.close();
    return db as unknown as DB;
  }
  const pg = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const dbSchema = env().DATABASE_SCHEMA;
  if (dbSchema) {
    // Sharing the platform database: engine tables live in their own schema
    // (unqualified names resolve there first), platform tables such as the
    // intelligence outbox stay reachable through "public".
    const boot = new pg.default.Client({ connectionString: url });
    await boot.connect();
    await boot.query(`CREATE SCHEMA IF NOT EXISTS "${dbSchema}"`);
    await boot.end();
  }
  const pool = new pg.default.Pool({
    connectionString: url,
    max: 10,
    ...(dbSchema ? { options: `-c search_path=${dbSchema},public` } : {}),
  });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder, ...(dbSchema ? { migrationsSchema: dbSchema } : {}) });
  holder.close = () => pool.end();
  return db;
}

/** Returns the shared, migrated database handle. */
export async function getDb(): Promise<DB> {
  if (holder.db) return holder.db;
  holder.ready ??= open().then((db) => (holder.db = db));
  return holder.ready;
}

export async function closeDb() {
  await holder.close?.();
  holder.db = undefined;
  holder.ready = undefined;
  holder.close = undefined;
}
