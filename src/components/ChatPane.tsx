"use client";
import type { DocumentDTO } from "@/lib/client/types";

/** Placeholder shell: the real conversation arrives with question answering (Step 7+). */
export function ChatPane({ doc }: { doc: DocumentDTO }) {
  return (
    <section aria-label="Chat" className="flex min-h-0 flex-1 flex-col bg-parchment">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <p className="font-semibold">Ask about this contract</p>
        <p className="mt-1 max-w-xs text-sm text-taupe">
          Answers will use only “{doc.originalFilename}” and come with quotes checked against its text.
        </p>
        <p className="mt-4 rounded-full bg-paper px-3 py-1 font-mono text-xs text-taupe ring-1 ring-sand">
          Chat isn&apos;t switched on yet
        </p>
      </div>
      <div className="border-t border-sand bg-paper p-4">
        <div className="flex gap-2">
          <textarea disabled rows={1} aria-label="Question" placeholder="Ask a question about this document…"
            className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-sand bg-parchment px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60" />
          <button disabled className="rounded-lg bg-sage px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Ask</button>
        </div>
      </div>
    </section>
  );
}
