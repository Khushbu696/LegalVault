"use client";
import { useState, type ReactNode } from "react";
import { ArrowLeftIcon } from "./icons";
import { ghostButton } from "./NoticePanel";

export function SplitScreen({
  title,
  onBack,
  headerAside,
  left,
  right,
  leftLabel = "Analysis",
  rightLabel = "Document",
}: {
  title: string;
  onBack: () => void;
  headerAside?: ReactNode;
  left: ReactNode;
  right: ReactNode;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const [mobilePane, setMobilePane] = useState<"left" | "right">("left");

  return (
    <main className="flex h-dvh min-h-[32rem] flex-col overflow-hidden bg-parchment">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-sand bg-paper px-4">
        <button className={ghostButton} onClick={onBack} aria-label="Back to contracts">
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Contracts</span>
        </button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={title}>{title}</h1>
        {headerAside}
      </header>
      <div className="flex h-11 shrink-0 border-b border-sand bg-paper md:hidden" role="tablist" aria-label="Workspace panes">
        {(["left", "right"] as const).map((pane) => (
          <button
            key={pane}
            type="button"
            role="tab"
            aria-selected={mobilePane === pane}
            onClick={() => setMobilePane(pane)}
            className={`flex-1 border-b-2 text-sm font-medium ${mobilePane === pane ? "border-sage text-sage" : "border-transparent text-taupe"}`}
          >
            {pane === "left" ? leftLabel : rightLabel}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className={`${mobilePane === "left" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col border-r border-sand md:flex`} aria-label={leftLabel}>
          {left}
        </section>
        <section className={`${mobilePane === "right" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col md:flex`} aria-label={rightLabel}>
          {right}
        </section>
      </div>
    </main>
  );
}
