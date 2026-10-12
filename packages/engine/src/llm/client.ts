import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "../env";

let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  if (env().LLM_MODE !== "anthropic") throw new Error("LLM_MODE is not 'anthropic'");
  if (!env().ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required when LLM_MODE=anthropic");
  client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY });
  return client;
}

export const isMockLlm = () => env().LLM_MODE === "mock";

/**
 * Server-side refusal fallback: if a safety classifier declines a request the
 * API re-runs it on a fallback model chosen by refusal category.
 */
export const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
};

export class LlmRefusalError extends Error {}

export interface StructuredCall {
  system: string;
  prompt: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

/** One request, schema-validated JSON back. */
export async function structured<S extends z.ZodType>(schema: S, call: StructuredCall): Promise<z.infer<S>> {
  const response = await anthropic().beta.messages.parse({
    model: call.model ?? env().LLM_MODEL,
    max_tokens: call.maxTokens ?? 16000,
    ...FALLBACK,
    thinking: { type: "adaptive" },
    output_config: { effort: call.effort ?? "medium", format: zodOutputFormat(schema) },
    system: call.system,
    messages: [{ role: "user", content: call.prompt }],
  });
  if (response.stop_reason === "refusal") {
    throw new LlmRefusalError(`Model declined: ${response.stop_details?.explanation ?? "no explanation"}`);
  }
  if (response.parsed_output == null) {
    throw new Error(`Structured output failed to parse (stop_reason=${response.stop_reason})`);
  }
  return response.parsed_output as z.infer<S>;
}

/** Wrap untrusted text so the model treats it as data, never as instructions. */
export function untrusted(label: string, text: string): string {
  const safe = text.replaceAll("</untrusted", "&lt;/untrusted");
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}
