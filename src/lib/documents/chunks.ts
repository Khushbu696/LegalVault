import type { ChunkRecord, PageRange } from "@/lib/repositories/types";

const CHUNK_TARGET = 1_600;

function pageForOffset(offset: number, pageRanges: PageRange[]): number | null {
  if (pageRanges.length === 0) return null;
  for (const range of pageRanges) {
    if (offset >= range.start && offset <= range.end) return range.page;
  }
  return pageRanges[pageRanges.length - 1].page;
}

export function buildDocumentChunks(text: string, pageRanges: PageRange[] = []): Omit<ChunkRecord, "id">[] {
  const segments = text
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return [];
  }

  const chunks: Omit<ChunkRecord, "id">[] = [];
  let current = "";
  let currentStart = 0;
  let cursor = 0;

  const flush = () => {
    if (!current.trim()) return;
    const startOffset = currentStart;
    const endOffset = startOffset + current.length;
    chunks.push({
      documentId: "",
      chunkIndex: chunks.length,
      text: current.trim(),
      startOffset: startOffset,
      endOffset,
      pageStart: pageForOffset(startOffset, pageRanges),
      pageEnd: pageForOffset(Math.max(0, endOffset - 1), pageRanges),
      sectionHeading: null,
    });
    current = "";
    currentStart = 0;
  };

  for (const segment of segments) {
    const pos = text.indexOf(segment, cursor);
    if (pos === -1) {
      cursor = text.length;
    }

    if (!current) {
      current = segment;
      currentStart = pos === -1 ? cursor : pos;
      cursor = (pos === -1 ? cursor : pos) + segment.length;
      continue;
    }

    if (current.length + segment.length + 2 <= CHUNK_TARGET) {
      current += `\n\n${segment}`;
      cursor = Math.max(cursor, (pos === -1 ? cursor : pos) + segment.length);
      continue;
    }

    flush();
    current = segment;
    currentStart = pos === -1 ? cursor : pos;
    cursor = (pos === -1 ? cursor : pos) + segment.length;
  }

  flush();

  return chunks.map((chunk, index) => ({ ...chunk, documentId: "", chunkIndex: index }));
}
