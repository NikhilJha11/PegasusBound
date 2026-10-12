import path from "node:path";
import { serve } from "@hono/node-server";

try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  /* rely on process env */
}

const { startEngine, closeDb, getDb } = await import("@iole/engine");
const { buildApp } = await import("./app");

const internalToken = process.env.INTERNAL_API_TOKEN ?? "";
if (internalToken.length < 16) {
  console.error("INTERNAL_API_TOKEN (shared with the Pegasusbound backend) must be set to at least 16 characters.");
  process.exit(1);
}

await getDb(); // migrate before serving
const { env } = await import("@iole/engine");
if (env().LLM_MODE === "anthropic" && !env().ANTHROPIC_API_KEY) {
  console.warn("[intel] ANTHROPIC_API_KEY is not set: AI campaigns can't be planned until it is. Set it, or INTEL_LLM_MODE=mock for a demo.");
}
const engine = await startEngine({ concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4) });
const port = Number(process.env.PORT ?? 8097);
const server = serve({ fetch: buildApp({ internalToken }).fetch, port, hostname: process.env.HOST ?? "0.0.0.0" }, (info) =>
  console.log(`[intel] listening on :${info.port}`),
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    console.log(`[intel] ${sig}: draining`);
    server.close();
    await engine.stop();
    await closeDb();
    process.exit(0);
  });
}
