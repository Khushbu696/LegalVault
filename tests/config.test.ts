import { describe, expect, it } from "vitest";
import { isValidAiModelName } from "@/lib/config/env";

describe("AI configuration", () => {
  it("rejects placeholder model names and accepts real OpenAI models", () => {
    expect(isValidAiModelName("gpt-6-luna")).toBe(false);
    expect(isValidAiModelName("gpt-4o-mini")).toBe(true);
    expect(isValidAiModelName("gpt-4.1-mini")).toBe(true);
  });
});
