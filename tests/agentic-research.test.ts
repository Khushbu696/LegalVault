import { describe, expect, it } from "vitest";
import { MAX_AGENT_ROUNDS, runAgentToolLoop, type AgentToolCall } from "@/lib/ai/agent-loop";
import { guardPartialCoverageAnswer } from "@/lib/ai/answer-safety";
import { executeDocumentResearchTool, findNumberedSections, getCoveredResearchIndexes, getFullyCoveredChunkIndexes, selectEvidenceQuote } from "@/lib/ai/document-research-tools";
import { verifyQuoteAgainstDocument } from "@/lib/ai/verify";
import type { ChunkRecord } from "@/lib/repositories/types";

const documentId = "doc-1";
const documentText = [
  "1 Parties",
  "The parties are Acme and Example Ltd.",
  "2 Payment",
  "The Client shall pay within 30 days of invoice receipt.",
  "2.1 Late fees",
  "Late payments accrue interest at 2 percent.",
  "3 Termination",
  "Either party may terminate with 30 days written notice.",
].join("\n\n");
const chunks: ChunkRecord[] = ["1 Parties", "2 Payment", "2.1 Late fees", "3 Termination"].map((heading, chunkIndex, headings) => {
  const startOffset = documentText.indexOf(heading);
  const endOffset = headings[chunkIndex + 1]
    ? documentText.indexOf(headings[chunkIndex + 1])
    : documentText.length;
  return {
    id: `chunk-${chunkIndex + 1}`,
    documentId,
    chunkIndex,
    text: documentText.slice(startOffset, endOffset).trim(),
    startOffset,
    endOffset,
    pageStart: 1,
    pageEnd: 1,
    sectionHeading: null,
  };
});
const context = { documentId, documentText, chunks };
const invoke = (name: string, args: unknown) => executeDocumentResearchTool(name, JSON.stringify(args), context);

describe("document research tools", () => {
  it("lists real numbered sections and returns complete requested section text", () => {
    const listed = invoke("list_clauses", { documentId });
    expect(listed.sections).toEqual([
      { number: "1", title: "Parties" },
      { number: "2", title: "Payment" },
      { number: "2.1", title: "Late fees" },
      { number: "3", title: "Termination" },
    ]);
    const section = invoke("get_section", { documentId, sectionNumber: "2" });
    expect(section.text).toContain("2 Payment");
    expect(section.text).toContain("2.1 Late fees");
    expect(section.text).not.toContain("3 Termination");
  });

  it("returns chunk structure without inventing clause numbers", () => {
    const result = executeDocumentResearchTool("list_clauses", JSON.stringify({ documentId: "doc-2" }), {
      documentId: "doc-2",
      documentText: "A headingless paragraph.",
      chunks: [],
    });
    expect(result.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ number: null, title: "Text chunk 1" }),
    ]));
  });

  it("recognizes numbered clauses whose title and text share a line", () => {
    const sections = findNumberedSections("4. Notice of Termination. Tenant gives written notice.\n\n5. Deposit. The landlord holds funds.");
    expect(sections.map(({ number, title }) => ({ number, title }))).toEqual([
      { number: "4", title: "Notice of Termination" },
      { number: "5", title: "Deposit" },
    ]);
  });

  it("reuses retrieval and bounds search results", () => {
    const result = invoke("search_document", { documentId, query: "payment deadline" });
    const results = result.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].sectionNumber).toBe("2");
    expect(results[0].text).toContain("30 days");
    expect(results[0].chunkId).toBe("chunk-2");
  });

  it("retrieves a liability cap and verifies the returned source quote", () => {
    const liabilityText = "8. Limitation of Liability. The Consultant's total liability shall not exceed $20,000. Neither party is liable for indirect damages.";
    const liabilityContext = { documentId, documentText: liabilityText, chunks: [] };
    const section = executeDocumentResearchTool("get_section", JSON.stringify({ documentId, sectionNumber: "8" }), liabilityContext);
    const quote = selectEvidenceQuote("What is the liability cap?", [String(section.text)]);
    expect(section).toMatchObject({ sectionNumber: "8", sectionTitle: "Limitation of Liability" });
    expect(quote).toContain("total liability shall not exceed $20,000");
    expect(verifyQuoteAgainstDocument(liabilityText, quote ?? "").status).toBe("verified");
  });

  it("returns a structured error for a valid but nonexistent section", () => {
    const result = invoke("get_section", { documentId, sectionNumber: "99" });
    expect(result).toMatchObject({ error: true, message: "Section 99 was not found in this document." });
  });

  it("does not treat a section overlapping a larger chunk as full chunk coverage", () => {
    const documentWideChunks = [{ ...chunks[0], chunkIndex: 0, text: documentText, startOffset: 0, endOffset: documentText.length }];
    const section = executeDocumentResearchTool("get_section", JSON.stringify({ documentId, sectionNumber: "2" }), {
      ...context,
      chunks: documentWideChunks,
    });
    expect(getFullyCoveredChunkIndexes(documentWideChunks, section)).toEqual([]);
    const fullDocumentResult = { startOffset: 0, endOffset: documentText.length };
    expect(getFullyCoveredChunkIndexes(documentWideChunks, fullDocumentResult)).toEqual([0]);
  });

  it("tracks researched numbered clauses rather than a broad overlapping chunk", () => {
    const section = invoke("get_section", { documentId, sectionNumber: "2" });
    const sectionIndexes = getCoveredResearchIndexes(chunks, findNumberedSections(documentText), section);
    expect(sectionIndexes).toEqual([1, 2]);
    expect(sectionIndexes.length).toBeLessThan(findNumberedSections(documentText).length);
  });

  it("selects only question-relevant exact source sentences as citation fallback", () => {
    const quote = selectEvidenceQuote("What is the payment deadline?", [
      "The tenant must maintain insurance coverage.",
      "The Client shall pay each invoice within 30 days of receipt.",
    ]);
    expect(quote).toBe("The Client shall pay each invoice within 30 days of receipt.");
    expect(selectEvidenceQuote("What is the liability cap?", ["The tenant must maintain insurance coverage."])).toBeNull();
  });

  it.each([
    ["missing documentId", "search_document", { query: "payment" }, "documentId"],
    ["empty query", "search_document", { documentId, query: " " }, "non-empty query"],
    ["wrong query type", "search_document", { documentId, query: 8 }, "non-empty query"],
    ["invalid section number", "get_section", { documentId, sectionNumber: "../3" }, "valid numbered section"],
    ["unknown tool", "delete_document", { documentId }, "Unknown document research tool"],
    ["malformed JSON", "list_clauses", "{", "Malformed tool arguments"],
    ["wrong argument type", "list_clauses", [documentId], "JSON object"],
    ["different document", "list_clauses", { documentId: "doc-2" }, "selected for this request"],
  ])("handles %s safely", (_case, name, args, expectedMessage) => {
    const raw = typeof args === "string" ? args : JSON.stringify(args);
    const result = executeDocumentResearchTool(name, raw, context);
    expect(result).toMatchObject({ error: true });
    expect(result.message).toContain(expectedMessage);
  });
});

describe("bounded agent tool loop", () => {
  it("feeds each tool result into the next model turn until the model finishes", async () => {
    const calls: AgentToolCall[] = [
      { callId: "call-1", name: "list_clauses", arguments: "{}" },
      { callId: "call-2", name: "search_document", arguments: "{}" },
    ];
    const executed: string[] = [];
    const continued: Array<{ outputs: Array<{ callId: string; output: string }>; allowTools: boolean }> = [];
    const result = await runAgentToolLoop({
      initialResponse: 0,
      getToolCalls: (turn) => turn < calls.length ? [calls[turn]] : [],
      executeTool: async (call) => {
        executed.push(call.name);
        return `result-${call.callId}`;
      },
      continueWithToolOutputs: async (turn, outputs, allowTools) => {
        continued.push({ outputs, allowTools });
        return turn + 1;
      },
    });

    expect(result).toMatchObject({ response: 2, rounds: 2, limitReached: false });
    expect(executed).toEqual(["list_clauses", "search_document"]);
    expect(continued.map((turn) => turn.outputs[0].output)).toEqual(["result-call-1", "result-call-2"]);
    expect(continued.every((turn) => turn.allowTools)).toBe(true);
  });

  it("executes no more than the maximum number of rounds and asks for a final answer", async () => {
    let response = 0;
    let executions = 0;
    let finalizationToolChoice: boolean | undefined;
    const call: AgentToolCall = { callId: "call-1", name: "search_document", arguments: "{}" };
    const result = await runAgentToolLoop({
      initialResponse: response,
      getToolCalls: () => [call],
      executeTool: async () => {
        executions += 1;
        return "{}";
      },
      continueWithToolOutputs: async (_previous, _outputs, allowTools) => {
        finalizationToolChoice = allowTools;
        response += 1;
        return response;
      },
    });

    expect(result.rounds).toBe(MAX_AGENT_ROUNDS);
    expect(executions).toBe(MAX_AGENT_ROUNDS);
    expect(result.limitReached).toBe(true);
    expect(finalizationToolChoice).toBe(false);
  });
});

describe("partial evidence answer safety", () => {
  it("removes document-wide negative claims when coverage is partial", () => {
    expect(guardPartialCoverageAnswer(
      "The tenant may terminate with written notice. The lease does not give the landlord a right.",
      "partial",
    )).toBe("The tenant may terminate with written notice.");
  });

  it("keeps negative findings only when retrieval coverage is full", () => {
    const answer = "No separate landlord termination right appears in the searched text.";
    expect(guardPartialCoverageAnswer(answer, "full")).toBe(answer);
  });

  it("preserves supported legal limits and prohibitions under partial coverage", () => {
    const answer = "The Consultant's liability shall not exceed $20,000. The Contractor shall not disclose confidential information.";
    expect(guardPartialCoverageAnswer(answer, "partial")).toBe(answer);
  });

  it("reports insufficient evidence if partial answer contains only negative claims", () => {
    expect(guardPartialCoverageAnswer("The contract does not state a liability cap.", "partial"))
      .toContain("couldn't find sufficient evidence");
  });
});