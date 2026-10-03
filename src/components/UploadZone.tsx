"use client";
import { useRef, useState } from "react";
import { UploadIcon } from "./icons";
import { primaryButton } from "./NoticePanel";
import { formatBytes } from "@/lib/client/status";
import type { AppConfigDTO } from "@/lib/client/types";

const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function UploadZone({ config, onFiles }: { config: AppConfigDTO | null; onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(Array.from(e.dataTransfer.files)); }}
      className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
        dragging ? "border-sage bg-sage-wash" : "border-sand bg-paper"
      }`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage-wash text-sage">
        <UploadIcon className="h-5 w-5" />
      </span>
      <div>
        <p className="font-medium">
          Drop your contracts here{config ? ` (PDF or DOCX up to ${config.maxPages} pages)` : " (PDF or DOCX)"}
        </p>
        {config && <p className="mt-1 font-mono text-xs text-taupe">Up to {formatBytes(config.maxUploadBytes)} per file</p>}
      </div>
      <button type="button" className={primaryButton} onClick={() => input.current?.click()}>
        Choose files
      </button>
      <input
        ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose contract files"
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
      />
    </div>
  );
}
