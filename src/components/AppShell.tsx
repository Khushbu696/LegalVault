"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DocumentLibrary } from "./DocumentLibrary";
import { FileIcon, Spinner } from "./icons";
import { MultiDocumentPane } from "./MultiDocumentPane";
import { ghostButton, NoticePanel, primaryButton } from "./NoticePanel";
import { StatusBadge } from "./StatusBadge";
import { Toasts, type Toast } from "./Toasts";
import { UploadZone } from "./UploadZone";
import { LibraryDrawer, Workspace, type MobileTab } from "./Workspace";
import { useDocuments, type TransitionEvent } from "@/hooks/useDocuments";
import { deleteDocument, getConfig, getDocumentText, isAbort, messageOf } from "@/lib/client/api";
import { failureTitle, processingText } from "@/lib/client/status";
import type { AppConfigDTO, UploadItem } from "@/lib/client/types";
import { uploadDocument } from "@/lib/client/upload";
import { compareContracts } from "@/lib/documents/comparison";

export default function AppShell() {
  const router = useRouter();
  const selectedId = useSearchParams().get("doc");

  const [config, setConfig] = useState<AppConfigDTO | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("document");
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ReturnType<typeof compareContracts> | null>(null);
  const controllers = useRef(new Map<string, AbortController>());

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const onTransition = useCallback((e: TransitionEvent) => {
    if (e.kind === "ready") toast("success", `“${e.doc.originalFilename}” is ready. You can open it now.`);
    else toast("error", `“${e.doc.originalFilename}” couldn't be processed: ${failureTitle(e.doc.errorCode)}.`);
  }, [toast]);

  const { documents, error, refresh, removeLocal } = useDocuments(onTransition);

  const toggleMultiSelect = useCallback((id: string) => {
    setMultiSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setComparison(null);
  }, []);

  const handleAskAcrossSelected = useCallback(() => {
    if (multiSelected.length === 0) return;
    setComparison(null);
  }, [multiSelected]);

  const handleCompareSelected = useCallback(async () => {
    if (multiSelected.length < 2 || !documents) return;
    const selectedDocs = documents.filter((doc) => multiSelected.includes(doc.id)).slice(0, 2);
    if (selectedDocs.length < 2) return;

    try {
      const [left, right] = await Promise.all(
        selectedDocs.map(async (doc) => getDocumentText(doc.id).then((text) => text.text)),
      );
      setComparison(compareContracts(left, right));
    } catch (e) {
      toast("error", messageOf(e));
    }
  }, [documents, multiSelected, toast]);

  useEffect(() => { getConfig().then(setConfig).catch(() => undefined); }, []); // server still validates if this fails

  const select = useCallback((id: string) => { setDrawerOpen(false); router.push(`/?doc=${id}`); }, [router]);

  const handleDelete = useCallback(async (id: string) => {
    const name = documents?.find((d) => d.id === id)?.originalFilename ?? "document";
    try {
      await deleteDocument(id);
      removeLocal(id);
      toast("success", `Deleted “${name}”.`);
      if (selectedId === id) router.replace("/");
    } catch (e) {
      toast("error", `Couldn't delete “${name}”: ${messageOf(e)}`);
    }
  }, [documents, removeLocal, router, selectedId, toast]);

  const patchUpload = (key: string, patch: Partial<UploadItem>) =>
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const runUpload = useCallback(async (file: File) => {
    const key = crypto.randomUUID();
    const controller = new AbortController();
    controllers.current.set(key, controller);
    setUploads((u) => [...u, { key, name: file.name, size: file.size, percent: 0, phase: "sending" }]);
    try {
      await uploadDocument(file, {
        onCreated: (docId) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, docId } : x))),
        onProgress: (percent) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, percent } : x))),
      }, controller.signal);
      setUploads((u) => u.filter((x) => x.key !== key));
      await refresh(); // the document now shows up as "processing"
    } catch (e) {
      if (isAbort(e)) setUploads((u) => u.filter((x) => x.key !== key));
      else patchUpload(key, { phase: "error", error: messageOf(e) });
    } finally {
      controllers.current.delete(key);
    }
  }, [refresh]);

  const handleFiles = useCallback(async (files: File[]) => {
    for (const file of files) await runUpload(file); // one at a time: gentler on the server and on slow links
  }, [runUpload]);

  const cancelUpload = (key: string) => controllers.current.get(key)?.abort();
  const dismissUpload = (key: string) => setUploads((u) => u.filter((x) => x.key !== key));

  // Hide a server row while this browser is still sending it; the upload row represents it.
  const inFlight = new Set(uploads.map((u) => u.docId).filter(Boolean));
  const visible = documents?.filter((d) => !inFlight.has(d.id)) ?? null;

  const selectedDocuments = documents?.filter((doc) => multiSelected.includes(doc.id)) ?? [];

  const library = (
    <>
      <UploadZone config={config} onFiles={handleFiles} />
      <DocumentLibrary
        documents={visible} loadError={error} uploads={uploads} selectedId={selectedId} multiSelectedIds={multiSelected}
        onSelect={select} onToggleMultiSelect={toggleMultiSelect} onDelete={handleDelete} onRetry={() => void refresh()}
        onCancelUpload={cancelUpload} onDismissUpload={dismissUpload} onAskAcrossSelected={handleAskAcrossSelected}
        onCompareSelected={handleCompareSelected}
      />
      {selectedDocuments.length > 0 && (
        <MultiDocumentPane
          selectedDocuments={selectedDocuments.map((doc) => ({ id: doc.id, originalFilename: doc.originalFilename }))}
          onOpenDocument={(docId) => router.push(`/?doc=${docId}`)}
        />
      )}
      {comparison && (
        <section className="rounded-2xl border border-sand bg-paper p-4">
          <h3 className="font-semibold">Contract comparison</h3>
          <p className="mt-2 text-sm leading-6 text-espresso">{comparison.summary}</p>
          <div className="mt-4 space-y-3">
            {comparison.changes.map((change, index) => (
              <div key={`${change.label}-${index}`} className="rounded-xl border border-sand bg-parchment p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{change.label}</p>
                  <span className="rounded-full border border-sand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-taupe">{change.significance}</span>
                </div>
                <p className="mt-2 text-xs text-taupe">Before: {change.oldText}</p>
                <p className="mt-1 text-xs text-taupe">After: {change.newText}</p>
                <p className="mt-2 text-sm leading-6 text-espresso">{change.explanation}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );

  const selected = selectedId ? documents?.find((d) => d.id === selectedId) ?? null : null;
  let view;

  if (!selectedId) {
    view = (
      <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
        <header>
          <h1 className="text-2xl font-semibold">Contract Analyser</h1>
          <p className="mt-1 text-taupe">Ask questions about a contract. Every answer comes with quotes checked against the document.</p>
        </header>
        {library}
      </main>
    );
  } else if (documents === null && !error) {
    view = (
      <div className="flex min-h-screen items-center justify-center gap-2 text-taupe" role="status">
        <Spinner className="h-5 w-5" /><span className="font-mono text-sm">Opening document…</span>
      </div>
    );
  } else if (documents === null) {
    view = (
      <NoticePanel tone="warning" title="Couldn't open this document"
        action={<button className={primaryButton} onClick={() => void refresh()}>Try again</button>}>
        {error}
      </NoticePanel>
    );
  } else if (!selected) {
    view = (
      <NoticePanel title="This document no longer exists"
        action={<button className={primaryButton} onClick={() => router.replace("/")}>Back to your contracts</button>}>
        It may have been deleted. Your other documents are still available.
      </NoticePanel>
    );
  } else if (selected.status !== "ready") {
    view = (
      <NoticePanel tone={selected.status === "failed" ? "warning" : "neutral"}
        title={selected.status === "failed" ? failureTitle(selected.errorCode) : "Still getting this document ready"}
        action={<button className={ghostButton} onClick={() => router.replace("/")}>Back to your contracts</button>}>
        <div className="mb-3 flex items-center justify-center gap-2 text-espresso">
          <FileIcon className="h-4 w-4" /><span className="truncate">{selected.originalFilename}</span>
          <StatusBadge status={selected.status} />
        </div>
        {selected.status === "failed" ? selected.errorMessage : <span className="font-mono text-xs">{processingText(selected.status)}</span>}
      </NoticePanel>
    );
  } else {
    view = <Workspace doc={selected} mobileTab={mobileTab} onMobileTab={setMobileTab} onOpenLibrary={() => router.replace("/")} />;
  }

  return (
    <>
      {view}
      <LibraryDrawer open={drawerOpen && !!selectedId} onClose={() => setDrawerOpen(false)}>{library}</LibraryDrawer>
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </>
  );
}
