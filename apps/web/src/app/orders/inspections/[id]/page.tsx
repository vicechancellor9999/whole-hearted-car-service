import { FormalInspectionReportDetailView } from "@/components/orders/formal-inspection-report-detail";

export default async function InspectionReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inspectionReportId = Number(id);
  if (!Number.isSafeInteger(inspectionReportId) || inspectionReportId < 1) return <div className="p-6 text-sm font-semibold text-rose-600">Inspection Report 编号无效。</div>;
  return <FormalInspectionReportDetailView inspectionReportId={inspectionReportId} />;
}
