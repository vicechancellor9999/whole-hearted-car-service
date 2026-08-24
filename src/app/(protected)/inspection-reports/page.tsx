import Link from "next/link";
import { connection } from "next/server";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import type { InspectionReportRecord } from "@/modules/inspection-report/inspection-report-service";
import { createCustomerVehicleRuntime } from "@/modules/customer-vehicle/customer-vehicle-runtime";
import type { VehicleRecord } from "@/modules/customer-vehicle/customer-vehicle-service";
import { createMasterDataRuntime } from "@/modules/master-data/master-data-runtime";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";
import { inspectionReportAction } from "@/app/(protected)/inspection-reports/actions";

type FormAction = (formData: FormData) => void | Promise<void>;

export function InspectionReportsView({
  action = inspectionReportAction,
  canWrite,
  error,
  mechanics,
  reports,
  selectedVehicleId,
  sourceBusinessOrderId,
  sourceRepairRoundId,
  success,
  vehicleCandidates,
  vehicleSearch = "",
}: {
  action?: FormAction;
  canWrite: boolean;
  error?: string;
  mechanics: Array<{ id: number; fullName: string }>;
  reports: InspectionReportRecord[];
  selectedVehicleId: number | null;
  sourceBusinessOrderId?: number | null;
  sourceRepairRoundId?: number | null;
  success?: string;
  vehicleCandidates: VehicleRecord[];
  vehicleSearch?: string;
}) {
  return (
    <section className="records-workspace ir-workspace" aria-labelledby="inspection-reports-title">
      <header className="section-heading"><p className="eyebrow">车辆检查成果 · 独立事实</p><h1 id="inspection-reports-title">Inspection Report</h1><p>每份报告只强制归属于车辆；来源 Business Order 和维修轮次仅用于追溯。</p></header>
      {success ? <p className="form-alert success-alert">{success}</p> : null}{error ? <p className="form-alert">{error}</p> : null}
      <form className="record-search" method="get"><label>按车牌查找车辆<input defaultValue={vehicleSearch} name="vehicleSearch" placeholder="输入车牌号" /></label><button type="submit">查找车辆</button></form>
      {vehicleCandidates.length > 0 ? <div className="bo-vehicle-candidates">{vehicleCandidates.map((vehicle) => <Link className="bo-vehicle-candidate" href={`/inspection-reports?vehicleId=${vehicle.id}`} key={vehicle.id}><strong>{vehicle.plateDisplay} · {vehicle.make} {vehicle.model}</strong><small>{vehicle.currentOwner.name}</small></Link>)}</div> : null}
      {canWrite && selectedVehicleId ? (
        <section className="record-editor-card"><h2>新建 Inspection Report 草稿</h2><form action={action} className="record-form ir-create-form">
          <input name="operation" type="hidden" value="create_inspection_report" /><input name="vehicleId" type="hidden" value={selectedVehicleId} />
          <input name="sourceBusinessOrderId" type="hidden" value={sourceBusinessOrderId ?? ""} /><input name="sourceRepairRoundId" type="hidden" value={sourceRepairRoundId ?? ""} />
          <label>实际检查人<select name="actualInspectorStaffMemberId" required><option value="">选择维修工</option>{mechanics.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
          <label>中文摘要<textarea name="summaryZh" required /></label><label>English summary<textarea name="summaryEn" /></label>
          <label>检查发现（中文）<textarea name="findingZh" /></label><label>Finding (English)<textarea name="findingEn" /></label>
          <label>处理建议（中文）<textarea name="recommendationZh" /></label><label>Recommendation (English)<textarea name="recommendationEn" /></label>
          <button type="submit">创建独立检查报告</button>
        </form></section>
      ) : null}
      {!selectedVehicleId ? <p className="record-empty">先选择车辆，再查看或新建该车辆的 Inspection Report。</p> : null}
      <section className="record-card-list" aria-label="Inspection Report 列表">
        {reports.map((report) => <article className="record-detail-card" key={report.id}><header><div><strong>{report.reportNo}</strong><small>{report.createdAt.toLocaleString("zh-CN", { timeZone: "America/Jamaica", hour12: false })} · {report.sourceBusinessOrderId ? `来源 Business Order #${report.sourceBusinessOrderId}` : "独立车辆检查"}</small></div><span>{report.status === "submitted" ? "已提交" : "草稿"}</span></header><div className="record-summary"><span>{report.summaryZh}</span><span>{report.summaryEn}</span><span>检查发现 {report.findings.length} 项</span></div>{canWrite && report.status === "draft" ? <form action={action} className="record-detail-actions"><input name="operation" type="hidden" value="submit_inspection_report" /><input name="vehicleId" type="hidden" value={report.vehicleId} /><input name="inspectionReportId" type="hidden" value={report.id} /><input name="expectedVersion" type="hidden" value={report.version} /><button type="submit">提交并归档</button></form> : null}</article>)}
        {selectedVehicleId && reports.length === 0 ? <p className="record-empty">这辆车尚无 Inspection Report。</p> : null}
      </section>
    </section>
  );
}

export default async function InspectionReportsPage({ searchParams }: {
  searchParams: Promise<{ vehicleId?: string; vehicleSearch?: string; businessOrderId?: string; repairRoundId?: string; success?: string; error?: string }>;
}) {
  await connection();
  const [session, query] = await Promise.all([currentSession(), searchParams]);
  const viewer = requirePermission(session, "business.read.all");
  const selectedVehicleId = Number(query.vehicleId) || null;
  const [businessRuntime, customerRuntime, masterRuntime] = [createBusinessOrderRuntime(), createCustomerVehicleRuntime(), createMasterDataRuntime()];
  try {
    const [reportPage, candidates, staff] = await Promise.all([
      selectedVehicleId ? businessRuntime.inspectionReports.listVehicleInspectionReports({ vehicleId: selectedVehicleId, viewerAccountId: viewer.id, page: 1, pageSize: 50 }) : Promise.resolve({ items: [], page: 1, pageSize: 50, pageCount: 1, total: 0 }),
      query.vehicleSearch ? customerRuntime.service.listVehicles({ viewerAccountId: viewer.id, search: query.vehicleSearch, page: 1, pageSize: 10 }) : Promise.resolve({ items: [], page: 1, pageSize: 10, pageCount: 1, total: 0 }),
      masterRuntime.service.listStaffMembers({ viewerAccountId: viewer.id }),
    ]);
    return <InspectionReportsView canWrite={hasPermission(viewer.role, "business_order.write", viewer.delegatedPermissions)} error={query.error} mechanics={staff.filter((member) => member.status === "active").map((member) => ({ id: member.id, fullName: member.fullName }))} reports={reportPage.items} selectedVehicleId={selectedVehicleId} sourceBusinessOrderId={Number(query.businessOrderId) || null} sourceRepairRoundId={Number(query.repairRoundId) || null} success={query.success} vehicleCandidates={candidates.items} vehicleSearch={query.vehicleSearch} />;
  } finally {
    await Promise.all([businessRuntime.close(), customerRuntime.close(), masterRuntime.close()]);
  }
}
