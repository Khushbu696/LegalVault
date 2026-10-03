import { describe, expect, it } from "vitest";
import { locateQuoteOccurrence } from "@/lib/documents/citation";
import { compareContracts } from "@/lib/documents/comparison";
import { buildMultiDocumentExcerpt } from "@/lib/ai/multi-document-context";

describe("multi-document context recovery", () => {
  it("retrieves excerpts from canonical text when a ready document has no stored chunks", () => {
    const document = {
      id: "doc-a",
      extractedText: "Services Agreement\n\nThe Contractor shall deliver the services described in Exhibit A.\n\nThe Client shall pay each invoice within thirty (30) days of receipt.",
      pageRanges: [],
    };

    const excerpt = buildMultiDocumentExcerpt("What services and payment terms are in this contract?", document, []);

    expect(excerpt).toContain("deliver the services described in Exhibit A");
    expect(excerpt).toContain("pay each invoice within thirty (30) days");
  });
});

describe("citation mapping", () => {
  it("prefers the occurrence that matches the provided context instead of always taking the first match", () => {
    const text = [
      "Section 5. Payment Terms",
      "The Client shall pay each invoice within thirty (30) days.",
      "",
      "Section 7. Payment Terms",
      "The Client shall pay each invoice within thirty (30) days.",
    ].join("\n");

    const match = locateQuoteOccurrence(
      text,
      "The Client shall pay each invoice within thirty (30) days.",
      [
        { page: 1, start: 0, end: Math.floor(text.length / 2) },
        { page: 2, start: Math.floor(text.length / 2), end: text.length },
      ],
      { contextText: "Section 7. Payment Terms" },
    );

    expect(match).not.toBeNull();
    expect(match?.pageStart).toBe(2);
    expect(match?.matchedText).toContain("The Client shall pay each invoice within thirty (30) days.");
  });
});

describe("contract comparison", () => {
  it("summarizes a materially meaningful payment-term change at clause level", () => {
    const summary = compareContracts(
      "The Client shall pay each invoice within 30 days of receipt.",
      "The Client shall pay each invoice within 45 days of receipt.",
    );

    expect(summary.changes.length).toBeGreaterThan(0);
    expect(summary.summary.toLowerCase()).toContain("45");
    expect(summary.changes[0]?.label.toLowerCase()).toMatch(/payment|term/i);
    expect(summary.changes[0]?.significance.toLowerCase()).toMatch(/medium|high/i);
  });
});
