import OpenAI from "openai";
import type { FunctionTool, ResponseInputItem } from "openai/resources/responses/responses";
import { guardPartialCoverageAnswer } from "@/lib/ai/answer-safety";
import { runAgentToolLoop, type AgentToolCall } from "@/lib/ai/agent-loop";
import { executeDocumentResearchTool, findNumberedSections, getCoveredResearchIndexes, selectEvidenceQuote } from "@/lib/ai/document-research-tools";
import { verifyQuoteAgainstDocument } from "@/lib/ai/verify";
import { getAiEnv } from "@/lib/config/env";
import { buildDocumentChunks } from "@/lib/documents/chunks";
import { apiError, handle } from "@/lib/http";
import { getRepositories } from "@/lib/repositories";
import type { ChunkRecord, QuoteRecord } from "@/lib/repositories/types";

type P = { id: string };

type StructuredAnswer = {
  answer: string;
  quotes: string[];
};

function parseStructuredAnswer(raw: string): StructuredAnswer {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { answer: "I couldn't find support for this in the sections searched.", quotes: [] };
  }

  const quoteMarker = trimmed.indexOf("<QUOTES>");
  if (quoteMarker >= 0) {
    const answer = trimmed.slice(0, quoteMarker).trim();
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(quoteMarker + "<QUOTES>".length).trim());
      const items = Array.isArray(parsed) ? parsed : [];
      return {
        answer: answer || "I couldn't find support for this in the sections searched.",
        quotes: items
          .map((item) => typeof item?.quote === "string" ? item.quote : typeof item?.text === "string" ? item.text : "")
          .filter((quote) => quote.trim().length > 0),
      };
    } catch {
      return { answer: answer || "I couldn't find support for this in the sections searched.", quotes: [] };
    }
  }

  const candidate = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;

  try {
    const parsed = JSON.parse(candidate) as Partial<{ answer?: string; quotes?: Array<{ quote?: string; text?: string }> }>;
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : "I couldn't find support for this in the sections searched.";
    const quotes = Array.isArray(parsed.quotes)
      ? parsed.quotes
          .map((item) => (typeof item?.quote === "string" ? item.quote : typeof item?.text === "string" ? item.text : ""))
          .filter((item) => item.trim().length > 0)
      : [];
    return { answer, quotes };
  } catch {
    return { answer: trimmed, quotes: [] };
  }
}

function verifyQuotes(documentText: string, quotes: string[], pageRanges: { page: number; start: number; end: number }[]) {
  return quotes.map((quote, index) => {
    const verified = verifyQuoteAgainstDocument(documentText, quote, pageRanges);
    return { ...verified, ordinal: index };
  }) satisfies QuoteRecord[];
}

const RESEARCH_TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "list_clauses",
    description: "List the selected contract's actual numbered clauses, or its available text chunks when there are no numbered clauses.",
    strict: true,
    parameters: {
      type: "object",
      properties: { documentId: { type: "string" } },
      required: ["documentId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "search_document",
    description: "Search the selected contract for relevant, bounded excerpts. Use a focused query.",
    strict: true,
    parameters: {
      type: "object",
      properties: { documentId: { type: "string" }, query: { type: "string" } },
      required: ["documentId", "query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_section",
    description: "Read the complete text of one numbered clause, if it exists and is within the section size limit.",
    strict: true,
    parameters: {
      type: "object",
      properties: { documentId: { type: "string" }, sectionNumber: { type: "string" } },
      required: ["documentId", "sectionNumber"],
      additionalProperties: false,
    },
  },
];

const MAX_RESEARCH_EVIDENCE_CHARS = 30_000;

function researchInstructions(documentId: string, limitedCoverage: boolean): string {
  return [
    "You are researching one specific legal contract. You may use only the explicitly provided document research tools for document evidence.",
    `The selected document ID is ${documentId}. Every tool call must use exactly this ID.`,
    "Do not answer from general knowledge when the question requires contract evidence. Never invent clauses, sections, facts, or quotations.",
    "Use list_clauses first when understanding the structure would help, search_document for targeted discovery, and get_section when a complete numbered clause is needed.",
    "Do not claim information, rights, clauses, or conditions are absent from the whole document unless every document chunk was retrieved and searched. With partial coverage, avoid negative conclusions and say that the retrieved sections do not establish the point.",
    limitedCoverage ? "Search coverage is limited; do not make document-wide negative claims." : "Use only evidence returned by the document tools.",
    "For the final response, write a concise plain-English answer based only on retrieved evidence. Then write <QUOTES> on a new line followed by a JSON array of objects shaped like {\"quote\":\"exact source text\"}. Include only short verbatim quotes; never claim a quote is verified.",
  ].join("\n");
}

function activityForTool(call: AgentToolCall, documentId: string, documentText: string): string {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(call.arguments);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    return "Validating a document research request...";
  }
  if (args.documentId !== documentId) return "Rejecting a request outside the selected document...";
  if (call.name === "list_clauses") return "Reviewing document structure...";
  if (call.name === "search_document") {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 120) : "requested terms";
    return `Searching for: ${query || "requested terms"}`;
  }
  if (call.name === "get_section") {
    const number = typeof args.sectionNumber === "string" ? args.sectionNumber : "requested";
    const section = findNumberedSections(documentText).find((item) => item.number === number);
    return `Reading Section ${number}${section?.title ? ` - ${section.title}` : ""}...`;
  }
  return "Validating an unsupported document tool...";
}

function activityAfterTool(call: AgentToolCall, output: string): string {
  let result: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === "object") result = parsed as Record<string, unknown>;
  } catch {
    return "The document tool returned an invalid result.";
  }
  if (result.error === true) return `Research step not completed: ${String(result.message ?? "invalid tool request")}`;
  if (call.name === "list_clauses") {
    const sections = Array.isArray(result.sections) ? result.sections : [];
    return sections.length ? `Found ${sections.length} document structure entries.` : "No document structure entries were found.";
  }
  if (call.name === "search_document") {
    const results = Array.isArray(result.results) ? result.results : [];
    return results.length ? `Found ${results.length} relevant excerpt${results.length === 1 ? "" : "s"}.` : "No relevant excerpts were found.";
  }
  if (call.name === "get_section") return `Evidence gathered from Section ${String(result.sectionNumber ?? "requested")}.`;
  return "Document research step completed.";
}

export const GET = handle<P>(async (_req, { id }) => {
  const repos = await getRepositories();
  const doc = await repos.documents.get(id);
  if (!doc) return apiError(404, "NOT_FOUND", "This document no longer exists.");
  const chat = await repos.chats.getOrCreateForDocument(id);
  const messages = await repos.chats.listMessages(chat.id);
  return Response.json({ messages });
});

export const POST = handle<P>(async (req, { id }) => {
  const repos = await getRepositories();
  const doc = await repos.documents.get(id);
  if (!doc) return apiError(404, "NOT_FOUND", "This document no longer exists.");
  if (doc.status !== "ready" || !doc.extractedText) {
    return apiError(409, "NOT_READY", "This document hasn't finished processing.");
  }

  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return apiError(400, "INVALID_REQUEST", "Please enter a question.");

  const chat = await repos.chats.getOrCreateForDocument(id);
  const prior = await repos.chats.listMessages(chat.id);
  const storedChunks = await repos.chunks.listByDocument(id);
  const chunks: ChunkRecord[] = storedChunks.length > 0
    ? storedChunks
    : buildDocumentChunks(doc.extractedText).map((chunk, index) => ({
        ...chunk,
        id: `${id}-reconstructed-${index}`,
        documentId: id,
        sectionHeading: chunk.sectionHeading ?? null,
      }));
  const researchSections = findNumberedSections(doc.extractedText);
  const retrievalScope: { chunkIndexes: number[]; totalChunks: number; coverage: "full" | "partial" } = {
    chunkIndexes: [],
    totalChunks: researchSections.length || chunks.length,
    coverage: "partial",
  };

  await repos.chats.addMessage({
    chatId: chat.id,
    documentId: id,
    role: "user",
    content: question,
    status: "complete",
    quotes: [],
    retrievalScope: null,
  });

  const assistantMessage = await repos.chats.addMessage({
    chatId: chat.id,
    documentId: id,
    role: "assistant",
    content: "",
    status: "streaming",
    quotes: [],
    retrievalScope,
  });

  let aiEnv: ReturnType<typeof getAiEnv>;
  try {
    aiEnv = getAiEnv();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "AI provider configuration is invalid.";
    await repos.chats.updateMessage(assistantMessage.id, {
      content: "The AI service is not configured correctly for this workspace.",
      status: "error",
      quotes: [],
      retrievalScope,
    });
    return apiError(503, "AI_CONFIG", detail.replace(/^Invalid AI provider configuration:\n?/, ""), { detail });
  }

  const client = new OpenAI({ apiKey: aiEnv.AI_API_KEY, baseURL: aiEnv.AI_BASE_URL });
  const encoder = new TextEncoder();
  const bodyStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let isClosed = false;
      let visibleAnswer = "";
      const send = (event: Record<string, unknown>) => {
        if (!req.signal.aborted && !isClosed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (isClosed) return;
        isClosed = true;
        try {
          controller.close();
        } catch {
          // The client may already have canceled the stream.
        }
      };
      const indexes = new Set<number>();
      const retrievedEvidence: string[] = [];
      let evidenceChars = 0;
      let currentScope = retrievalScope;
      const updateScope = async () => {
        const chunkIndexes = [...indexes].sort((left, right) => left - right);
        currentScope = {
          chunkIndexes,
          totalChunks: researchSections.length || chunks.length,
          coverage: (researchSections.length || chunks.length) > 0 && chunkIndexes.length >= (researchSections.length || chunks.length) ? "full" : "partial",
        };
        await repos.chats.updateMessage(assistantMessage.id, { retrievalScope: currentScope });
      };

      try {
        const instructions = researchInstructions(id, true);
        let agentInput: ResponseInputItem[] = [
          ...prior.slice(-8).map((message) => ({ role: message.role, content: message.content } as ResponseInputItem)),
          { role: "user", content: question },
        ];
        const initialResponse = await client.responses.create({
          model: aiEnv.AI_MODEL,
          instructions,
          input: agentInput,
          tools: RESEARCH_TOOLS,
          tool_choice: "auto",
          parallel_tool_calls: true,
          include: ["reasoning.encrypted_content"],
          store: false,
          max_output_tokens: 1200,
        }, { signal: req.signal });

        const getToolCalls = (response: typeof initialResponse): AgentToolCall[] => response.output.flatMap((item) =>
          item.type === "function_call"
            ? [{ callId: item.call_id, name: item.name, arguments: item.arguments }]
            : [],
        );

        const agent = await runAgentToolLoop({
          initialResponse,
          getToolCalls,
          executeTool: async (call) => {
            if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");
            send({ type: "agent_activity", message: activityForTool(call, id, doc.extractedText ?? "") });
            let result = executeDocumentResearchTool(call.name, call.arguments, {
              documentId: id,
              documentText: doc.extractedText ?? "",
              chunks,
            });
            let serialized = JSON.stringify(result);
            if (result.error !== true && evidenceChars + serialized.length > MAX_RESEARCH_EVIDENCE_CHARS) {
              result = { error: true, message: "The research evidence budget is full. Answer using evidence already collected." };
              serialized = JSON.stringify(result);
            } else if (result.error !== true) {
              evidenceChars += serialized.length;
              if (typeof result.text === "string") retrievedEvidence.push(result.text);
              if (Array.isArray(result.results)) {
                for (const searchResult of result.results) {
                  if (searchResult && typeof searchResult === "object" && typeof (searchResult as Record<string, unknown>).text === "string") {
                    retrievedEvidence.push((searchResult as Record<string, string>).text);
                  }
                }
              }
              for (const researchIndex of getCoveredResearchIndexes(chunks, researchSections, result)) indexes.add(researchIndex);
              await updateScope();
            }
            send({ type: "agent_activity", message: activityAfterTool(call, serialized) });
            return serialized;
          },
          continueWithToolOutputs: async (response, outputs, allowTools) => {
            agentInput = [
              ...agentInput,
              ...(response.output as unknown as ResponseInputItem[]),
              ...outputs.map((item) => ({
                type: "function_call_output",
                call_id: item.callId,
                output: item.output,
              } as ResponseInputItem)),
            ];
            return client.responses.create({
              model: aiEnv.AI_MODEL,
              instructions,
              input: agentInput,
              tools: allowTools ? RESEARCH_TOOLS : [],
              tool_choice: allowTools ? "auto" : "none",
              parallel_tool_calls: true,
              include: ["reasoning.encrypted_content"],
              store: false,
              max_output_tokens: 1200,
            }, { signal: req.signal });
          },
        });

        if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (evidenceChars > 0) send({ type: "agent_activity", message: "Evidence gathered from the selected document." });
        else send({ type: "agent_activity", message: "No usable document evidence was gathered." });
        send({ type: "agent_activity", message: "Preparing the answer..." });

        const finalInstructions = [
          researchInstructions(id, currentScope.coverage === "partial"),
          "Research is complete. Do not call tools. Answer now using only the evidence and tool results in this conversation.",
          agent.limitReached ? "The research-round limit was reached. Give the best supported answer and clearly state any evidence limitation." : "If evidence is insufficient, say so rather than guessing.",
          currentScope.coverage === "partial" ? "Do not say a right, term, or clause does not exist or is not stated in the contract. Describe only what the retrieved sections affirmatively say and clearly limit the scope." : "The retrieved evidence covers every indexed document chunk.",
        ].join("\n");
        const finalInput: ResponseInputItem[] = [
          ...agentInput,
          ...(agent.response.output as unknown as ResponseInputItem[]),
          { role: "user", content: "Produce the final supported answer now, followed by the required <QUOTES> JSON array." },
        ];
        const finalStream = await client.responses.create({
          model: aiEnv.AI_MODEL,
          instructions: finalInstructions,
          input: finalInput,
          tools: [],
          tool_choice: "none",
          include: ["reasoning.encrypted_content"],
          store: false,
          stream: true,
          max_output_tokens: 1600,
        }, { signal: req.signal });

        let raw = "";
        for await (const event of finalStream) {
          if (req.signal.aborted) break;
          if (event.type !== "response.output_text.delta") continue;
          raw += event.delta;
        }

        if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const parsed = parseStructuredAnswer(raw);
        const answer = guardPartialCoverageAnswer(
          parsed.answer || "I couldn't find support for this in the sections searched.",
          currentScope.coverage,
        );
        for (let offset = 0; offset < answer.length; offset += 80) {
          if (req.signal.aborted) throw new DOMException("Aborted", "AbortError");
          const delta = answer.slice(offset, offset + 80);
          visibleAnswer += delta;
          send({ type: "delta", text: delta });
          await repos.chats.updateMessage(assistantMessage.id, {
            content: visibleAnswer,
            status: "streaming",
            retrievalScope: currentScope,
          });
        }
        const quoteCandidates = parsed.quotes.length > 0
          ? parsed.quotes
          : [selectEvidenceQuote(question, retrievedEvidence)].filter((quote): quote is string => quote !== null);
        const verifiedQuotes = verifyQuotes(doc.extractedText ?? "", quoteCandidates, doc.pageRanges).map((quote) => ({
          ...quote,
          reason: quote.status === "verified" ? "✓ Verified in Text" : "⚠️ Unverified: not found in text",
        }));

        await repos.chats.updateMessage(assistantMessage.id, {
          content: answer,
          status: "complete",
          quotes: verifiedQuotes,
          retrievalScope: currentScope,
        });
        send({ type: "done", answer, quotes: verifiedQuotes, retrievalScope: currentScope });
      } catch (error) {
        if (req.signal.aborted) {
          await repos.chats.updateMessage(assistantMessage.id, {
            content: visibleAnswer || "",
            status: "stopped",
            retrievalScope: currentScope,
          });
          return;
        }
        const fallback = "The AI response failed. Please try again.";
        const message = error instanceof Error ? error.message : fallback;
        await repos.chats.updateMessage(assistantMessage.id, {
          content: visibleAnswer || fallback,
          status: "error",
          quotes: [],
          retrievalScope: currentScope,
        });
        send({ type: "error", message });
      } finally {
        close();
      }
    },
  });

  return new Response(bodyStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});
