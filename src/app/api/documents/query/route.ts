import OpenAI from "openai";
import { getAiEnv } from "@/lib/config/env";
import { apiError, handle } from "@/lib/http";
import { getRepositories } from "@/lib/repositories";
import { verifyQuoteAgainstDocument } from "@/lib/ai/verify";
import { buildMultiDocumentContext } from "@/lib/ai/multi-document-context";
import { normalizeForSearch } from "@/lib/ai/retrieval";

export const POST = handle(async (req) => {
  const repos = await getRepositories();
  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const documentIds: string[] = Array.isArray(body?.documentIds)
    ? body.documentIds.filter((id: unknown): id is string => typeof id === "string")
    : [];

  if (!question) return apiError(400, "INVALID_REQUEST", "Please enter a question.");
  if (documentIds.length === 0) return apiError(400, "INVALID_REQUEST", "Select at least one document first.");

  const documentRecords = await Promise.all(documentIds.map(async (id) => repos.documents.get(id)));
  const missing = documentRecords.flatMap((doc, index) => !doc || doc.status !== "ready" || !doc.extractedText ? [documentIds[index]] : []);
  if (missing.length > 0) return apiError(409, "NOT_READY", "All selected documents must be processed and ready before asking across them.", { missing });

  try {
    const aiEnv = getAiEnv();
    const client = new OpenAI({ apiKey: aiEnv.AI_API_KEY, baseURL: aiEnv.AI_BASE_URL });
    const validDocs = documentRecords.filter((doc): doc is NonNullable<typeof doc> => !!doc && doc.status === "ready" && !!doc.extractedText);
    const docLookup = new Map(validDocs.map((doc) => [doc.id, doc]));
    const input = await Promise.all(validDocs.map(async (doc) => {
      const chunks = await repos.chunks.listByDocument(doc.id);
      const context = buildMultiDocumentContext(question, doc, chunks);
      return { doc, ...context };
    }));

    const instructions = [
      "You are a legal-contract analysis assistant. The supplied excerpts are the available contract text for this request.",
      "Answer the question across the selected contracts by synthesizing supported facts. Do not claim that contract text or file contents are unavailable merely because only retrieved excerpts are supplied.",
      "If the excerpts do not support an answer, say you could not find support in the excerpts. Never invent a contract term or quote.",
      "Write the answer as plain text, then output the exact marker <QUOTES> on a new line followed by a JSON array of quote objects.",
      "Each quote object must have documentId, quote, and sourceDocument fields. Keep quotes short and verbatim.",
      "The quotes must be verified against the source document only and must not cite text from another contract.",
    ].join("\n");
    const excerpts = input.map(({ doc, excerpt }) => `Document ID: ${doc.id}\nDocument: ${doc.originalFilename}\nRetrieved excerpts:\n${excerpt || "No searchable excerpts were available for this document."}`).join("\n\n---\n\n");

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        void (async () => {
          try {
            const completion = await client.chat.completions.create({
              model: aiEnv.AI_MODEL,
              messages: [
                { role: "system", content: instructions },
                { role: "user", content: `Question: ${question}\n\nSelected document excerpts:\n${excerpts}` },
              ],
              stream: true,
            }, { signal: req.signal });
            const marker = "<QUOTES>";
            let raw = "";
            let emittedLength = 0;
            let markerIndex = -1;

            for await (const part of completion) {
              raw += part.choices?.[0]?.delta?.content ?? "";
              markerIndex = raw.indexOf(marker);
              if (markerIndex >= 0) {
                const answerDelta = raw.slice(emittedLength, markerIndex);
                if (answerDelta) send({ type: "delta", text: answerDelta });
                emittedLength = markerIndex;
                break;
              }
              const safeLength = Math.max(emittedLength, raw.length - marker.length + 1);
              if (safeLength > emittedLength) {
                send({ type: "delta", text: raw.slice(emittedLength, safeLength) });
                emittedLength = safeLength;
              }
            }

            const answer = (markerIndex >= 0 ? raw.slice(0, markerIndex) : raw).trim() || "I couldn't find support for this in the selected documents.";
            const quotePayload = markerIndex >= 0 ? raw.slice(markerIndex + marker.length).trim() : "[]";
            let proposedQuotes: unknown[] = [];
            try {
              const parsed: unknown = JSON.parse(quotePayload);
              if (Array.isArray(parsed)) proposedQuotes = parsed;
            } catch {
              proposedQuotes = [];
            }

            const aiVerified = proposedQuotes.flatMap((item: unknown, index) => {
              if (!item || typeof item !== "object") return [];
              const quoteItem = item as Record<string, unknown>;
              if (typeof quoteItem.documentId !== "string" || typeof quoteItem.quote !== "string") return [];
              const doc = docLookup.get(quoteItem.documentId);
              if (!doc || !doc.extractedText) return [];
              const checked = verifyQuoteAgainstDocument(doc.extractedText, quoteItem.quote, doc.pageRanges);
              if (checked.status !== "verified") return [];
              return [{
                ordinal: index,
                quoteText: quoteItem.quote,
                normalizedQuote: checked.normalizedQuote,
                status: "verified" as const,
                matchType: checked.matchType,
                startOffset: checked.startOffset,
                endOffset: checked.endOffset,
                matchedText: checked.matchedText,
                occurrenceCount: checked.occurrenceCount,
                occurrenceIndex: checked.occurrenceIndex,
                chunkId: null,
                pageStart: checked.pageStart,
                reason: "Verified in text",
                documentId: doc.id,
                sourceDocument: doc.originalFilename,
              }];
            });
            const citedDocumentIds = new Set(aiVerified.map((quote) => quote.documentId));
            const questionTerms = normalizeForSearch(question).split(/\s+/).filter((term) => term.length > 3 && !["about", "agreement", "contract", "document", "summarize"].includes(term));
            const fallbackQuotes = input.flatMap(({ doc, selectedChunks }, index) => {
              if (citedDocumentIds.has(doc.id) || !doc.extractedText) return [];
              const candidate = selectedChunks
                .flatMap((chunk) => chunk.text.split(/(?<=[.!?])\s+|\n+/))
                .map((text) => text.trim())
                .filter((text) => text.length >= 25)
                .map((text) => ({
                  text: text.slice(0, 240).trim(),
                  score: questionTerms.reduce((score, term) => score + (normalizeForSearch(text).includes(term) ? 1 : 0), 0),
                }))
                .sort((a, b) => b.score - a.score || a.text.length - b.text.length)[0]?.text;
              if (!candidate) return [];
              const checked = verifyQuoteAgainstDocument(doc.extractedText, candidate, doc.pageRanges);
              if (checked.status !== "verified") return [];
              return [{
                ordinal: proposedQuotes.length + index,
                quoteText: candidate,
                normalizedQuote: checked.normalizedQuote,
                status: "verified" as const,
                matchType: checked.matchType,
                startOffset: checked.startOffset,
                endOffset: checked.endOffset,
                matchedText: checked.matchedText,
                occurrenceCount: checked.occurrenceCount,
                occurrenceIndex: checked.occurrenceIndex,
                chunkId: null,
                pageStart: checked.pageStart,
                reason: "Verified in text",
                documentId: doc.id,
                sourceDocument: doc.originalFilename,
              }];
            });
            const verified = [...aiVerified, ...fallbackQuotes];

            send({ type: "done", answer, quotes: verified, documentCount: documentIds.length });
          } catch (error) {
            if (req.signal.aborted) return;
            const detail = error instanceof Error ? error.message : "AI unavailable.";
            send({ type: "error", message: "The AI service is currently unavailable for multi-document analysis.", detail });
          } finally {
            if (!req.signal.aborted) controller.close();
          }
        })();
      },
    });

    return new Response(responseStream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "AI unavailable.";
    return apiError(503, "AI_UNAVAILABLE", "The AI service is currently unavailable for multi-document analysis.", { detail });
  }
});
