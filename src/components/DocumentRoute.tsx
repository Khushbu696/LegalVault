"use client";
import { useRouter } from "next/navigation";
import { useDocuments } from "@/hooks/useDocuments";
import { failureTitle, processingText } from "@/lib/client/status";
import { NoticePanel, primaryButton } from "./NoticePanel";
import { FileIcon, Spinner } from "./icons";
import { StatusBadge } from "./StatusBadge";
import { SplitScreen } from "./SplitScreen";
import { Workspace } from "./Workspace";

export function DocumentRoute({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { documents, error, refresh } = useDocuments();
  const doc = documents?.find((item) => item.id === documentId) ?? null;

  if (documents && doc?.status === "ready") {
    return <Workspace doc={doc} onOpenLibrary={() => router.push("/")} />;
  }

  const title = doc?.originalFilename ?? "Contract workspace";
  const status = documents === null && !error
    ? <div className="flex items-center gap-2"><Spinner /><span>Opening document…</span></div>
    : error
      ? <NoticePanel tone="warning" title="Couldn't load your contracts" action={<button className={primaryButton} onClick={() => void refresh()}>Try again</button>}>{error}</NoticePanel>
      : !doc
        ? <NoticePanel title="This document no longer exists" action={<button className={primaryButton} onClick={() => router.push("/")}>Back to contracts</button>}>It may have been deleted or is unavailable.</NoticePanel>
        : <NoticePanel tone={doc.status === "failed" ? "warning" : "neutral"} title={doc.status === "failed" ? failureTitle(doc.errorCode) : "Still getting this document ready"} action={<button className={primaryButton} onClick={() => router.push("/")}>Back to contracts</button>}>
          <div className="mb-3 flex items-center justify-center gap-2"><FileIcon /><span className="truncate">{doc.originalFilename}</span><StatusBadge status={doc.status} /></div>
          {doc.status === "failed" ? doc.errorMessage : processingText(doc.status)}
        </NoticePanel>;

  return (
    <SplitScreen
      title={title}
      onBack={() => router.push("/")}
      leftLabel="Chat"
      rightLabel="Reader"
      left={<div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6 text-center text-sm text-taupe">{status}</div>}
      right={(
        <div className="flex min-h-0 flex-1 items-center justify-center bg-paper p-6 text-center text-sm text-taupe">
          {doc?.status === "failed" || error || (documents && !doc)
            ? "Document text is unavailable. Return to the library to choose another contract."
            : <div className="w-full max-w-2xl space-y-3" aria-label="Document loading">{[90, 100, 75, 95, 65].map((width, index) => <div key={index} className="h-4 animate-pulse rounded bg-sand/60" style={{ width: `${width}%` }} />)}</div>}
        </div>
      )}
    />
  );
}
