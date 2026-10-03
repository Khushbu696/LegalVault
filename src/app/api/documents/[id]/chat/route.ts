import OpenAI from "openai";
import { buildChunkContext, retrieveRelevantChunks } from "@/lib/ai/retrieval";
import { verifyQuoteAgainstDocument } from "@/lib/ai/verify";
import { getAiEnv } from "@/lib/config/env";
import { apiError, handle } from "@/lib/http";
import { getRepositories } from "@/lib/repositories";
import type { QuoteRecord } from "@/lib/repositories/types";

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

  const relevant = retrieveRelevantChunks(question, await repos.chunks.listByDocument(id));
  const retrievalScope = {
    chunkIndexes: relevant.chunkIndexes,
    totalChunks: relevant.totalChunks,
    coverage: relevant.coverage,
  };

  const contextText = buildChunkContext(relevant.selected.length > 0 ? relevant.selected : [{
    id: "full-document",
    documentId: id,
    chunkIndex: 0,
    text: doc.extractedText,
    startOffset: 0,
    endOffset: doc.extractedText.length,
    pageStart: doc.pageRanges[0]?.page ?? 1,
    pageEnd: doc.pageRanges.at(-1)?.page ?? 1,
    sectionHeading: "Document text",
  }]);

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

  const client = new OpenAI({
    apiKey: aiEnv.AI_API_KEY,
    baseURL: aiEnv.AI_BASE_URL,
  });

  const prompt = [
    "You are a legal-contract analysis assistant. Use only the provided document excerpts. Never invent a quote or claim a statement is present unless it appears in the supplied text.",
    "If the answer is not supported by those sections, say exactly: 'I couldn't find support for this in the sections searched.'",
    "If the question is supported, answer in plain English and include a compact JSON object in the response body with: { answer: string, quotes: [{ quote: string }] }.",
    `Important: the retrieval covered ${relevant.chunkIndexes.length} of ${relevant.totalChunks} sections. If coverage is partial, state that the search was limited and do not claim the whole document is absent of support.`,
    "Never mention page numbers or offsets that the model cannot prove from the excerpts.",
  ].join("\n");

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await client.chat.completions.create({
      model: aiEnv.AI_MODEL,
      temperature: 0.1,
      messages: [
        { role: "system", content: prompt },
        ...prior.slice(-8).map((message) => ({ role: message.role, content: message.content })),
        { role: "user", content: `Question: ${question}\n\nRelevant excerpts:\n${contextText}` },
      ],
      stream: true,
    });
  } catch (error) {
    const extra = error instanceof Error ? error.message : "";
    const message = /model|not found|unsupported|invalid/i.test(extra)
      ? "The configured AI model is unavailable. Update the model in the environment and try again."
      : "The AI service is currently unavailable. Please try again in a moment.";
    await repos.chats.updateMessage(assistantMessage.id, {
      content: message,
      status: "error",
      quotes: [],
      retrievalScope,
    });
    return apiError(503, "AI_UNAVAILABLE", message, { detail: extra });
  }

  const encoder = new TextEncoder();
  const chunks: string[] = [];
  const bodyStream = new ReadableStream({
    async start(controller) {
      const onAbort = async () => {
        const partial = chunks.join("").trim();
        if (!partial) {
          await repos.chats.updateMessage(assistantMessage.id, { status: "stopped", retrievalScope });
        } else {
          await repos.chats.updateMessage(assistantMessage.id, { content: partial, status: "stopped", retrievalScope });
        }
        controller.close();
      };

      req.signal.addEventListener("abort", onAbort, { once: true });

      try {
        for await (const part of stream) {
          if (req.signal.aborted) break;
          const delta = part.choices?.[0]?.delta?.content ?? "";
          const text = typeof delta === "string" ? delta : "";
          if (!text) continue;
          chunks.push(text);
          const combined = chunks.join("");
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text })}\n\n`));
          await repos.chats.updateMessage(assistantMessage.id, { content: combined, status: "streaming" });
        }

        if (req.signal.aborted) {
          await onAbort();
          return;
        }

        const raw = chunks.join("");
        const parsed = parseStructuredAnswer(raw);
        const answer = parsed.answer || "I couldn't find support for this in the sections searched.";
        const documentText = doc.extractedText ?? "";
        const verifiedQuotes = verifyQuotes(documentText, parsed.quotes, doc.pageRanges).map((quote) => ({
          ...quote,
          status: quote.status,
          reason: quote.status === "verified" ? "✓ Verified in Text" : "⚠️ Unverified: not found in text",
        }));

        await repos.chats.updateMessage(assistantMessage.id, {
          content: answer,
          status: "complete",
          quotes: verifiedQuotes,
          retrievalScope,
        });

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done", answer, quotes: verifiedQuotes, retrievalScope })}\n\n`),
        );
        controller.close();
      } catch (error) {
        const fallback = "The AI response failed. Please try again.";
        const message = error instanceof Error ? error.message : fallback;
        await repos.chats.updateMessage(assistantMessage.id, {
          content: chunks.join("") || fallback,
          status: "error",
          quotes: [],
          retrievalScope,
        });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
        controller.close();
      } finally {
        req.signal.removeEventListener("abort", onAbort);
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
