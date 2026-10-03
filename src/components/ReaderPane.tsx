"use client";
import { useEffect, useState } from "react";
import { AlertIcon } from "./icons";
import { ghostButton } from "./NoticePanel";
import { getDocumentText, messageOf } from "@/lib/client/api";
import { emptyPagesNote } from "@/lib/client/status";
import type { DocumentDTO, DocumentTextDTO } from "@/lib/client/types";

interface QuoteHighlight { startOffset: number; endOffset: number }

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: DocumentTextDTO };

/**
 * Shows the canonical extracted text. Each page is rendered as an exact slice of that text by offset
 * (never re-flowed), so Step 11 can highlight a verified quote by the same offsets.
 * Mount with key={doc.id} so state resets per document.
 */
export function ReaderPane({ doc, highlight }: { doc: DocumentDTO; highlight?: QuoteHighlight | null }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDocumentText(doc.id)
      .then((data) => { if (!cancelled) setState({ kind: "ready", data }); })
      .catch((e) => { if (!cancelled) setState({ kind: "error", message: messageOf(e) }); });
    return () => { cancelled = true; };
  }, [doc.id, attempt]);

  return (
    <section aria-label="Document text" className="flex min-h-0 flex-1 flex-col bg-paper">
      <div className="flex items-center justify-between border-b border-sand px-6 py-3">
        <h2 className="truncate text-sm font-semibold" title={doc.originalFilename}>{doc.originalFilename}</h2>
        <span className="shrink-0 font-mono text-xs text-taupe">
          Extracted text{doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-10" id="reader-scroll">
        {state.kind === "loading" && (
          <div aria-busy="true" aria-label="Loading document text" className="mx-auto max-w-2xl space-y-3">
            {[90, 100, 95, 70, 100, 85, 60].map((w, i) => (
              <div key={i} className="h-4 rounded bg-sand/70 motion-safe:animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

        {state.kind === "error" && (
          <div role="alert" className="mx-auto max-w-md rounded-xl border border-ochre/40 bg-ochre-wash p-6 text-center">
            <p className="font-semibold text-ochre-ink">Couldn&apos;t load the document text</p>
            <p className="mt-1 text-sm">{state.message}</p>
            <button className={`${ghostButton} mt-4`} onClick={() => { setState({ kind: "loading" }); setAttempt((a) => a + 1); }}>
              Try again
            </button>
          </div>
        )}

        {state.kind === "ready" && <ReaderBody data={state.data} highlight={highlight} />}
      </div>
    </section>
  );
}

function ReaderBody({ data, highlight }: { data: DocumentTextDTO; highlight?: QuoteHighlight | null }) {
  const note = emptyPagesNote(data.emptyPages);

  useEffect(() => {
    if (!highlight || !data.pageRanges.length) return;
    const page = data.pageRanges.find((range) => highlight.startOffset >= range.start && highlight.endOffset <= range.end) ?? data.pageRanges.find((range) => highlight.startOffset >= range.start && highlight.startOffset <= range.end) ?? data.pageRanges[0];
    if (!page) return;
    const target = document.getElementById(`page-${page.page}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [data.pageRanges, highlight]);

  const renderText = (pageText: string, pageStart: number) => {
    if (!highlight) return pageText;
    if (highlight.startOffset < pageStart || highlight.endOffset > pageStart + pageText.length) return pageText;
    const startIndex = Math.max(0, highlight.startOffset - pageStart);
    const endIndex = Math.min(pageText.length, highlight.endOffset - pageStart);
    const before = pageText.slice(0, startIndex);
    const match = pageText.slice(startIndex, endIndex);
    const after = pageText.slice(endIndex);
    return (
      <>
        {before}
        <mark className="quote-highlight">{match}</mark>
        {after}
      </>
    );
  };

  return (
    <article className="mx-auto max-w-2xl">
      {note && (
        <p role="note" className="mb-6 flex items-start gap-1.5 rounded-lg border border-ochre/40 bg-ochre-wash p-3 text-sm">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-ochre-ink" />{note}
        </p>
      )}
      {data.pageRanges.length > 0 ? (
        data.pageRanges.map((r) => (
          <section key={r.page} id={`page-${r.page}`} className="mb-10" aria-label={`Page ${r.page}`}>
            <p className="mb-2 select-none font-mono text-xs text-taupe">Page {r.page}</p>
            <p className="whitespace-pre-wrap font-serif text-[1.0625rem] leading-relaxed" data-start={r.start}>
              {renderText(data.text.slice(r.start, r.end), r.start) || <span className="italic text-taupe">No readable text on this page.</span>}
            </p>
          </section>
        ))
      ) : (
        <p className="whitespace-pre-wrap font-serif text-[1.0625rem] leading-relaxed" data-start={0}>{renderText(data.text, 0)}</p>
      )}
    </article>
  );
}
