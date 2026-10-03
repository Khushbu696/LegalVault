"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDocuments } from "@/hooks/useDocuments";
import { messageOf } from "@/lib/client/api";
import { SplitScreen } from "./SplitScreen";

interface Delta {
  label: string;
  oldText: string;
  newText: string;
  significance: "Low" | "Medium" | "High";
  explanation: string;
}
interface ComparisonData {
  summary: string;
  summarySource: "ai" | "local";
  changes: Delta[];
  documents: { docA: { filename: string }; docB: { filename: string } };
}
type Filter = "all" | "high" | "structural";

const isStructural = (change: Delta) =>
  /^(section|clause|article)\b/i.test(`${change.oldText} ${change.newText}`) || /structur/i.test(change.label);

export function CompareWorkspace({ docAId, docBId }: { docAId: string; docBId: string }) {
  const router = useRouter();
  const { documents, error: documentsError } = useDocuments();
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [attempt, setAttempt] = useState(0);
  const docA = documents?.find((doc) => doc.id === docAId) ?? null;
  const docB = documents?.find((doc) => doc.id === docBId) ?? null;

  useEffect(() => {
    if (!documents) return;
    if (!docA || !docB || docA.status !== "ready" || docB.status !== "ready") return;

    const controller = new AbortController();
    fetch("/api/documents/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docA: docAId, docB: docBId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? "Couldn't compare these contracts.");
        setComparison(payload as ComparisonData);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [docA, docAId, docB, docBId, documents, attempt]);

  const changes = useMemo(() => {
    const all = comparison?.changes ?? [];
    if (filter === "high") return all.filter((change) => change.significance === "High");
    if (filter === "structural") return all.filter(isStructural);
    return all;
  }, [comparison, filter]);

  const headerAside = docA && docB ? (
    <span className="hidden max-w-[40%] truncate text-xs text-taupe sm:block" title={`${docA.originalFilename} vs ${docB.originalFilename}`}>
      {docA.originalFilename} vs {docB.originalFilename}
    </span>
  ) : null;
  const availabilityError = documents && (!docA || !docB)
    ? "One or both selected contracts are unavailable."
    : docA && docB && (docA.status !== "ready" || docB.status !== "ready")
      ? "Both selected contracts must finish processing before they can be compared."
      : null;
  const paneError = error ?? documentsError ?? availabilityError;
  const isLoading = !paneError && (documents === null || loading);

  return (
    <SplitScreen
      title="Contract comparison"
      onBack={() => router.push("/")}
      headerAside={headerAside}
      leftLabel="Changes"
      rightLabel="Comparison"
      left={(
        <div className="flex min-h-0 flex-1 flex-col bg-parchment">
          <div className="shrink-0 border-b border-sand bg-paper p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sage">{comparison?.summarySource === "ai" ? "AI material-change summary" : "Material-change summary"}</p>
            <p className="mt-2 text-sm leading-6">{isLoading ? "Reviewing the aligned clause changes…" : comparison?.summary ?? paneError ?? "No comparison summary is available."}</p>
          </div>
          <div className="flex shrink-0 gap-1 border-b border-sand bg-paper px-3 py-2" role="tablist" aria-label="Filter changes">
            {([{ id: "all", label: "All" }, { id: "high", label: "High Impact" }, { id: "structural", label: "Structural" }] as const).map((option) => (
              <button key={option.id} type="button" role="tab" aria-selected={filter === option.id} onClick={() => setFilter(option.id)} className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${filter === option.id ? "bg-sage text-white" : "text-taupe hover:bg-parchment"}`}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {isLoading && <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-md bg-sand/60" />)}</div>}
            {paneError && !isLoading && <div role="alert" className="rounded-md border border-ochre/40 bg-ochre-wash p-3 text-sm text-ochre-ink"><p>{paneError}</p>{!availabilityError && <button type="button" className="mt-2 underline" onClick={() => { setError(null); setLoading(true); setAttempt((value) => value + 1); }}>Try again</button>}</div>}
            {!isLoading && !paneError && changes.length === 0 && <p className="px-2 py-6 text-sm text-taupe">{comparison?.changes.length ? "No changes match this filter." : "No material differences were detected."}</p>}
            <div className="space-y-2">
              {changes.map((change) => {
                const originalIndex = comparison?.changes.indexOf(change) ?? 0;
                return <button key={`${change.label}-${originalIndex}`} type="button" onClick={() => document.getElementById(`delta-${originalIndex}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="w-full rounded-md border border-sand bg-paper p-3 text-left hover:border-sage/60">
                  <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{change.label}</span><span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${change.significance === "High" ? "bg-rose-100 text-rose-800" : change.significance === "Medium" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{change.significance}</span></span>
                  <span className="mt-2 block line-clamp-2 text-xs leading-5 text-taupe">{change.explanation}</span>
                </button>;
              })}
            </div>
          </div>
        </div>
      )}
      right={(
        <div className="flex min-h-0 flex-1 flex-col bg-paper">
          <div className="grid shrink-0 grid-cols-2 border-b border-sand bg-paper text-xs font-semibold">
            <div className="truncate border-r border-sand px-3 py-3" title={comparison?.documents.docA.filename ?? docA?.originalFilename}>Version A · Original</div>
            <div className="truncate px-3 py-3" title={comparison?.documents.docB.filename ?? docB?.originalFilename}>Version B · Revised</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {isLoading && <p className="text-sm text-taupe">Preparing comparison…</p>}
            {paneError && !isLoading && <p className="text-sm text-taupe">Comparison content is unavailable.</p>}
            {!isLoading && !paneError && comparison?.changes.map((change, index) => (
              <section id={`delta-${index}`} key={`${change.label}-${index}`} className="mb-4 scroll-m-5 overflow-hidden rounded-md border border-sand">
                <div className="border-b border-sand bg-parchment px-3 py-2 text-xs font-semibold">{change.label}</div>
                <div className="grid grid-cols-2">
                  <p className="min-w-0 border-r border-sand bg-rose-50 p-3 text-xs leading-5 text-rose-950 [overflow-wrap:anywhere]">{change.oldText || "No corresponding clause in Version A."}</p>
                  <p className="min-w-0 bg-emerald-50 p-3 text-xs leading-5 text-emerald-950 [overflow-wrap:anywhere]">{change.newText || "No corresponding clause in Version B."}</p>
                </div>
                <p className="border-t border-sand px-3 py-2 text-xs leading-5 text-taupe">{change.explanation}</p>
              </section>
            ))}
          </div>
        </div>
      )}
    />
  );
}
