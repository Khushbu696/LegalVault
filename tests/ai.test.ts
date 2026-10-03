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
});
