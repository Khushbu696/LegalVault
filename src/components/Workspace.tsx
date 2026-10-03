"use client";
import { useState } from "react";
import { ChatPane } from "./ChatPane";
import { ReaderPane } from "./ReaderPane";
import { StatusBadge } from "./StatusBadge";
import { SplitScreen } from "./SplitScreen";
import type { DocumentDTO } from "@/lib/client/types";

interface Props {
  doc: DocumentDTO;
  onOpenLibrary: () => void;
}

export function Workspace({ doc, onOpenLibrary }: Props) {
  const [quoteFocus, setQuoteFocus] = useState<{ startOffset: number; endOffset: number } | null>(null);

  return (
    <SplitScreen
      title={doc.originalFilename}
      onBack={onOpenLibrary}
      headerAside={<StatusBadge status={doc.status} />}
      leftLabel="Chat"
      rightLabel="Reader"
      left={<ChatPane doc={doc} onQuoteSelect={setQuoteFocus} />}
      right={<ReaderPane key={doc.id} doc={doc} highlight={quoteFocus} />}
    />
  );
}
