import { Suspense } from "react";
import AppShell from "@/components/AppShell";

export default function Home() {
  // useSearchParams (selected document lives in the URL) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  );
}
