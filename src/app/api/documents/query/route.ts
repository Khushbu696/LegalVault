import OpenAI from "openai";
import { getAiEnv } from "@/lib/config/env";
import { apiError, handle } from "@/lib/http";
import { getRepositories } from "@/lib/repositories";
import { verifyQuoteAgainstDocument } from "@/lib/ai/verify";

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
  const missing = documentRecords.filter((doc) => !doc || doc.status !== "ready" || !doc.extractedText).map((doc) => doc?.id ?? "").filter(Boolean);
  if (missing.length > 0) return apiError(409, "NOT_READY", "All selected documents must be processed and ready before asking across them.", { missing });

  try {
    const aiEnv = getAiEnv();
    const client = new OpenAI({ apiKey: aiEnv.AI_API_KEY, baseURL: aiEnv.AI_BASE_URL });
    const validDocs = documentRecords.filter((doc): doc is NonNullable<typeof doc> => !!doc && doc.status === "ready" && !!doc.extractedText);
    const docLookup = new Map(validDocs.map((doc) => [doc.id, doc]));
    const input = await Promise.all(validDocs.map(async (doc) => {
      const chunks = await repos.chunks.listByDocument(doc.id);
      const excerpt = chunks.slice(0, 10).map((chunk) => `${chunk.sectionHeading ?? "Section"}\n${chunk.text}`).join("\n\n");
      return { doc, excerpt };
    }));

    const prompt = [
      "You are a legal-contract comparison assistant.",
      "Answer the question across the selected contracts by synthesizing the contract-by-contract facts into one comparative answer.",
      "Do not dump separate paragraphs per contract without interpretation.",
      "Return compact JSON with keys: { answer: string, quotes: [{ documentId: string, quote: string, sourceDocument: string }] }.",
      "The quotes must be verified against the source document only and must not cite text from another contract.",
      ...input.map(({ doc, excerpt }) => `Document: ${doc.originalFilename}\n${excerpt}`),
    ].join("\n\n");

    const completion = await client.chat.completions.create({
      model: aiEnv.AI_MODEL,
      messages: [{ role: "user", content: `${question}\n\n${prompt}` }],
      stream: false,
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? `{ "answer": "I couldn't find support for this in the selected documents.", "quotes": [] }`);
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : "I couldn't find support for this in the selected documents.";
    const quotes = Array.isArray(parsed.quotes) ? parsed.quotes : [];

    const verified = quotes.flatMap((quoteItem: Record<string, unknown>, index: number) => {
      if (typeof quoteItem?.documentId !== "string" || typeof quoteItem?.quote !== "string") return [];
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
        reason: "✓ Verified in Text",
        documentId: doc.id,
        sourceDocument: doc.originalFilename,
      }];
    });

    return Response.json({ answer, quotes: verified, documentCount: documentIds.length });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "AI unavailable.";
    return apiError(503, "AI_UNAVAILABLE", "The AI service is currently unavailable for multi-document analysis.", { detail });
  }
});
