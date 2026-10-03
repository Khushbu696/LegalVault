"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listDocuments, messageOf } from "@/lib/client/api";
import { isProcessing } from "@/lib/client/status";
import type { DocumentDTO } from "@/lib/client/types";

export type TransitionEvent = { kind: "ready" | "failed"; doc: DocumentDTO };

/**
 * The library list. `documents === null` means "first load still in progress".
 * Polls every 1.5s only while something is processing, so an idle page makes no requests.
 */
export function useDocuments(onTransition?: (e: TransitionEvent) => void) {
  const [documents, setDocuments] = useState<DocumentDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previous = useRef(new Map<string, DocumentDTO["status"]>());
  const callback = useRef(onTransition);
  useEffect(() => { callback.current = onTransition; });

  const refresh = useCallback(async () => {
    try {
      const docs = await listDocuments();
      // Detect "was processing, now finished" so the UI can announce it exactly once.
      for (const d of docs) {
        const before = previous.current.get(d.id);
        if (before && isProcessing(before) && d.status === "ready") callback.current?.({ kind: "ready", doc: d });
        if (before && isProcessing(before) && d.status === "failed") callback.current?.({ kind: "failed", doc: d });
      }
      previous.current = new Map(docs.map((d) => [d.id, d.status]));
      setDocuments(docs);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const active = documents?.some((d) => isProcessing(d.status)) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const removeLocal = useCallback((id: string) => {
    previous.current.delete(id);
    setDocuments((docs) => docs?.filter((d) => d.id !== id) ?? docs);
  }, []);

  return { documents, error, refresh, removeLocal };
}
