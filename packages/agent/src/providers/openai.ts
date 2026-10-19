import { OpenAIClient } from "@anvia/openai";

/** Shared OpenAI-compatible client (cermin providers/openai.ts referensi). */
export function createOpenAIClient(opts?: {
  apiKey?: string;
  baseUrl?: string;
}) {
  const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const baseUrl = opts?.baseUrl ?? process.env.OPENAI_BASE_URL;
  return new OpenAIClient({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
}

/** Default chat model for doc-QA. */
export function defaultModel(
  modelId = process.env.CHAT_MODEL ?? "gpt-4o-mini",
) {
  return createOpenAIClient().completionModel({ modelId });
}
