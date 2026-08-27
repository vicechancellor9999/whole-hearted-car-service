import { connection } from "next/server";
import type { CompanyAccountRecord, PageResult, PersonalCustomerRecord, VehicleAttachmentRecord, VehicleRecord } from "@/modules/customer-vehicle/customer-vehicle-service";
import { createCustomerVehicleRuntime } from "@/modules/customer-vehicle/customer-vehicle-runtime";
import { currentSession } from "@/modules/auth/current-session";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";
import { customerVehicleAction } from "@/app/(protected)/customer-vehicle/actions";
import { RecordPagination } from "@/app/(protected)/customer-vehicle/pagination";

type FormAction = (formData: FormData) => void | Promise<void>;

function OwnerOptions({ people, companies }: { people: PersonalCustomerRecord[]; companies: CompanyAccountRecord[] }) {
  return <><option value="">请选择当前费用承担方</option><optgroup label="个人客户">{people.map((person) => <option key={`person-${person.id}`} value={`person:${person.id}`}>{person.fullName} · {person.customerNo}</option>)}</optgroup><optgroup label="公司账户">{companies.map((company) => <option key={`company-${company.id}`} value={`company:${company.id}`}>{company.legalName} · {company.companyNo}</option>)}</optgroup></>;
}

export function VehiclesView({
  vehicles, people, companies, canWrite, search = "", success, error,
  ownerSearch = "", peopleCandidateTotal, companyCandidateTotal,
  attachmentsByVehicle = {},
  action = customerVehicleAction,
}: {
  vehicles: PageResult<VehicleRecord>; people: PersonalCustomerRecord[];
  companies: CompanyAccountRecord[]; canWrite: boolean; search?: string;
  ownerSearch?: string; peopleCandidateTotal?: number; companyCandidateTotal?: number;
  attachmentsByVehicle?: Partial<Record<string, VehicleAttachmentRecord[]>>;
  success?: string; error?: string; action?: FormAction;
}) {
  return (
    <section className="records-workspace" aria-labelledby="vehicles-title">
      <header className="section-heading"><p className="eyebrow">客户与车辆 · 正式数据</p><h1 id="vehicles-title">车辆档案</h1><p>车牌规范化后全系统唯一；车辆当前只归属一个个人客户或公司账户，变更时保留历史。</p></header>
      {success ? <p className="form-alert success-alert">{success}</p> : null}{error ? <p className="form-alert">{error}</p> : null}
      {canWrite ? <section className="record-editor-card"><h2>新增车辆</h2><form action={action} className="record-form record-form-eight">
        <input name="operation" type="hidden" value="create_vehicle" /><label>车牌（可空）<input name="plate" /></label><label>VIN<input name="vin" /></label><label>发动机号<input name="engineNumber" /></label><label>品牌<input name="make" required /></label><label>品牌中文<input name="makeZh" /></label><label>车型<input name="model" required /></label><label>车型中文<input name="modelZh" /></label><label>年份<input max="2200" min="1886" name="modelYear" type="number" /></label><label>颜色<input name="color" /></label><label>车身类型<input name="bodyType" /></label><label>燃料类型<input name="fuelType" /></label><label>排量 CC<input max="30000" min="1" name="engineCc" type="number" /></label><label>座位数<input max="200" min="1" name="seating" type="number" /></label><label>用途<input name="usage" /></label><label>特别备注<textarea name="specialNotes" /></label><label>当前费用承担方<select name="ownerRef" required><OwnerOptions companies={companies} people={people} /></select></label><button type="submit">创建车辆档案</button>
      </form></section> : null}
      <form className="record-search" method="get"><label>搜索车辆<input defaultValue={search} name="search" placeholder="车牌、VIN、品牌或车型" /></label><button type="submit">搜索</button></form>
      {canWrite ? <form className="record-search candidate-search" method="get"><input name="search" type="hidden" value={search} /><label>查找费用承担方<input defaultValue={ownerSearch} name="ownerSearch" placeholder="个人姓名/手机号/TRN，或公司名称/TRN" /></label><button type="submit">查找费用承担方</button><small>个人候选 {people.length} / {peopleCandidateTotal ?? people.length}；公司候选 {companies.length} / {companyCandidateTotal ?? companies.length}。输入关键词可查找全部档案。</small></form> : null}
      <section className="record-card-list">
        {vehicles.items.map((vehicle) => <article className="record-detail-card" key={vehicle.id}>
          <header><div><strong>{vehicle.plateDisplay ?? "车牌待补"} · {vehicle.make} {vehicle.model}</strong><small>{vehicle.vehicleNo} · {vehicle.modelYear ?? "年份未填"} · {vehicle.color ?? "颜色未填"}</small></div><span className={vehicle.hasOpenDispute ? "dispute-badge" : ""}>{vehicle.hasOpenDispute ? "客户争议中" : vehicle.isActive ? "启用" : "停用"}</span></header>
          <div className="record-summary"><span>当前费用承担方：{vehicle.currentOwner.name ?? `${vehicle.currentOwner.type === "person" ? "个人" : "公司"} #${vehicle.currentOwner.id}`}</span><span>VIN：{vehicle.vin ?? "未填写"}</span></div>
          <div className="attachment-strip"><strong>车辆附件</strong>{(attachmentsByVehicle[String(vehicle.id)] ?? []).map((attachment) => <a href={`/api/vehicle-attachments/${attachment.fileId}`} key={attachment.fileId} rel="noreferrer" target="_blank">{attachment.originalName} · {attachment.kind === "photo" ? "照片" : attachment.kind === "dispute_evidence" ? "争议凭证" : "文档"} · {Math.max(1, Math.ceil(attachment.sizeBytes / 1024))} KB{attachment.caption ? ` · ${attachment.caption}` : ""}</a>)}{(attachmentsByVehicle[String(vehicle.id)] ?? []).length === 0 ? <span>尚无附件</span> : null}</div>
          {canWrite ? <div className="record-detail-actions">
            <details><summary>修改车辆资料</summary><form action={action} className="record-form record-inline-editor"><input name="operation" type="hidden" value="update_vehicle" /><input name="vehicleId" type="hidden" value={vehicle.id} /><input name="version" type="hidden" value={vehicle.version} /><label>车牌（可空）<input defaultValue={vehicle.plateDisplay ?? ""} name="plate" /></label><label>VIN<input defaultValue={vehicle.vin ?? ""} name="vin" /></label><label>发动机号<input defaultValue={vehicle.engineNumber ?? ""} name="engineNumber" /></label><label>品牌<input defaultValue={vehicle.make} name="make" required /></label><label>品牌中文<input defaultValue={vehicle.makeZh ?? ""} name="makeZh" /></label><label>车型<input defaultValue={vehicle.model} name="model" required /></label><label>车型中文<input defaultValue={vehicle.modelZh ?? ""} name="modelZh" /></label><label>年份<input defaultValue={vehicle.modelYear ?? ""} max="2200" min="1886" name="modelYear" type="number" /></label><label>颜色<input defaultValue={vehicle.color ?? ""} name="color" /></label><label>车身类型<input defaultValue={vehicle.bodyType ?? ""} name="bodyType" /></label><label>燃料类型<input defaultValue={vehicle.fuelType ?? ""} name="fuelType" /></label><label>排量 CC<input defaultValue={vehicle.engineCc ?? ""} max="30000" min="1" name="engineCc" type="number" /></label><label>座位数<input defaultValue={vehicle.seating ?? ""} max="200" min="1" name="seating" type="number" /></label><label>用途<input defaultValue={vehicle.usage ?? ""} name="usage" /></label><label>特别备注<textarea defaultValue={vehicle.specialNotes ?? ""} name="specialNotes" /></label><label>档案状态<select defaultValue={String(vehicle.isActive)} name="isActive"><option value="true">启用</option><option value="false">停用</option></select></label><button type="submit">保存车辆资料</button></form></details>
            <details><summary>变更车辆归属</summary><form action={action} className="record-form record-owner-form"><input name="operation" type="hidden" value="change_owner" /><input name="vehicleId" type="hidden" value={vehicle.id} /><label>新的费用承担方<select name="ownerRef" required><OwnerOptions companies={companies} people={people} /></select></label><label>变更原因<input name="reason" required /></label><button type="submit">确认变更归属</button></form></details>
            {vehicle.openDisputeId ? <details><summary>解决客户争议</summary><form action={action} className="record-form record-owner-form"><input name="operation" type="hidden" value="resolve_dispute" /><input name="disputeId" type="hidden" value={vehicle.openDisputeId} /><label>解决时间与结果备注<textarea name="note" required /></label><button type="submit">记录争议解决</button></form></details> : <details><summary>记录客户争议</summary><form action={action} className="record-form record-owner-form"><input name="operation" type="hidden" value="open_dispute" /><input name="vehicleId" type="hidden" value={vehicle.id} /><label>争议发生情况与备注<textarea name="note" required /></label><button type="submit">记录客户争议</button></form></details>}
            <details><summary>上传车辆附件</summary><form action={action} className="record-form record-attachment-form"><input name="operation" type="hidden" value="upload_attachment" /><input name="vehicleId" type="hidden" value={vehicle.id} /><label>附件类型<select defaultValue="photo" name="kind"><option value="photo">车辆照片</option><option value="document">车辆文档</option><option value="dispute_evidence">争议凭证</option></select></label><label>选择文件<input accept="image/jpeg,image/png,image/webp,application/pdf" name="file" required type="file" /></label><label>说明<input name="caption" /></label><button type="submit">上传并归档附件</button></form></details>
          </div> : null}
        </article>)}
        {vehicles.items.length === 0 ? <p className="record-empty">没有符合条件的车辆档案。</p> : null}
      </section>
      <RecordPagination basePath="/vehicles" page={vehicles.page} pageCount={vehicles.pageCount} search={search} total={vehicles.total} />
    </section>
  );
}

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; ownerSearch?: string; success?: string; error?: string }> }) {
  await connection();
  const [session, query] = await Promise.all([currentSession(), searchParams]);
  const viewer = requirePermission(session, "customer_vehicle.read");
  const runtime = createCustomerVehicleRuntime();
  try {
    const [vehicles, people, companies] = await Promise.all([
      runtime.service.listVehicles({ viewerAccountId: viewer.id, search: query.search, page: Number(query.page) || 1, pageSize: 20 }),
      runtime.service.listPersonalCustomers({ viewerAccountId: viewer.id, search: query.ownerSearch, page: 1, pageSize: 30 }),
      runtime.service.listCompanyAccounts({ viewerAccountId: viewer.id, search: query.ownerSearch, page: 1, pageSize: 30 }),
    ]);
    const attachments = await runtime.service.listVehicleAttachments({
      viewerAccountId: viewer.id,
      vehicleIds: vehicles.items.map((vehicle) => vehicle.id),
    });
    const attachmentsByVehicle = Object.groupBy(attachments, (attachment) => String(attachment.vehicleId));
    return <VehiclesView attachmentsByVehicle={attachmentsByVehicle} canWrite={hasPermission(viewer.role, "customer_vehicle.write")} companies={companies.items} companyCandidateTotal={companies.total} error={query.error} ownerSearch={query.ownerSearch} people={people.items} peopleCandidateTotal={people.total} search={query.search} success={query.success} vehicles={vehicles} />;
  } finally { await runtime.close(); }
}
