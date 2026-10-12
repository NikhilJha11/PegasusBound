import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("pglite://.data/pglite"),
  LLM_MODE: z.enum(["anthropic", "mock"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  LLM_CLASSIFIER_MODEL: z.string().default("claude-opus-5-5"),
  SENDER_PROVIDER: z.string().default("mock"),
  /** "hash": each copy gets a random hidden rate. "traits": rates follow a fixed trait model, so learnings are coherent (demos). */
  MOCK_OUTCOMES: z.enum(["hash", "traits"]).default("hash"),
  MOCK_TIME_SCALE_SECONDS_PER_HOUR: z.coerce.number().positive().default(2),
  APP_URL: z.string().default("http://localhost:3000"),
  APP_SECRET: z.string().min(16).default("dev-secret-change-me-0123456789"),
  ENGINE_INPROCESS: z.string().optional(),
  /** Internal URL of the Pegasusbound backend (Go), e.g. http://backend:8080 */
  PLATFORM_API_URL: z.string().default("http://localhost:8080"),
  /** Shared secret the platform uses for internal calls (INTERNAL_API_TOKEN). */
  PLATFORM_INTERNAL_TOKEN: z.string().optional(),
  /** Postgres schema for engine tables when sharing the platform database (e.g. "intel"). */
  DATABASE_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  /** Where MCP OAuth providers send users back (the platform proxies it to us). */
  OAUTH_REDIRECT_URL: z.string().optional(),
  /** Dashboard origin, for redirects after OAuth sign-in. */
  DASHBOARD_URL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/** For tests: override env values. */
export function setEnvForTests(overrides: Partial<Env>) {
  cached = { ...env(), ...overrides };
}
