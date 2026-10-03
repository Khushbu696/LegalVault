"use client";
import { AlertIcon, CheckIcon, XIcon } from "./icons";

export interface Toast { id: string; kind: "success" | "error" | "info"; text: string }

const styles: Record<Toast["kind"], string> = {
  success: "border-sage/30 bg-sage-wash text-espresso",
  error: "border-ochre/40 bg-ochre-wash text-espresso",
  info: "border-sand bg-paper text-espresso",
};

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg ${styles[t.kind]}`}>
          {t.kind === "success" && <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-sage" />}
          {t.kind === "error" && <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-ochre-ink" />}
          <p className="min-w-0 flex-1 break-words">{t.text}</p>
          <button onClick={() => onDismiss(t.id)} aria-label="Dismiss notification" className="rounded p-0.5 text-taupe hover:text-espresso">
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
