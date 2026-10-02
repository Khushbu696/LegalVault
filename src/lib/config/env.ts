import { z } from "zod";

const schema = z.object({
  AI_API_KEY: z.string().min(1, "AI_API_KEY is required"),
  AI_BASE_URL: z.string().url("AI_BASE_URL must be a valid URL"),
  AI_MODEL: z.string().min(1, "AI_MODEL is required"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().min(1).default("contract_analyser"),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(4),
  MAX_PAGES: z.coerce.number().int().positive().default(150),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated lazily so `next build` doesn't need secrets; fails fast on first real use. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
