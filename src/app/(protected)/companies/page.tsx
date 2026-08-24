import { connection } from "next/server";
import type { CompanyAccountRecord, CompanyContactRecord, PageResult, PersonalCustomerRecord } from "@/modules/customer-vehicle/customer-vehicle-service";
import { createCustomerVehicleRuntime } from "@/modules/customer-vehicle/customer-vehicle-runtime";
import { currentSession } from "@/modules/auth/current-session";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";
import { customerVehicleAction } from "@/app/(protected)/customer-vehicle/actions";
import { RecordPagination } from "@/app/(protected)/customer-vehicle/pagination";

type FormAction = (formData: FormData) => void | Promise<void>;

export function CompaniesView({
  companies, people, contactsByCompany = {}, canWrite, search = "",
  contactSearch = "", peopleCandidateTotal, success, error,
  action = customerVehicleAction,
}: {
  companies: PageResult<CompanyAccountRecord>;
  people: PersonalCustomerRecord[];
  contactsByCompany?: Record<string, CompanyContactRecord[]>;
  canWrite: boolean; search?: string; contactSearch?: string;
  peopleCandidateTotal?: number; success?: string; error?: string; action?: FormAction;
}) {
  return (
    <section className="records-workspace" aria-labelledby="companies-title">
      <header className="section-heading">
        <p className="eyebrow">客户与车辆 · 正式数据</p>
        <h1 id="companies-title">公司账户</h1>
        <p>公司单独建档；联系人从个人客户中选择，一个公司可以有多名联系人。</p>
      </header>
      {success ? <p className="form-alert success-alert">{success}</p> : null}
      {error ? <p className="form-alert">{error}</p> : null}
      {canWrite ? <section className="record-editor-card"><h2>新增公司账户</h2>
        <form action={action} className="record-form record-form-six">
          <input name="operation" type="hidden" value="create_company" />
          <label>公司正式名称<input name="legalName" required /></label>
          <label>TRN<input inputMode="numeric" name="trn" /></label>
          <label>电话<input name="phone" /></label>
          <label>邮箱<input name="email" type="email" /></label>
          <label>地址<input name="address" /></label>
          <button type="submit">创建公司账户</button>
        </form>
      </section> : null}
      <form className="record-search" method="get"><label>搜索公司<input defaultValue={search} name="search" placeholder="公司名称、TRN 或公司编号" /></label><button type="submit">搜索</button></form>
      {canWrite ? <form className="record-search candidate-search" method="get"><input name="search" type="hidden" value={search} /><label>查找联系人候选<input defaultValue={contactSearch} name="contactSearch" placeholder="姓名、手机号、TRN 或客户编号" /></label><button type="submit">查找联系人</button><small>当前显示 {people.length} / {peopleCandidateTotal ?? people.length} 名候选；输入关键词可查找全部个人客户。</small></form> : null}
      <section className="record-card-list">
        {companies.items.map((company) => (
          <article className="record-detail-card" key={company.id}>
            <header><div><strong>{company.legalName}</strong><small>{company.companyNo} · TRN {company.trn ?? "未填写"}</small></div><span>{company.isActive ? "启用" : "停用"}</span></header>
            <div className="record-summary"><span>电话 {company.phone ?? "—"}</span><span>邮箱 {company.email ?? "—"}</span><span>地址 {company.address ?? "—"}</span></div>
            <div className="contact-strip">
              {(contactsByCompany[String(company.id)] ?? []).map((contact) => <span key={contact.id}>{contact.personalCustomerName}{contact.isPrimary ? " · 主要联系人" : ""}{contact.canSign ? " · 可签字" : ""}</span>)}
              {(contactsByCompany[String(company.id)] ?? []).length === 0 ? <span>尚未添加联系人</span> : null}
            </div>
            {canWrite ? <div className="record-detail-actions">
              <details><summary>修改公司资料</summary><form action={action} className="record-form record-inline-editor">
                <input name="operation" type="hidden" value="update_company" /><input name="companyId" type="hidden" value={company.id} /><input name="version" type="hidden" value={company.version} />
                <label>公司正式名称<input defaultValue={company.legalName} name="legalName" required /></label><label>TRN<input defaultValue={company.trn ?? ""} name="trn" /></label><label>电话<input defaultValue={company.phone ?? ""} name="phone" /></label><label>邮箱<input defaultValue={company.email ?? ""} name="email" type="email" /></label><label>地址<input defaultValue={company.address ?? ""} name="address" /></label><label>状态<select defaultValue={String(company.isActive)} name="isActive"><option value="true">启用</option><option value="false">停用</option></select></label><button type="submit">保存公司资料</button>
              </form></details>
              <details><summary>添加联系人</summary><form action={action} className="record-form record-contact-form">
                <input name="operation" type="hidden" value="add_contact" /><input name="companyId" type="hidden" value={company.id} />
                <label>个人联系人<select name="personalCustomerId" required><option value="">请选择</option>{people.map((person) => <option key={person.id} value={person.id}>{person.fullName} · {person.customerNo}</option>)}</select></label>
                <label>职务<input name="jobTitle" /></label><label>主要联系人<select name="isPrimary" defaultValue="false"><option value="false">否</option><option value="true">是</option></select></label><label>可签字<select name="canSign" defaultValue="false"><option value="false">否</option><option value="true">是</option></select></label><label>接收票据<select name="receivesInvoice" defaultValue="false"><option value="false">否</option><option value="true">是</option></select></label><label>接收催款<select name="receivesCollection" defaultValue="false"><option value="false">否</option><option value="true">是</option></select></label><button type="submit">添加公司联系人</button>
              </form></details>
              {(contactsByCompany[String(company.id)] ?? []).length > 0 ? <details><summary>管理已有联系人</summary><div className="contact-editor-list">
                {(contactsByCompany[String(company.id)] ?? []).map((contact) => <form action={action} className="record-form record-contact-form" key={contact.id}>
                  <input name="operation" type="hidden" value="update_contact" /><input name="contactId" type="hidden" value={contact.id} /><input name="version" type="hidden" value={contact.version} />
                  <strong>{contact.personalCustomerName}<small>{contact.normalizedPhone ?? "无手机号"}</small></strong>
                  <label>职务<input defaultValue={contact.jobTitle ?? ""} name="jobTitle" /></label><label>主要联系人<select defaultValue={String(contact.isPrimary)} name="isPrimary"><option value="false">否</option><option value="true">是</option></select></label><label>可签字<select defaultValue={String(contact.canSign)} name="canSign"><option value="false">否</option><option value="true">是</option></select></label><label>接收票据<select defaultValue={String(contact.receivesInvoice)} name="receivesInvoice"><option value="false">否</option><option value="true">是</option></select></label><label>接收催款<select defaultValue={String(contact.receivesCollection)} name="receivesCollection"><option value="false">否</option><option value="true">是</option></select></label><label>状态<select defaultValue={String(contact.isActive)} name="isActive"><option value="true">启用</option><option value="false">停用</option></select></label><button type="submit">保存联系人关系</button>
                </form>)}
              </div></details> : null}
            </div> : null}
          </article>
        ))}
        {companies.items.length === 0 ? <p className="record-empty">没有符合条件的公司账户。</p> : null}
      </section>
      <RecordPagination basePath="/companies" page={companies.page} pageCount={companies.pageCount} search={search} total={companies.total} />
    </section>
  );
}

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; contactSearch?: string; success?: string; error?: string }> }) {
  await connection();
  const [session, query] = await Promise.all([currentSession(), searchParams]);
  const viewer = requirePermission(session, "customer_vehicle.read");
  const runtime = createCustomerVehicleRuntime();
  try {
    const [companies, people] = await Promise.all([
      runtime.service.listCompanyAccounts({ viewerAccountId: viewer.id, search: query.search, page: Number(query.page) || 1, pageSize: 20 }),
      runtime.service.listPersonalCustomers({ viewerAccountId: viewer.id, search: query.contactSearch, page: 1, pageSize: 30 }),
    ]);
    const contactEntries = await Promise.all(companies.items.map(async (company) => [String(company.id), await runtime.service.listCompanyContacts({ viewerAccountId: viewer.id, companyId: company.id })] as const));
    return <CompaniesView canWrite={hasPermission(viewer.role, "customer_vehicle.write")} companies={companies} contactSearch={query.contactSearch} contactsByCompany={Object.fromEntries(contactEntries)} error={query.error} people={people.items} peopleCandidateTotal={people.total} search={query.search} success={query.success} />;
  } finally { await runtime.close(); }
}
