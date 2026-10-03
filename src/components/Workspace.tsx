"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ChatPane } from "./ChatPane";
import { ArrowLeftIcon, LibraryIcon } from "./icons";
import { ghostButton } from "./NoticePanel";
import { ReaderPane } from "./ReaderPane";
import { StatusBadge } from "./StatusBadge";
import type { DocumentDTO } from "@/lib/client/types";

export type MobileTab = "chat" | "document";

interface Props {
  doc: DocumentDTO;
  onOpenLibrary: () => void;
  mobileTab: MobileTab;
  onMobileTab: (t: MobileTab) => void;
}

/** Selected-document view: header + 40% chat / 60% document reader (stacked with tabs on small screens). */
export function Workspace({ doc, onOpenLibrary, mobileTab, onMobileTab }: Props) {
  const [quoteFocus, setQuoteFocus] = useState<{ startOffset: number; endOffset: number } | null>(null);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-sand bg-paper px-4 py-3">
        <button className={ghostButton} onClick={onOpenLibrary}>
          <ArrowLeftIcon className="h-3.5 w-3.5" /><LibraryIcon className="h-3.5 w-3.5" />Documents
        </button>
        <h1 className="min-w-0 flex-1 truncate font-semibold" title={doc.originalFilename}>{doc.originalFilename}</h1>
        <StatusBadge status={doc.status} />
      </header>

      <div className="flex gap-1 border-b border-sand bg-paper px-4 md:hidden" role="tablist">
        {(["chat", "document"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={mobileTab === t} onClick={() => onMobileTab(t)}
            className={`border-b-2 px-3 py-2 text-sm font-medium capitalize ${mobileTab === t ? "border-sage text-sage" : "border-transparent text-taupe"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[2fr_3fr]">
        <div className={`${mobileTab === "chat" ? "flex" : "hidden"} min-h-0 flex-col border-r border-sand md:flex`}>
          <ChatPane doc={doc} onQuoteSelect={setQuoteFocus} />
        </div>
        <div className={`${mobileTab === "document" ? "flex" : "hidden"} min-h-0 flex-col md:flex`}>
          <ReaderPane key={doc.id} doc={doc} highlight={quoteFocus} />
        </div>
      </div>
    </div>
  );
}

/** Slide-over for switching documents / uploading while a document is open. */
export function LibraryDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="absolute inset-0 bg-espresso/30" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label="Documents"
        className="relative z-10 flex h-full w-[min(26rem,100vw)] flex-col overflow-y-auto border-r border-sand bg-parchment p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your contracts</h2>
          <button className={ghostButton} onClick={onClose}>Close</button>
        </div>
        <div className="space-y-5">{children}</div>
      </aside>
    </div>
  );
}
