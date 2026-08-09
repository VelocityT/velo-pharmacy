import AdjustmentDetail from "@velocare/ui/screens/AdjustmentDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdjustmentDetail id={id} />;
}
