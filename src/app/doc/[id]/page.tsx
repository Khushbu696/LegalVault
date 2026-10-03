import { DocumentRoute } from "@/components/DocumentRoute";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentRoute documentId={id} />;
}
