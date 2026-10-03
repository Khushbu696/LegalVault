import { describe, expect, it } from "vitest";
import { aiModelIdSchema } from "@/lib/config/env";

describe("AI configuration", () => {
  it("accepts configurable model IDs and rejects an empty value", () => {
    expect(aiModelIdSchema.parse("gpt-6-luna")).toBe("gpt-6-luna");
    expect(aiModelIdSchema.parse("custom-model-id")).toBe("custom-model-id");
    expect(() => aiModelIdSchema.parse("  ")).toThrow("AI_MODEL is required");
  });
});
