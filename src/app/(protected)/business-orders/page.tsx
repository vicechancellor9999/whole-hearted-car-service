import Link from "next/link";
import { connection } from "next/server";
import { currentSession } from "@/modules/auth/current-session";
import type {
  BusinessOrderRecord,
} from "@/modules/business-order/business-order-service";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import type {
  CompanyContactRecord,
  PageResult,
  VehicleRecord,
} from "@/modules/customer-vehicle/customer-vehicle-service";
import { createCustomerVehicleRuntime } from "@/modules/customer-vehicle/customer-vehicle-runtime";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";
import { RecordPagination } from "@/app/(protected)/customer-vehicle/pagination";
import { businessOrderAction } from "@/app/(protected)/business-orders/actions";

type FormAction = (formData: FormData) => void | Promise<void>;

const statusLabels: Record<BusinessOrderRecord["status"], string> = {
  waiting_assignment: "待派单",
  assigned: "已派单",
  in_repair: "维修中",
  return_pending_review: "回单待审核",
  formally_handed_off: "已交单",
};

export function BusinessOrderListView({
  action = businessOrderAction,
  canWrite,
  companyContactsByCompany,
  error,
  orders,
  search = "",
  success,
  vehicleCandidates,
  vehicleSearch = "",
}: {
  action?: FormAction;
  canWrite: boolean;
  companyContactsByCompany: Record<string, CompanyContactRecord[]>;
  error?: string;
  orders: PageResult<BusinessOrderRecord>;
  search?: string;
  success?: string;
  vehicleCandidates: VehicleRecord[];
  vehicleSearch?: string;
}) {
  return (
    <section className="records-workspace bo-workspace" aria-labelledby="business-orders-title">
      <header className="section-heading">
        <p className="eyebrow">维修业务 · 正式数据</p>
        <h1 id="business-orders-title">Business Order</h1>
        <p>每一张 Business Order 保存车辆、费用承担方、收费版本和独立维修轮次。</p>
      </header>
      {success ? <p className="form-alert success-alert">{success}</p> : null}
      {error ? <p className="form-alert">{error}</p> : null}
      {canWrite ? (
        <section className="record-editor-card bo-create-card">
          <h2>新建 Business Order</h2>
          <form className="record-search" method="get">
            <label>先输入车牌号<input aria-label="先输入车牌号" defaultValue={vehicleSearch} name="vehicleSearch" placeholder="例如 7012 AB" required /></label>
            <button type="submit">查找车辆</button>
          </form>
          {vehicleSearch && vehicleCandidates.length === 0 ? (
            <p className="record-empty">没有找到该车牌。<Link href={`/vehicles?search=${encodeURIComponent(vehicleSearch)}`}>前往新建车辆档案</Link></p>
          ) : null}
          <div className="bo-vehicle-candidates">
            {vehicleCandidates.map((vehicle) => {
              const contacts = vehicle.currentOwner.type === "company"
                ? companyContactsByCompany[String(vehicle.currentOwner.id)] ?? []
                : [];
              return (
                <form action={action} className="bo-vehicle-candidate" key={vehicle.id}>
                  <input name="operation" type="hidden" value="create_business_order" />
                  <input name="vehicleId" type="hidden" value={vehicle.id} />
                  <div><strong>{vehicle.plateDisplay} · {vehicle.make} {vehicle.model}</strong><small>{vehicle.currentOwner.name} · {vehicle.vehicleNo}</small></div>
                  {vehicle.currentOwner.type === "company" ? (
                    <label>公司联系人<select name="companyContactId" required><option value="">选择联系人</option>{contacts.filter((contact) => contact.isActive).map((contact) => <option key={contact.id} value={contact.id}>{contact.personalCustomerName}{contact.jobTitle ? ` · ${contact.jobTitle}` : ""}</option>)}</select></label>
                  ) : null}
                  <button disabled={vehicle.currentOwner.type === "company" && contacts.length === 0} type="submit">创建 Business Order</button>
                </form>
              );
            })}
          </div>
        </section>
      ) : <p className="readonly-notice">老板只读：可查看全部 Business Order，不能创建或修改。</p>}
      <form className="record-search" method="get"><label>搜索 Business Order<input defaultValue={search} name="search" placeholder="编号、车牌或费用承担方" /></label><button type="submit">搜索</button></form>
      <section className="compact-record-table" aria-label="Business Order 列表">
        <div className="compact-record-row compact-record-head bo-list-row"><span>Business Order / 车辆</span><span>费用承担方</span><span>当前流程</span><span>创建时间</span><span>操作</span></div>
        {orders.items.map((order) => (
          <article className="compact-record-row compact-record-item bo-list-row" key={order.id}>
            <span><strong>{order.orderNo}</strong><small>{order.vehicle.plate} · {order.vehicle.description}</small></span>
            <span>{order.payer.displayName}<small>{order.payer.contactName ?? order.payer.phone ?? "联系方式未填"}</small></span>
            <span><em className={`bo-status status-${order.status}`}>{order.voided ? "已作废" : statusLabels[order.status]}</em></span>
            <span>{order.createdAt.toLocaleString("zh-CN", { timeZone: "America/Jamaica", hour12: false })}</span>
            <span><Link className="table-link" href={`/business-orders/${order.id}`}>打开详情</Link></span>
          </article>
        ))}
        {orders.items.length === 0 ? <p className="record-empty">没有符合条件的 Business Order。</p> : null}
      </section>
      <RecordPagination basePath="/business-orders" page={orders.page} pageCount={orders.pageCount} search={search} total={orders.total} />
    </section>
  );
}

export default async function BusinessOrdersPage({ searchParams }: {
  searchParams: Promise<{
    page?: string;
    search?: string;
    vehicleSearch?: string;
    success?: string;
    error?: string;
  }>;
}) {
  await connection();
  const [session, query] = await Promise.all([currentSession(), searchParams]);
  const viewer = requirePermission(session, "business.read.all");
  const [businessRuntime, customerRuntime] = [
    createBusinessOrderRuntime(),
    createCustomerVehicleRuntime(),
  ];
  try {
    const [orders, candidates] = await Promise.all([
      businessRuntime.service.listBusinessOrders({
        viewerAccountId: viewer.id,
        search: query.search,
        page: Number(query.page) || 1,
        pageSize: 20,
      }),
      query.vehicleSearch
        ? customerRuntime.service.listVehicles({
            viewerAccountId: viewer.id,
            search: query.vehicleSearch,
            page: 1,
            pageSize: 10,
          })
        : Promise.resolve({ items: [], page: 1, pageSize: 10, pageCount: 1, total: 0 }),
    ]);
    const companyIds = [...new Set(candidates.items
      .filter((vehicle) => vehicle.currentOwner.type === "company")
      .map((vehicle) => vehicle.currentOwner.id))];
    const contactEntries = await Promise.all(companyIds.map(async (companyId) => [
      String(companyId),
      await customerRuntime.service.listCompanyContacts({
        viewerAccountId: viewer.id,
        companyId,
      }),
    ] as const));
    return (
      <BusinessOrderListView
        canWrite={hasPermission(viewer.role, "business_order.write", viewer.delegatedPermissions)}
        companyContactsByCompany={Object.fromEntries(contactEntries)}
        error={query.error}
        orders={orders}
        search={query.search}
        success={query.success}
        vehicleCandidates={candidates.items}
        vehicleSearch={query.vehicleSearch}
      />
    );
  } finally {
    await Promise.all([businessRuntime.close(), customerRuntime.close()]);
  }
}
