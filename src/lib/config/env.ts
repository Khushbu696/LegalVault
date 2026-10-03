import { z } from "zod";

export function isValidAiModelName(value: string): boolean {
  const model = value.trim();
  if (!model) return false;
  if (/placeholder|mock|example|test|fake|luna/i.test(model)) return false;
  return /^gpt-[a-z0-9.-]+$/i.test(model);
}

/** Each group is validated lazily and independently, so a missing AI key never breaks upload/DB code. */
function lazyEnv<T extends z.ZodType>(name: string, schema: T): () => z.output<T> {
  let cached: z.output<T> | undefined;
  return () => {
    if (cached) return cached;
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid ${name} configuration:\n${problems}`);
    }
    cached = parsed.data;
    return cached;
  };
}

export const getDbEnv = lazyEnv(
  "database",
  z.object({
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    MONGODB_DB: z.string().min(1).default("contract_analyser"),
  }),
);

export const getLimitsEnv = lazyEnv(
  "limits",
  z.object({
    MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
    MAX_PAGES: z.coerce.number().int().positive().default(150),
  }),
);

export const getAiEnv = lazyEnv(
  "AI provider",
  z.object({
    AI_API_KEY: z.string().min(1, "AI_API_KEY is required"),
    AI_BASE_URL: z.url("AI_BASE_URL must be a valid URL"),
    AI_MODEL: z.string().trim().min(1, "AI_MODEL is required").refine(isValidAiModelName, {
      message: "AI_MODEL must be a real model name like gpt-4o-mini",
    }),
  }),
);
