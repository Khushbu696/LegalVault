import { ApiError, apiErrorFrom, isAbort, request } from "./api";

interface Callbacks {
  onCreated?: (docId: string) => void;
  onProgress: (percent: number) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One part via XHR (fetch can't report upload progress). */
function putPart(url: string, blob: Blob, signal: AbortSignal, onBytes: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    const done = () => signal.removeEventListener("abort", onAbort);

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onBytes(e.loaded); };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(apiErrorFrom(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => { done(); reject(new ApiError("NETWORK", "Can't reach the server. Check your connection and try again.")); };
    xhr.onabort = () => { done(); reject(new DOMException("Aborted", "AbortError")); };
    xhr.send(blob);
  });
}

/**
 * Chunked upload: validate -> send 3 MB parts (each retried) -> complete.
 * Resolves with the document id once the server has accepted it for processing.
 * On failure or cancel after the document was created, the half-made document is deleted.
 */
export async function uploadDocument(file: File, cb: Callbacks, signal: AbortSignal): Promise<string> {
  const created = await request<{ id: string; partSize: number; totalParts: number }>("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, size: file.size }),
    signal,
  });
  cb.onCreated?.(created.id);

  try {
    let sent = 0;
    for (let i = 0; i < created.totalParts; i++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const part = file.slice(i * created.partSize, Math.min((i + 1) * created.partSize, file.size));
      for (let attempt = 1; ; attempt++) {
        try {
          await putPart(`/api/documents/${created.id}/parts/${i}`, part, signal, (loaded) =>
            cb.onProgress(Math.min(99, Math.round(((sent + loaded) / file.size) * 100))),
          );
          break;
        } catch (e) {
          const retriable = !isAbort(e) && (!(e instanceof ApiError) || e.status === 0 || e.status >= 500);
          if (!retriable || attempt >= 3) throw e;
          await sleep(500 * attempt);
        }
      }
      sent += part.size;
      cb.onProgress(Math.min(99, Math.round((sent / file.size) * 100)));
    }
    await request(`/api/documents/${created.id}/complete`, { method: "POST", signal });
    cb.onProgress(100);
    return created.id;
  } catch (e) {
    request(`/api/documents/${created.id}`, { method: "DELETE" }).catch(() => undefined);
    throw e;
  }
}
