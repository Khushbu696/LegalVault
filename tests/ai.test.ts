import { describe, expect, it } from "vitest";
import { retrieveRelevantChunks } from "@/lib/ai/retrieval";
import { verifyQuoteAgainstDocument } from "@/lib/ai/verify";
import type { ChunkRecord, PageRange } from "@/lib/repositories/types";

const makeChunk = (index: number, text: string): ChunkRecord => ({
  id: `chunk-${index}`,
  documentId: "doc-1",
  chunkIndex: index,
  text,
  startOffset: index * 100,
  endOffset: index * 100 + text.length,
  pageStart: 1,
  pageEnd: 1,
  sectionHeading: null,
});

function makeLongDocument(overrides: Record<number, string> = {}): ChunkRecord[] {
  return Array.from({ length: 150 }, (_, index) =>
    makeChunk(index, overrides[index] ?? `Standard provision ${index + 1} applies to this agreement.`),
  );
}

describe("quote verification", () => {
  it("accepts whitespace-tolerant matches and keeps the original offsets", () => {
    const text = "Party A shall pay\n the amount in full.\nThe parties agree.";
    const pageRanges: PageRange[] = [{ page: 1, start: 0, end: text.length }];
    const result = verifyQuoteAgainstDocument(text, "Party A shall pay the amount", pageRanges);
    expect(result.status).toBe("verified");
    expect(result.startOffset).toBe(0);
    expect(result.endOffset).toBeGreaterThan(0);
    expect(result.matchedText).toContain("Party A shall pay");
  });

  it("marks false or invented quotes as unverified", () => {
    const text = "The supplier will deliver goods by July 15.";
    const result = verifyQuoteAgainstDocument(text, "The supplier will deliver goods by August 15.", []);
    expect(result.status).toBe("unverified");
    expect(result.reason).toContain("not found");
  });
});

describe("retrieval", () => {
  it("does not report full coverage when the document has no indexed chunks", () => {
    const selection = retrieveRelevantChunks("Does the contract contain a termination fee?", []);
    expect(selection.coverage).toBe("partial");
    expect(selection.documentWide).toBe(true);
  });

  it("returns the most relevant chunks and reports partial coverage", () => {
    const chunks = [
      makeChunk(0, "This agreement covers payment terms and confidentiality."),
      makeChunk(1, "The vendor shall maintain insurance."),
      makeChunk(2, "Payment terms are due in 30 days."),
      makeChunk(3, "The dispute clause is in section six."),
    ];
    const selection = retrieveRelevantChunks("What are the payment terms?", chunks);
    expect(selection.coverage).toBe("partial");
    expect(selection.chunkIndexes).toContain(0);
    expect(selection.chunkIndexes).toContain(2);
  });

  it.each([
    ["What is the payment deadline in section 75?", 74, "Clause 75.02 - Payment. The Client shall pay within 26 days."],
    ["What is the unique marker in section 150?", 149, "Section 150 - Unique marker: violet lighthouse."],
    ["What is the unique marker in section 1?", 0, "Section 1 - Unique marker: copper meadow."],
    ["What is the payment deadline in section 37?", 36, "Clause 37.02 - Payment. The Client shall pay within 14 days."],
  ])("prioritizes the referenced numbered clause: %s", (question, expectedIndex, text) => {
    const chunks = makeLongDocument({ [expectedIndex]: text });
    const selection = retrieveRelevantChunks(question, chunks);
    expect(selection.chunkIndexes).toContain(expectedIndex);
    expect(selection.selected[0].chunkIndex).toBe(expectedIndex);
  });

  it("retrieves a relevant factual answer from late in a long document", () => {
    const chunks = makeLongDocument({ 127: "Retention escrow is released 43 days after final acceptance." });
    const selection = retrieveRelevantChunks("How long after final acceptance is retention escrow released?", chunks);
    expect(selection.chunkIndexes).toContain(127);
  });

  it("prefers the referenced clause heading over an earlier cross-reference", () => {
    const chunks = makeLongDocument({
      19: "The payment rules are set out in clause 75.02.",
      74: "Clause 75.02 - Payment. The Client shall pay within 26 days.",
    });
    const selection = retrieveRelevantChunks("What is the payment deadline in section 75?", chunks);
    expect(selection.selected[0].chunkIndex).toBe(74);
  });

  it("searches more chunks for document-wide existence questions and keeps coverage partial", () => {
    const chunks = makeLongDocument(Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [index * 4, `Termination fee terms apply in section ${index * 4 + 1}.`]),
    ));
    const selection = retrieveRelevantChunks("Does the contract contain a termination fee?", chunks);
    expect(selection.documentWide).toBe(true);
    expect(selection.selected.length).toBeGreaterThan(3);
    expect(selection.selected.length).toBeLessThanOrEqual(20);
    expect(selection.coverage).toBe("partial");
  });

  it("prioritizes chunks mapped to an explicit PDF page", () => {
    const chunks = makeLongDocument();
    chunks[119] = { ...chunks[119], pageStart: 120, pageEnd: 120, text: "Invoice deadline is 26 days." };
    const selection = retrieveRelevantChunks("What is the deadline on page 120?", chunks);
    expect(selection.selected[0].chunkIndex).toBe(119);
  });
});
