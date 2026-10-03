"use client";
import { useState } from "react";
import { AlertIcon, FileIcon, TrashIcon, XIcon } from "./icons";
import { ghostButton, NoticePanel, primaryButton } from "./NoticePanel";
import { StatusBadge } from "./StatusBadge";
import {
  documentMeta, emptyPagesNote, failureTitle, formatBytes, processingText,
} from "@/lib/client/status";
import type { DocumentDTO, UploadItem } from "@/lib/client/types";

interface Props {
  documents: DocumentDTO[] | null;
  loadError: string | null;
  uploads: UploadItem[];
  selectedId: string | null;
  multiSelectedIds: string[];
  onSelect: (id: string) => void;
  onToggleMultiSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRetry: () => void;
  onCancelUpload: (key: string) => void;
  onDismissUpload: (key: string) => void;
}

export function DocumentLibrary(p: Props) {
  const { documents, loadError, uploads } = p;

  if (documents === null && loadError) {
    return (
      <NoticePanel tone="warning" title="Couldn't load your documents"
        action={<button className={primaryButton} onClick={p.onRetry}>Try again</button>}>
        {loadError}
      </NoticePanel>
    );
  }
  if (documents === null) {
    return (
      <ul className="space-y-3" aria-busy="true" aria-label="Loading documents">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-[92px] rounded-xl border border-sand bg-paper p-4">
            <div className="h-4 w-2/3 rounded bg-sand motion-safe:animate-pulse" />
            <div className="mt-3 h-3 w-1/3 rounded bg-sand/70 motion-safe:animate-pulse" />
          </li>
        ))}
      </ul>
    );
  }
  if (documents.length === 0 && uploads.length === 0) {
    return (
      <div className="rounded-2xl border border-sand bg-paper px-6 py-10 text-center">
        <FileIcon className="mx-auto h-8 w-8 text-sand" />
        <h3 className="mt-3 font-semibold">No contracts yet</h3>
        <p className="mt-1 text-sm text-taupe">Upload a contract and you can start asking questions about it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-ochre/40 bg-ochre-wash px-3 py-2 text-sm">
          <span className="text-ochre-ink">Couldn&apos;t refresh your documents.</span>
          <button onClick={p.onRetry} className="font-medium text-ochre-ink underline">Retry</button>
        </div>
      )}
      <ul className="space-y-3">
        {uploads.map((u) => (
          <UploadRow key={u.key} item={u} onCancel={() => p.onCancelUpload(u.key)} onDismiss={() => p.onDismissUpload(u.key)} />
        ))}
        {documents.map((d) => (
          <DocumentRow key={d.id} doc={d} selected={d.id === p.selectedId} multiSelected={p.multiSelectedIds.includes(d.id)}
            onOpen={() => p.onSelect(d.id)} onToggleMultiSelect={() => p.onToggleMultiSelect(d.id)} onDelete={() => p.onDelete(d.id)} />
        ))}
      </ul>
    </div>
  );
}

function UploadRow({ item, onCancel, onDismiss }: { item: UploadItem; onCancel: () => void; onDismiss: () => void }) {
  if (item.phase === "error") {
    return (
      <li className="rounded-xl border border-ochre/40 bg-ochre-wash p-4" role="alert">
        <div className="flex items-start gap-2">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-ochre-ink" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ochre-ink" title={item.name}>Couldn&apos;t upload “{item.name}”</p>
            <p className="mt-1 text-sm">{item.error}</p>
          </div>
          <button onClick={onDismiss} className="text-sm font-medium text-ochre-ink underline">Dismiss</button>
        </div>
      </li>
    );
  }
  return (
    <li className="rounded-xl border border-sand bg-paper p-4">
      <div className="flex items-center gap-3">
        <FileIcon className="h-5 w-5 shrink-0 text-taupe" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={item.name}>{item.name}</p>
          <p className="font-mono text-xs text-taupe" aria-live="polite">Uploading… {item.percent}% of {formatBytes(item.size)}</p>
        </div>
        <button onClick={onCancel} className={ghostButton} aria-label={`Cancel upload of ${item.name}`}>
          <XIcon className="h-3.5 w-3.5" />Cancel
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-sand" role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={item.percent} aria-label={`Uploading ${item.name}`}>
        <div className="h-full bg-sage transition-[width] duration-200" style={{ width: `${item.percent}%` }} />
      </div>
    </li>
  );
}

function DocumentRow({ doc, selected, multiSelected, onOpen, onToggleMultiSelect, onDelete }: {
  doc: DocumentDTO; selected: boolean; multiSelected: boolean; onOpen: () => void; onToggleMultiSelect: () => void; onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ready = doc.status === "ready";
  const failed = doc.status === "failed";
  const note = ready ? emptyPagesNote(doc.emptyPages) : "";

  async function confirmDelete() {
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); setConfirming(false); }
  }

  return (
    <li className={`rounded-xl border bg-paper p-4 shadow-[0_1px_2px_rgba(30,32,34,0.04)] ${selected ? "border-sage" : "border-sand"}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={multiSelected}
          onChange={onToggleMultiSelect}
          aria-label={`Select ${doc.originalFilename} for a multi-document question`}
          className="mt-1 h-4 w-4 accent-sage"
        />
        <FileIcon className="mt-0.5 h-5 w-5 shrink-0 text-taupe" />
        <div className="min-w-0 flex-1">
          {ready ? (
            <button onClick={onOpen} title={doc.originalFilename}
              className="block max-w-full truncate text-left font-medium hover:text-sage hover:underline">
              {doc.originalFilename}
            </button>
          ) : (
            <p className="truncate font-medium" title={doc.originalFilename}>{doc.originalFilename}</p>
          )}
          <p className="mt-0.5 font-mono text-xs text-taupe">{documentMeta(doc)}</p>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      {!ready && !failed && (
        <div className="mt-3" role="status">
          <p className="font-mono text-xs text-taupe">{processingText(doc.status)}</p>
          <div className="mt-2 h-1 overflow-hidden rounded bg-sand">
            <div className="indeterminate-bar h-full w-1/4 rounded bg-sage" />
          </div>
        </div>
      )}

      {failed && (
        <div role="alert" className="mt-3 rounded-lg border border-ochre/40 bg-ochre-wash p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ochre-ink">
            <AlertIcon className="h-4 w-4" />{failureTitle(doc.errorCode)}
          </p>
          <p className="mt-1 text-sm">{doc.errorMessage ?? "Please try uploading the document again."}</p>
        </div>
      )}

      {note && (
        <p role="note" className="mt-3 flex items-start gap-1.5 rounded-lg border border-ochre/40 bg-ochre-wash p-3 text-sm">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-ochre-ink" />{note}
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {confirming ? (
          <>
            <span className="mr-auto text-sm">Delete this document and its chat history?</span>
            <button className={ghostButton} onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
            <button onClick={confirmDelete} disabled={deleting}
              className="inline-flex items-center rounded-lg bg-ochre-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </>
        ) : (
          <>
            {ready && <button className={primaryButton} onClick={onOpen}>Open</button>}
            <button className={ghostButton} onClick={() => setConfirming(true)} aria-label={`Delete ${doc.originalFilename}`}>
              <TrashIcon className="h-3.5 w-3.5" />Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}
