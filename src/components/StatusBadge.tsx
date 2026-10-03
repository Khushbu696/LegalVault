import { CheckIcon, AlertIcon, Spinner } from "./icons";
import type { DocumentDTO } from "@/lib/client/types";

const base = "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium";

export function StatusBadge({ status }: { status: DocumentDTO["status"] }) {
  if (status === "ready") {
    return <span className={`${base} bg-sage-wash text-sage`}><CheckIcon className="h-3 w-3" />Ready</span>;
  }
  if (status === "failed") {
    return <span className={`${base} bg-ochre-wash text-ochre-ink`}><AlertIcon className="h-3 w-3" />Failed</span>;
  }
  return <span className={`${base} bg-parchment text-taupe ring-1 ring-sand`}><Spinner className="h-3 w-3" />Processing</span>;
}
