"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DocumentLibrary } from "./DocumentLibrary";
import { ghostButton, primaryButton } from "./NoticePanel";
import { Toasts, type Toast } from "./Toasts";
import { UploadZone } from "./UploadZone";
import { useDocuments, type TransitionEvent } from "@/hooks/useDocuments";
import { deleteDocument, getConfig, isAbort, messageOf } from "@/lib/client/api";
import { failureTitle } from "@/lib/client/status";
import type { AppConfigDTO, UploadItem } from "@/lib/client/types";
import { uploadDocument } from "@/lib/client/upload";

export default function AppShell() {
  const router = useRouter();
  const selectedId = useSearchParams().get("doc");

  const [config, setConfig] = useState<AppConfigDTO | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
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
  }, []);

  useEffect(() => { getConfig().then(setConfig).catch(() => undefined); }, []); // server still validates if this fails

  const select = useCallback((id: string) => router.push(`/doc/${encodeURIComponent(id)}`), [router]);

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

  const library = (
    <>
      <UploadZone config={config} onFiles={handleFiles} />
      <DocumentLibrary
        documents={visible} loadError={error} uploads={uploads} selectedId={selectedId} multiSelectedIds={multiSelected}
        onSelect={select} onToggleMultiSelect={toggleMultiSelect} onDelete={handleDelete} onRetry={() => void refresh()}
        onCancelUpload={cancelUpload} onDismissUpload={dismissUpload}
      />
    </>
  );

  return (
    <>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 pb-32">
        <header>
          <h1 className="text-2xl font-semibold">Legal Vault</h1>
          <p className="mt-1 text-taupe">Analyze, compare, and understand your contracts.</p>
        </header>
        {library}
      </main>
      {multiSelected.length >= 2 && (
        <div className="fixed inset-x-4 bottom-5 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-3 rounded-xl border border-sand bg-paper/95 px-4 py-3 shadow-xl backdrop-blur">
          <span className="text-sm font-semibold">{multiSelected.length} contracts selected</span>
          <button className={primaryButton} type="button" onClick={() => router.push(`/multi-chat?ids=${multiSelected.map(encodeURIComponent).join(",")}`)}>Ask Across Selected</button>
          <button className={ghostButton} type="button" onClick={() => {
            const ids = multiSelected.slice(0, 2).map(encodeURIComponent);
            router.push(`/compare?docA=${ids[0]}&docB=${ids[1]}`);
          }}>Compare Contracts</button>
          <button className="text-sm text-taupe underline underline-offset-2" type="button" onClick={() => setMultiSelected([])}>Clear selection</button>
        </div>
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </>
  );
}
