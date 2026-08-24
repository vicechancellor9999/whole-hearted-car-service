import { connection } from "next/server";
import type { PageResult, PersonalCustomerRecord } from "@/modules/customer-vehicle/customer-vehicle-service";
import { createCustomerVehicleRuntime } from "@/modules/customer-vehicle/customer-vehicle-runtime";
import { currentSession } from "@/modules/auth/current-session";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";
import { customerVehicleAction } from "@/app/(protected)/customer-vehicle/actions";
import { RecordPagination } from "@/app/(protected)/customer-vehicle/pagination";

type FormAction = (formData: FormData) => void | Promise<void>;

export function CustomersView({
  page,
  canWrite,
  search = "",
  success,
  error,
  action = customerVehicleAction,
}: {
  page: PageResult<PersonalCustomerRecord>;
  canWrite: boolean;
  search?: string;
  success?: string;
  error?: string;
  action?: FormAction;
}) {
  return (
    <section className="records-workspace" aria-labelledby="customers-title">
      <header className="section-heading">
        <p className="eyebrow">客户与车辆 · 正式数据</p>
        <h1 id="customers-title">个人客户档案</h1>
        <p>TRN 可不填；没有 TRN 时以规范化手机号防止重复建档。</p>
      </header>
      {success ? <p className="form-alert success-alert">{success}</p> : null}
      {error ? <p className="form-alert">{error}</p> : null}
      {canWrite ? (
        <section className="record-editor-card">
          <h2>新增个人客户</h2>
          <form action={action} className="record-form record-form-six">
            <input name="operation" type="hidden" value="create_person" />
            <label>姓名<input name="fullName" required /></label>
            <label>手机号<input name="phone" /></label>
            <label>TRN<input inputMode="numeric" name="trn" /></label>
            <label>WhatsApp<input name="whatsapp" /></label>
            <label>邮箱<input name="email" type="email" /></label>
            <label>地址<input name="address" /></label>
            <button type="submit">创建个人客户</button>
          </form>
        </section>
      ) : null}
      <form className="record-search" method="get">
        <label>搜索客户<input defaultValue={search} name="search" placeholder="姓名、手机号、TRN 或客户编号" /></label>
        <button type="submit">搜索</button>
      </form>
      <section className="compact-record-table" aria-label="个人客户列表">
        <header className="compact-record-row compact-record-head">
          <span>客户编号 / 姓名</span><span>手机号</span><span>TRN</span><span>联系方式</span><span>状态 / 操作</span>
        </header>
        {page.items.map((customer) => (
          <article className="compact-record-item" key={customer.id}>
            <div className="compact-record-row">
              <span><strong>{customer.fullName}</strong><small>{customer.customerNo}</small></span>
              <span>{customer.normalizedPhone ?? "—"}</span>
              <span>{customer.trn ?? "—"}</span>
              <span>{customer.email ?? customer.whatsapp ?? "—"}</span>
              <span className="record-actions"><em>{customer.isActive ? "启用" : "停用"}</em>{canWrite ? <details><summary>修改</summary>
                <form action={action} className="record-form record-inline-editor">
                  <input name="operation" type="hidden" value="update_person" />
                  <input name="customerId" type="hidden" value={customer.id} />
                  <input name="version" type="hidden" value={customer.version} />
                  <label>姓名<input defaultValue={customer.fullName} name="fullName" required /></label>
                  <label>手机号<input defaultValue={customer.normalizedPhone ?? ""} name="phone" /></label>
                  <label>TRN<input defaultValue={customer.trn ?? ""} name="trn" /></label>
                  <label>WhatsApp<input defaultValue={customer.whatsapp ?? ""} name="whatsapp" /></label>
                  <label>邮箱<input defaultValue={customer.email ?? ""} name="email" type="email" /></label>
                  <label>地址<input defaultValue={customer.address ?? ""} name="address" /></label>
                  <label>状态<select defaultValue={String(customer.isActive)} name="isActive"><option value="true">启用</option><option value="false">停用</option></select></label>
                  <button type="submit">保存客户资料</button>
                </form>
              </details> : null}</span>
            </div>
          </article>
        ))}
        {page.items.length === 0 ? <p className="record-empty">没有符合条件的个人客户。</p> : null}
      </section>
      <RecordPagination basePath="/customers" page={page.page} pageCount={page.pageCount} search={search} total={page.total} />
    </section>
  );
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; success?: string; error?: string }> }) {
  await connection();
  const [session, query] = await Promise.all([currentSession(), searchParams]);
  const viewer = requirePermission(session, "customer_vehicle.read");
  const runtime = createCustomerVehicleRuntime();
  try {
    const page = await runtime.service.listPersonalCustomers({
      viewerAccountId: viewer.id, search: query.search,
      page: Number(query.page) || 1, pageSize: 20,
    });
    return <CustomersView canWrite={hasPermission(viewer.role, "customer_vehicle.write")} error={query.error} page={page} search={query.search} success={query.success} />;
  } finally {
    await runtime.close();
  }
}
