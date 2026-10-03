"use client";
import { useState } from "react";
import { primaryButton, ghostButton } from "./NoticePanel";

export interface MultiQuoteResult {
  documentId: string;
  sourceDocument: string;
  quoteText: string;
  startOffset: number | null;
  endOffset: number | null;
  status: "verified" | "unverified";
  reason: string | null;
}

export function MultiDocumentPane({
  selectedDocuments,
  onOpenDocument,
}: {
  selectedDocuments: Array<{ id: string; originalFilename: string }>;
  onOpenDocument: (documentId: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<MultiQuoteResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  type QuotePayload = {
    documentId?: string;
    sourceDocument?: string;
    quoteText?: string;
    startOffset?: number | null;
    endOffset?: number | null;
    status?: "verified" | "unverified";
    reason?: string | null;
  };

  const submit = async () => {
    const trimmed = question.trim();
    if (!trimmed || selectedDocuments.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/documents/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: selectedDocuments.map((doc) => doc.id), question: trimmed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error?.message || "Couldn't ask across the selected documents.");
      }
      setAnswer(payload.answer ?? "I couldn't find support for this in the selected documents.");
      const quotePayload = Array.isArray(payload.quotes) ? payload.quotes as QuotePayload[] : [];
      setQuotes(quotePayload.map((quote) => ({
        documentId: quote.documentId ?? "",
        sourceDocument: quote.sourceDocument ?? "Document",
        quoteText: quote.quoteText ?? "",
        startOffset: quote.startOffset ?? null,
        endOffset: quote.endOffset ?? null,
        status: quote.status ?? "verified",
        reason: quote.reason ?? null,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setAnswer(null);
      setQuotes([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-sand bg-paper p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Ask across selected documents</h3>
          <p className="text-xs text-taupe">{selectedDocuments.length} selected</p>
        </div>
        {selectedDocuments.length > 1 && (
          <button className={ghostButton} type="button" onClick={() => setQuestion((current) => current || "What are the key differences in the payment and liability terms across these contracts?")}>Use sample</button>
        )}
      </div>

      <textarea
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        rows={3}
        aria-label="Question across selected documents"
        className="w-full resize-none rounded-lg border border-sand bg-parchment px-3 py-2 text-sm"
        placeholder="Ask a question across the selected contracts…"
      />

      <div className="mt-3 flex items-center justify-end gap-2">
        <button className={primaryButton} type="button" disabled={loading || selectedDocuments.length === 0} onClick={() => void submit()}>
          {loading ? "Analyzing…" : "Ask across selected documents"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-ochre/40 bg-ochre-wash p-3 text-sm text-ochre-ink">{error}</div>
      )}

      {answer && (
        <div className="mt-4 rounded-xl border border-sage/25 bg-sage-wash p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-taupe">Synthesis</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-espresso">{answer}</p>
        </div>
      )}

      {quotes.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-taupe">Verified quotes</p>
          {quotes.map((quote, idx) => (
            <button
              key={`${quote.documentId}-${idx}`}
              type="button"
              className="w-full rounded-lg border border-sage/25 bg-paper p-3 text-left"
              onClick={() => onOpenDocument(quote.documentId)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-taupe">{quote.sourceDocument}</span>
                <span className="text-[11px] text-sage">{quote.reason ?? "Verified"}</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-espresso">“{quote.quoteText}”</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
