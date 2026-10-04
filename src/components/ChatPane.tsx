"use client";
import { useEffect, useRef, useState } from "react";
import { askDocumentQuestion, listDocumentMessages, messageOf } from "@/lib/client/api";
import type { ChatMessageDTO, DocumentDTO, QuoteDTO } from "@/lib/client/types";

interface QuoteFocus {
  startOffset: number;
  endOffset: number;
}

type ChatMessageView = ChatMessageDTO & { researchActivity?: string[] };

export function ChatPane({ doc, onQuoteSelect }: { doc: DocumentDTO; onQuoteSelect?: (quote: QuoteFocus | null) => void }) {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDocumentMessages(doc.id)
      .then((data) => {
        if (!cancelled) setMessages(data);
      })
      .catch((e) => {
        if (!cancelled) setError(messageOf(e));
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [doc.id]);

  const updateLatestAssistant = (patch: Partial<ChatMessageDTO>) => {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (!last || last.role !== "assistant") return current;
      return [...current.slice(0, -1), { ...last, ...patch }];
    });
  };

  const submit = async (nextQuestion: string) => {
    const trimmed = nextQuestion.trim();
    if (!trimmed || loading) return;

    setQuestion("");
    setError(null);
    const userMessage: ChatMessageDTO = {
      id: `local-user-${Date.now()}`,
      chatId: "",
      documentId: doc.id,
      role: "user",
      content: trimmed,
      status: "complete",
      quotes: [],
      retrievalScope: null,
      createdAt: new Date().toISOString(),
    };

    const assistantMessage: ChatMessageDTO = {
      id: `local-assistant-${Date.now()}`,
      chatId: "",
      documentId: doc.id,
      role: "assistant",
      content: "",
      status: "streaming",
      quotes: [],
      retrievalScope: null,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await askDocumentQuestion(doc.id, trimmed, controller.signal, (event) => {
        setMessages((current) => {
          const last = current[current.length - 1];
          if (!last || last.role !== "assistant") return current;
          if (event.type === "delta") {
            return [
              ...current.slice(0, -1),
              { ...last, content: `${last.content}${event.text ?? ""}`, status: "streaming" },
            ];
          }
          if (event.type === "agent_activity") {
            return [
              ...current.slice(0, -1),
              { ...last, researchActivity: [...(last.researchActivity ?? []), event.message ?? "Research step completed."] },
            ];
          }
          if (event.type === "done") {
            return [
              ...current.slice(0, -1),
              {
                ...last,
                content: event.answer ?? last.content,
                status: "complete",
                quotes: event.quotes ?? [],
                retrievalScope: event.retrievalScope ?? null,
              },
            ];
          }
          if (event.type === "error") {
            return [
              ...current.slice(0, -1),
              { ...last, content: event.message ?? "The AI response failed. Please try again.", status: "error" },
            ];
          }
          return current;
        });
      });
    } catch (e) {
      updateLatestAssistant({ content: "This answer was interrupted before it could finish.", status: "stopped" });
      setError(messageOf(e));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  return (
    <section aria-label="Chat" className="flex min-h-0 flex-1 flex-col bg-parchment">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading && (
          <div className="flex min-h-full flex-col items-center justify-center text-center">
            <p className="font-semibold">Ask about this contract</p>
            <p className="mt-1 max-w-xs text-sm text-taupe">
              Use only “{doc.originalFilename}”. Every answer is checked against the extracted text.
            </p>
          </div>
        )}

        {messages.length > 0 && (
          <div className="space-y-3">
            {messages.map((message) => (
              <article key={`${message.role}-${message.id}-${message.createdAt}`} className={`rounded-xl border p-3 ${message.role === "user" ? "border-sand bg-paper" : "border-sage/20 bg-sage-wash"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-taupe">
                    {message.role === "user" ? "You" : "Contract analysis"}
                  </span>
                  {message.status === "streaming" && <span className="font-mono text-[10px] text-sage">Streaming…</span>}
                  {message.status === "stopped" && <span className="font-mono text-[10px] text-ochre-ink">Stopped</span>}
                  {message.status === "error" && <span className="font-mono text-[10px] text-ochre-ink">Error</span>}
                </div>
                {message.researchActivity && message.researchActivity.length > 0 && (
                  <details open={message.status === "streaming"} className="mt-2 rounded-md border border-sand bg-paper/70 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-sage">Research steps ({message.researchActivity.length})</summary>
                    <ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-5 text-taupe">
                      {message.researchActivity.map((activity, index) => <li key={`${message.id}-research-${index}`}>{activity}</li>)}
                    </ol>
                  </details>
                )}
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-espresso">{message.content || (message.status === "streaming" ? "Generating…" : "")}</div>

                {message.retrievalScope && message.retrievalScope.coverage === "partial" && (
                  <p className="mt-2 rounded-md border border-ochre/30 bg-ochre-wash px-2 py-1 text-xs text-ochre-ink">
                    {message.retrievalScope.totalChunks === 0
                      ? "No searchable sections were indexed, so the document could not be fully searched."
                      : `Searched ${message.retrievalScope.chunkIndexes.length} of ${message.retrievalScope.totalChunks} sections for this question. Other sections were not examined.`}
                  </p>
                )}

                {message.quotes && message.quotes.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.quotes.map((quote: QuoteDTO, idx: number) => (
                      <button
                        key={`${message.id}-quote-${idx}`}
                        type="button"
                        onClick={() => {
                          if (quote.startOffset !== null && quote.endOffset !== null && onQuoteSelect) {
                            onQuoteSelect({ startOffset: quote.startOffset, endOffset: quote.endOffset });
                          }
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left ${quote.status === "verified" ? "border-sage/25 bg-sage-wash text-sage" : "border-ochre/40 bg-ochre-wash text-ochre-ink"}`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.08em]">
                          <span>{quote.status === "verified" ? "✓ Verified in Text" : "⚠️ Unverified: not found in text"}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6">“{quote.quoteText}”</p>
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {error && (
          <div role="alert" className="mt-3 rounded-lg border border-ochre/40 bg-ochre-wash p-3 text-sm text-ochre-ink">
            {error}
          </div>
        )}
      </div>

      <div className="border-t border-sand bg-paper p-4">
        <form onSubmit={(event) => { event.preventDefault(); void submit(question); }} className="flex gap-2">
          <textarea
            rows={1}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            aria-label="Question"
            placeholder="Ask a question about this document…"
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-sand bg-parchment px-3 py-2 text-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(question);
              }
            }}
          />

          {loading ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg bg-ochre-ink px-4 py-2 text-sm font-medium text-white">
              Stop
            </button>
          ) : (
            <button type="submit" className="rounded-lg bg-sage px-4 py-2 text-sm font-medium text-white">
              Ask
            </button>
          )}
        </form>
      </div>
    </section>
  );
}
