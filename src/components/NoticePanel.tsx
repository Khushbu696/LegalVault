import type { ReactNode } from "react";

/** A centered message with an optional action: used for loading failures, deleted docs, etc. */
export function NoticePanel({ title, children, action, tone = "neutral" }: {
  title: string; children?: ReactNode; action?: ReactNode; tone?: "neutral" | "warning";
}) {
  const box = tone === "warning" ? "border-ochre/40 bg-ochre-wash" : "border-sand bg-paper";
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div role={tone === "warning" ? "alert" : undefined} className={`w-full max-w-md rounded-2xl border p-8 text-center ${box}`}>
        <h2 className={`text-lg font-semibold ${tone === "warning" ? "text-ochre-ink" : ""}`}>{title}</h2>
        {children && <div className="mt-2 text-sm text-taupe">{children}</div>}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-sage px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#276b2b] disabled:opacity-50";
export const ghostButton =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-sand bg-paper px-3 py-1.5 text-sm font-medium text-espresso transition-colors hover:bg-parchment disabled:opacity-50";
