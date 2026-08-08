import BillPrint from "@velocare/ui/screens/BillPrint";

export default async function Page({ params }: { params: Promise<{ billNo: string }> }) {
  const { billNo } = await params;
  return <BillPrint billNo={decodeURIComponent(billNo)} />;
}
