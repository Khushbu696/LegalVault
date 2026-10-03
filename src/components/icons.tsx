import type { ReactNode } from "react";

function Icon({ children, className = "h-4 w-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
      strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}
type P = { className?: string };

export const FileIcon = (p: P) => <Icon {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>;
export const TrashIcon = (p: P) => <Icon {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Icon>;
export const UploadIcon = (p: P) => <Icon {...p}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></Icon>;
export const XIcon = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const AlertIcon = (p: P) => <Icon {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.01" /></Icon>;
export const CheckIcon = (p: P) => <Icon {...p}><path d="M5 12l4 4 10-10" /></Icon>;
export const ArrowLeftIcon = (p: P) => <Icon {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Icon>;
export const LibraryIcon = (p: P) => <Icon {...p}><path d="M4 6h5l2 2h9v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /></Icon>;
export const Spinner = ({ className = "h-3.5 w-3.5" }: P) => (
  <Icon className={`${className} motion-safe:animate-spin`}><circle cx="12" cy="12" r="9" opacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" /></Icon>
);
