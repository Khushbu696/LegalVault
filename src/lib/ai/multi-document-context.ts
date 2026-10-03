import { buildDocumentChunks } from "@/lib/documents/chunks";
import type { ChunkRecord, DocumentRecord } from "@/lib/repositories/types";
import { buildChunkContext, retrieveRelevantChunks } from "./retrieval";

type ContextDocument = Pick<DocumentRecord, "id" | "extractedText" | "pageRanges">;

export function buildMultiDocumentContext(
  question: string,
  document: ContextDocument,
  storedChunks: ChunkRecord[],
): { excerpt: string; selectedChunks: ChunkRecord[] } {
  const usableStoredChunks = storedChunks.filter((chunk) => chunk.text.trim().length > 0);
  const chunks: ChunkRecord[] = usableStoredChunks.length > 0
    ? usableStoredChunks
    : buildDocumentChunks(document.extractedText ?? "", document.pageRanges).map((chunk, index) => ({
      ...chunk,
      id: `${document.id}-reconstructed-${index}`,
      documentId: document.id,
      sectionHeading: chunk.sectionHeading ?? null,
    }));

  const relevant = retrieveRelevantChunks(question, chunks);
  return { excerpt: buildChunkContext(relevant.selected), selectedChunks: relevant.selected };
}

export function buildMultiDocumentExcerpt(
  question: string,
  document: ContextDocument,
  storedChunks: ChunkRecord[],
): string {
  return buildMultiDocumentContext(question, document, storedChunks).excerpt;
}
