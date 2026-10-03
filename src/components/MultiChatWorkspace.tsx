"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDocuments } from "@/hooks/useDocuments";
import { askAcrossDocuments, isAbort, messageOf, type MultiChatEvent, type MultiQuoteEvent } from "@/lib/client/api";
import type { DocumentDTO } from "@/lib/client/types";
import { ReaderPane } from "./ReaderPane";
import { SplitScreen } from "./SplitScreen";
import { XIcon } from "./icons";

interface Message {
  role: "user" | "assistant";
  content: string;
  quotes: MultiQuoteEvent[];
  status?: "streaming" | "complete" | "stopped";
}

export function MultiChatWorkspace({ initialIds }: { initialIds: string[] }) {
  const router = useRouter();
  const { documents, error } = useDocuments();
  const [activeIds, setActiveIds] = useState(initialIds);
  const [activeDocumentId, setActiveDocumentId] = useState(initialIds[0] ?? "");
  const [quoteFocus, setQuoteFocus] = useState<{ startOffset: number; endOffset: number } | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const abortRef = useState<{ current: AbortController | null }>({ current: null })[0];
  const selectedDocuments = documents?.filter((doc) => activeIds.includes(doc.id)) ?? [];
  const readyDocuments = selectedDocuments.filter((doc) => doc.status === "ready");
  const activeDocument = readyDocuments.find((doc) => doc.id === activeDocumentId) ?? readyDocuments[0] ?? null;

  const updateAssistant = (update: (message: Message) => Message) => {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (!last || last.role !== "assistant") return current;
      return [...current.slice(0, -1), update(last)];
    });
  };

  const removeDocument = (id: string) => {
    const nextIds = activeIds.filter((activeId) => activeId !== id);
    setActiveIds(nextIds);
    if (activeDocumentId === id) setActiveDocumentId(nextIds[0] ?? "");
    if (nextIds.length === 0) {
      router.replace("/");
      return;
    }
    router.replace(`/multi-chat?ids=${nextIds.map(encodeURIComponent).join(",")}`);
  };

  const submit = async () => {
    const trimmed = question.trim();
    if (!trimmed || loading || activeIds.length === 0) return;
    setQuestion("");
    setRequestError(null);
    setMessages((current) => [...current,
      { role: "user", content: trimmed, quotes: [] },
      { role: "assistant", content: "", quotes: [], status: "streaming" },
    ]);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await askAcrossDocuments(activeIds, trimmed, controller.signal, (event: MultiChatEvent) => {
        if (event.type === "delta") {
          updateAssistant((message) => ({ ...message, content: `${message.content}${event.text ?? ""}` }));
        } else if (event.type === "done") {
          updateAssistant((message) => ({ ...message, content: event.answer ?? message.content, quotes: event.quotes ?? [], status: "complete" }));
        } else if (event.type === "error") {
          throw new Error(event.message ?? "The multi-document answer could not be completed.");
        }
      });
    } catch (cause) {
      if (isAbort(cause)) {
        updateAssistant((message) => ({ ...message, content: message.content || "Generation stopped.", status: "stopped" }));
      } else {
        setRequestError(messageOf(cause));
        updateAssistant((message) => ({ ...message, content: message.content || "The answer could not be completed.", status: "stopped" }));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const openQuote = (quote: MultiQuoteEvent) => {
    setActiveDocumentId(quote.documentId);
    if (quote.startOffset !== null && quote.endOffset !== null) {
      setQuoteFocus({ startOffset: quote.startOffset, endOffset: quote.endOffset });
    }
  };

  const paneError = activeIds.length === 0
    ? "No contracts were selected. Return to the library and select at least one."
    : (documents && selectedDocuments.length !== activeIds.length ? "One or more selected contracts are unavailable." : null)
      ?? (selectedDocuments.some((doc) => doc.status !== "ready") ? "Selected contracts must finish processing before you can ask across them." : null)
      ?? error;
  const canAsk = documents !== null && !paneError && activeIds.length > 0;

  return (
    <SplitScreen
      title="Multi-document analysis"
      onBack={() => router.push("/")}
      headerAside={<span className="hidden text-xs text-taupe sm:inline">{activeIds.length} contracts</span>}
      leftLabel="Chat"
      rightLabel="Documents"
      left={(
        <div className="flex min-h-0 flex-1 flex-col bg-parchment">
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-sand bg-paper px-4 py-3" aria-label="Active contracts">
            {selectedDocuments.map((doc: DocumentDTO) => (
              <span key={doc.id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-sand bg-parchment px-2 py-1 text-xs">
                <span className="max-w-40 truncate" title={doc.originalFilename}>{doc.originalFilename}</span>
                <button type="button" onClick={() => removeDocument(doc.id)} aria-label={`Remove ${doc.originalFilename}`} className="text-taupe hover:text-espresso"><XIcon className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
            {documents === null && !paneError && <p className="text-sm text-taupe">Loading selected contracts…</p>}
            {paneError && <p role="alert" className="rounded-lg border border-ochre/40 bg-ochre-wash p-3 text-sm text-ochre-ink">{paneError}</p>}
            {messages.length === 0 && !paneError && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <h2 className="font-semibold">Ask across your contracts</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-taupe">Answers are synthesized from selected documents. Every citation is checked against its own source.</p>
              </div>
            )}
            <div className="space-y-3">
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className={`rounded-lg border p-3 ${message.role === "user" ? "border-sand bg-paper" : "border-sage/25 bg-sage-wash"}`}>
                  <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-taupe">
                    <span>{message.role === "user" ? "You" : "Synthesis"}</span>
                    {message.status === "streaming" && <span>Streaming…</span>}
                    {message.status === "stopped" && <span>Stopped</span>}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.content || (message.status === "streaming" ? "Generating…" : "")}</p>
                  {message.quotes.length > 0 && <div className="mt-3 space-y-2">
                    {message.quotes.map((quote, quoteIndex) => (
                      <button key={`${quote.documentId}-${quoteIndex}`} type="button" onClick={() => openQuote(quote)} className="w-full rounded-md border border-sage/25 bg-paper px-3 py-2 text-left text-sm hover:border-sage">
                        <span className="block text-[11px] font-semibold text-sage">[{quote.sourceDocument} • Page {quote.pageStart ?? "—"}]</span>
                        <span className="mt-1 block leading-5">“{quote.quoteText}”</span>
                      </button>
                    ))}
                  </div>}
                </article>
              ))}
            </div>
            {requestError && <p role="alert" className="mt-3 text-sm text-ochre-ink">{requestError}</p>}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex shrink-0 gap-2 border-t border-sand bg-paper p-3">
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} aria-label="Question across selected contracts" placeholder="Ask across the selected contracts…" className="min-h-10 min-w-0 flex-1 resize-none rounded-md border border-sand bg-parchment px-3 py-2 text-sm" />
            {loading
              ? <button type="button" className="rounded-md bg-ochre-ink px-3 text-sm font-medium text-white" onClick={() => abortRef.current?.abort()}>Stop</button>
              : <button type="submit" disabled={!canAsk || !question.trim()} className="rounded-md bg-sage px-3 text-sm font-medium text-white disabled:opacity-50">Ask</button>}
          </form>
        </div>
      )}
      right={(
        <div className="flex min-h-0 flex-1 flex-col bg-paper">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-sand px-3" role="tablist" aria-label="Selected document viewers">
            {readyDocuments.map((doc) => (
              <button key={doc.id} type="button" role="tab" aria-selected={activeDocument?.id === doc.id} onClick={() => { setActiveDocumentId(doc.id); setQuoteFocus(null); }} className={`max-w-52 truncate border-b-2 px-3 py-3 text-sm ${activeDocument?.id === doc.id ? "border-sage font-semibold text-sage" : "border-transparent text-taupe"}`} title={doc.originalFilename}>{doc.originalFilename}</button>
            ))}
          </div>
          {activeDocument
            ? <ReaderPane key={activeDocument.id} doc={activeDocument} highlight={quoteFocus} />
            : <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-taupe">{documents === null ? "Loading document viewer…" : "No ready selected document is available to display."}</div>}
        </div>
      )}
    />
  );
}
