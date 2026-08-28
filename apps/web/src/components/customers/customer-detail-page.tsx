"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  Car,
  History,
  Pencil,
  StickyNote,
  User,
} from "lucide-react";
import { api, isFormalCustomerVehicleApiEnabled, isMockApiEnabled } from "@/lib/api/client";
import type { LinkedOperationsState } from "@/lib/api/mock-orders";
import { customerFinanceSummary } from "@/lib/customers/debt";
import type {
  CustomerRecord,
  CustomerVehicleWorkspaceResponse,
} from "@/lib/customers/types";
import { deriveCustomerRiskLevel, deriveProfileCompleteness } from "@/lib/customers/selectors";
import { formatPhoneE164 } from "@/lib/customers/phone";
import { cn, formatDate, formatDateTime, formatJMDFull } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { RecordDeleteButton } from "@/components/shared/record-delete-dialog";
import {
  ChannelBadge,
  CustomerStatusBadge,
  ProfileBadge,
  RiskBadge,
} from "./badges";
import { customerDisplayName } from "./customer-list";
import {
  DetailEmpty,
  DetailField,
  DetailSection,
  currentSessionKey,
  errorMessage,
  loadWorkspace,
} from "./detail-shared";
import { CustomerFormDialog } from "./form-dialogs";
import { VerificationRiskSections } from "./verification-risk-sections";
import { VerificationEvidenceSection } from "./verification-evidence-section";
import { CustomerAuditHistory } from "./customer-audit-history";
import { CreditEligibilityDialog } from "./credit-eligibility-dialog";
import { FormalCustomerLicenseCard } from "./formal-customer-license-card";
import { loadFormalSafeLinkedOperations } from "@/lib/customers/formal-customer-vehicle-consumer";

interface CustomerDetailPageProps {
  customerId: string;
}

export function CustomerDetailPage({ customerId }: CustomerDetailPageProps) {
  const sessionKey = currentSessionKey();
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [linkedState, setLinkedState] = useState<LinkedOperationsState | null>(null);
  const [editing, setEditing] = useState(false);
  const [creditDialog, setCreditDialog] = useState<"grant" | "revoke" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noteEditing, setNoteEditing] = useState<string | "new" | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [notePending, setNotePending] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, nextWorkspace, linked] = await Promise.all([
        api.customers.detail(customerId),
        loadWorkspace(),
        loadFormalSafeLinkedOperations({
          formal: isFormalCustomerVehicleApiEnabled,
          load: () => api.debug.linkedOperationsState(),
        }),
      ]);
      if (currentSessionKey() !== sessionKey) return;
      setCustomer(isFormalCustomerVehicleApiEnabled
        ? nextWorkspace.customers.find((entry) => entry.id === customerId) ?? detail
        : detail);
      setWorkspace(nextWorkspace);
      setLinkedState(linked);
      setLoading(false);
    } catch (loadError) {
      if (currentSessionKey() !== sessionKey) return;
      setCustomer(null);
      setWorkspace(null);
      setError(errorMessage(loadError));
      setLoading(false);
    }
  }, [customerId, sessionKey]);

  useEffect(() => {
    if (isMockApiEnabled && sessionKey === "anonymous") {
      setLoading(true);
      setError(null);
      return;
    }
    void load();
  }, [load, reloadSequence, sessionKey]);

  const relationships = useMemo(
    () => (workspace?.relationships ?? []).filter((relationship) => relationship.customerId === customer?.id),
    [customer?.id, workspace],
  );
  const vehiclesById = useMemo(
    () => new Map((workspace?.vehicles ?? []).map((vehicle) => [vehicle.id, vehicle])),
    [workspace],
  );
  const currentRelationships = [...new Map(
    relationships
      .filter((relationship) => relationship.endedAt === null)
      .map((relationship) => [relationship.vehicleId, relationship] as const),
  ).values()];
  const historicalRelationships = relationships.filter((relationship) => relationship.endedAt !== null);
  const companyContacts = (workspace?.companyContacts ?? []).filter((contact) => contact.companyId === customer?.id);

  const handleVerificationChanged = useCallback((nextCustomer: CustomerRecord) => {
    if (currentSessionKey() !== sessionKey) return;
    setCustomer(nextCustomer);
    setWorkspace((current) => current ? {
      ...current,
      customers: current.customers.map((entry) => entry.id === nextCustomer.id ? nextCustomer : entry),
    } : current);
  }, [sessionKey]);

  const backLink = (
    <Link
      href="/customers"
      data-testid="customer-detail-back"
      className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-soft transition-colors hover:border-primary-200 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-primary-300"
    >
      <ArrowLeft size={13} aria-hidden />返回客户列表
    </Link>
  );

  if (loading) {
    return (
      <div data-testid="customer-detail-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
        <div className="mx-auto min-w-0 max-w-[1320px]">
          {backLink}
          <div data-testid="customer-detail-loading" role="status" className="rounded-2xl border border-line bg-white p-12 text-center text-sm text-ink-soft shadow-card dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
            正在读取客户详情…
          </div>
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div data-testid="customer-detail-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
        <div className="mx-auto min-w-0 max-w-[1320px]">
          {backLink}
          <div data-testid="customer-detail-error" role="alert" className="rounded-2xl border border-line bg-white p-8 text-center shadow-card dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-sm font-semibold text-danger">{error ?? "未找到该客户"}</p>
            <button
              type="button"
              data-testid="customer-detail-retry"
              onClick={() => setReloadSequence((value) => value + 1)}
              className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  const organization = customer.customerType === "organization";
  const TypeIcon = organization ? Building2 : User;
  const name = customerDisplayName(customer);
  const riskLevel = deriveCustomerRiskLevel(customer);
  const profileCompleteness = deriveProfileCompleteness(customer);
  const hasCredit = customer.creditEligibility.eligible;
  const creditEventAt = hasCredit
    ? customer.creditEligibility.registeredAt
    : customer.creditEligibility.cancelledAt;
  const transliterationStatus = customer.transliterationStatus === "confirmed"
    ? "已确认"
    : customer.transliterationStatus === "needs_transliteration_review"
      ? "待补中文音译"
      : "待补主要联系人";
  const primaryContact = organization
    ? companyContacts.find((contact) => contact.isActive && contact.isPrimary) ?? null
    : null;
  const hasPrimaryContact = !organization || Boolean(primaryContact);

  return (
    <div data-testid="customer-detail-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
      <div className="mx-auto min-w-0 max-w-[1320px]">
        <PageHeader
          breadcrumb="客户与车辆 / 客户详情"
          title={name}
          titleTestId="customer-detail-heading"
          description={`${organization ? "机构客户" : "个人客户"} · ${customer.id} · 建立于 ${formatDate(customer.createdAt)}`}
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isFormalCustomerVehicleApiEnabled ? <RecordDeleteButton
                record={{
                  kind: organization ? "company_customer" : "personal_customer",
                  recordNo: customer.id,
                  version: customer.revision,
                }}
                title="删除客户档案"
                returnTo="/customers"
              /> : null}
              <button
                type="button"
                onClick={() => setEditing(true)}
                data-testid="customer-edit-btn"
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
              >
                <Pencil size={14} aria-hidden />编辑正式资料
              </button>
            </div>
          }
        />
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>{backLink}</div>
          {!isFormalCustomerVehicleApiEnabled ? <button
            type="button"
            data-testid="customer-tab-history"
            onClick={() => setHistoryOpen((open) => !open)}
            className="inline-flex min-h-7 shrink-0 items-center rounded-full border border-line px-2.5 text-[11px] font-semibold text-ink-soft hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-400"
          >
            {historyOpen ? "返回档案" : "修改历史"}
          </button> : null}
        </div>

        {/* 财务英雄区：欠账/累计消费/挂账资格（Invoice 权威来源，讨债对人不对车） */}
        {!isFormalCustomerVehicleApiEnabled ? (() => {
          const finance = linkedState ? customerFinanceSummary(linkedState, customer) : null;
          const hasDebt = (finance?.debtJmd ?? 0) > 0;
          return (
            <div data-testid="customer-financial-hero" className="mb-4 grid grid-cols-3 gap-2.5">
              <div className={cn(
                "rounded-xl border bg-white p-3.5 shadow-card dark:bg-slate-800",
                hasDebt ? "border-rose-300 dark:border-rose-500/50" : "border-line",
              )}>
                <p className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">当前欠账</p>
                <p data-testid="customer-debt-amount" className={cn(
                  "mt-1 text-xl font-bold tabular-nums",
                  hasDebt ? "text-rose-600 dark:text-rose-400" : "text-ink dark:text-slate-100",
                )}>
                  {finance ? formatJMDFull(finance.debtJmd) : "…"}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">
                  {finance ? (hasDebt ? "未结清账单待催收" : "无未结清账单") : "读取中"}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-white p-3.5 shadow-card dark:border-slate-700 dark:bg-slate-800">
                <p className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">累计消费</p>
                <p data-testid="customer-total-spend" className="mt-1 text-xl font-bold tabular-nums text-ink dark:text-slate-100">
                  {finance ? formatJMDFull(finance.totalSpendJmd) : "…"}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">{finance ? `${finance.invoiceCount} 张账单` : "读取中"}</p>
              </div>
              <div className={cn(
                "rounded-xl border bg-white p-3.5 shadow-card dark:bg-slate-800",
                hasCredit ? "border-emerald-300 dark:border-emerald-500/50" : "border-line dark:border-slate-700",
              )}>
                <p className="text-[10px] font-semibold text-ink-soft dark:text-slate-400">挂账资格</p>
                <p className={cn(
                  "mt-1 text-xl font-bold",
                  hasCredit ? "text-emerald-600 dark:text-emerald-400" : "text-ink-soft dark:text-slate-400",
                )}>
                  {hasCredit ? "有" : "无"}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">
                  {creditEventAt ? `${hasCredit ? "登记" : "取消"}于 ${formatDate(creditEventAt)}` : "未登记"}
                </p>
                <button
                  type="button"
                  data-testid="customer-credit-toggle"
                  onClick={() => setCreditDialog(hasCredit ? "revoke" : "grant")}
                  className="mt-1.5 inline-flex min-h-7 items-center rounded-lg border border-primary-200 px-2 text-[11px] font-semibold text-primary hover:bg-primary-50 dark:border-primary-500/40"
                >
                  {hasCredit ? "取消资格" : "开通挂账（签名）"}
                </button>
              </div>
            </div>
          );
        })() : null}

        {!isFormalCustomerVehicleApiEnabled && historyOpen ? (
          <CustomerAuditHistory customer={customer} refreshKey={customer.revision} />
        ) : null}
        <div className={historyOpen ? "hidden" : "contents"}>
        <div className="space-y-4">
          {/* 验证证据与风险状态均为后补制，提醒不阻止业务。 */}
          {!isFormalCustomerVehicleApiEnabled ? <VerificationEvidenceSection customer={customer} onChanged={handleVerificationChanged} /> : null}

          <DetailSection testId="customer-section-profile" icon={TypeIcon} title="正式资料" hint="身份与联系方式在同一处维护">
            <div data-testid={editing ? undefined : "customer-formal-details"}>
              <div className="flex min-w-0 items-start gap-3">
                <div className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
                  organization
                    ? "bg-purple-50 text-purple-500 dark:bg-purple-500/15"
                    : "bg-primary-50 text-primary-700 dark:bg-primary/15 dark:text-primary-300",
                )}>
                  <TypeIcon size={20} aria-hidden />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="break-words text-lg font-bold text-ink dark:text-slate-100">{name}</h4>
                    {!isFormalCustomerVehicleApiEnabled ? <>
                      <ChannelBadge channel={customer.preferredChannel} />
                      <RiskBadge level={riskLevel} />
                    </> : null}
                    <CustomerStatusBadge status={customer.status} />
                    {!isFormalCustomerVehicleApiEnabled ? <ProfileBadge completeness={profileCompleteness} /> : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft dark:text-slate-400">
                    <span className="font-mono">{customer.id}</span>
                    <span>{organization ? "机构客户" : "个人客户"}</span>
                    <span>建立于 {formatDate(customer.createdAt)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {organization ? <DetailField label="机构名称" value={customer.organizationName} /> : null}
                <DetailField label={organization ? "主要联系人（中文）" : "姓名（中文）"} value={customer.nameZh} />
                <DetailField label={organization ? "主要联系人（英文）" : "姓名（英文）"} value={customer.nameEn} />
                {organization ? <DetailField label="主要联系人职位／关系" value={customer.primaryContactRole} /> : null}
                {!isFormalCustomerVehicleApiEnabled ? <>
                  <DetailField label="姓名校正状态" value={transliterationStatus} />
                  <DetailField label="称谓" value={customer.salutation} />
                  <DetailField label="语言" value={customer.language} />
                </> : null}
                <div data-testid="customer-registration-time"><DetailField label="登记时间" value={formatDateTime(customer.createdAt)} /></div>
                {!isFormalCustomerVehicleApiEnabled ? <>
                  <DetailField label="性别" value={customer.gender} />
                  <DetailField label="生日" value={customer.birthDate ? formatDate(customer.birthDate) : null} />
                </> : null}
                <DetailField label="TRN 税号" value={customer.trn} mono />
                <DetailField label="主要电话" value={customer.phone ? formatPhoneE164(customer.phone) : null} mono />
                {!isFormalCustomerVehicleApiEnabled ? <DetailField label="备用电话" value={customer.secondaryPhone ? formatPhoneE164(customer.secondaryPhone) : null} mono /> : null}
                <DetailField label="WhatsApp" value={customer.whatsapp ? formatPhoneE164(customer.whatsapp) : null} mono />
                <DetailField label="Email" value={customer.email} />
                {!isFormalCustomerVehicleApiEnabled ? <DetailField label="首选联系方式" value={customer.preferredChannel.toUpperCase()} /> : null}
                <div className="sm:col-span-2 lg:col-span-3"><DetailField label="地址" value={customer.address} /></div>
              </div>
            </div>
          </DetailSection>
          {isFormalCustomerVehicleApiEnabled ? (
            <FormalCustomerLicenseCard
              customerNo={customer.id}
              organization={organization}
              primaryContactName={primaryContact?.personalCustomerName ?? null}
              hasPrimaryContact={hasPrimaryContact}
              onChanged={() => setReloadSequence((value) => value + 1)}
            />
          ) : null}
          {!isFormalCustomerVehicleApiEnabled ? <VerificationRiskSections customer={customer} onChanged={() => setReloadSequence((value) => value + 1)} /> : null}





          <div data-testid="customer-detail-columns" className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-4">
              {organization ? <DetailSection testId="customer-section-company-contacts" icon={Building2} title="公司联系人" count={companyContacts.length}>
                {companyContacts.length === 0 ? <DetailEmpty>暂无公司联系人关系</DetailEmpty> : (
                  <div className="space-y-1.5">
                    {companyContacts.map((contact) => (
                      <Link key={contact.id} href={`/customers/${contact.personalCustomerId}`} className="block rounded-xl border border-line bg-white px-3 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                        <div className="flex flex-wrap items-center gap-2 font-semibold text-ink dark:text-slate-100">
                          <span>{contact.personalCustomerName}</span>
                          {contact.isPrimary ? <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[9px] text-primary-700 dark:bg-primary/10 dark:text-primary-300">主要联系人</span> : null}
                          {!contact.isActive ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-500 dark:bg-slate-700 dark:text-slate-300">已停用</span> : null}
                        </div>
                        <div className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">{contact.jobTitle ?? "职位待补"}{contact.normalizedPhone ? ` · ${formatPhoneE164(contact.normalizedPhone)}` : ""} · {contact.canSign ? "可签字" : "不可签字"}</div>
                      </Link>
                    ))}
                  </div>
                )}
              </DetailSection> : null}
              <DetailSection testId="customer-section-current-vehicles" icon={Car} title="当前关联车辆" count={currentRelationships.length}>
                {currentRelationships.length === 0 ? (
                  <DetailEmpty>暂无当前关联车辆</DetailEmpty>
                ) : (
                  <div className="space-y-1.5">
                    {currentRelationships.map((relationship) => {
                      const vehicle = vehiclesById.get(relationship.vehicleId);
                      return vehicle ? (
                        <Link
                          key={relationship.id}
                          href={`/vehicles/${vehicle.id}`}
                          data-testid={`customer-vehicle-link-${vehicle.id}`}
                          aria-label={`查看车辆 ${vehicle.plate || vehicle.id} 详情`}
                          className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900/50"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs font-bold text-ink dark:bg-slate-800 dark:text-slate-100">{vehicle.plate || "无车牌"}</span>
                              <span className="text-xs text-ink-soft dark:text-slate-400">{vehicle.make} {vehicle.model}</span>
                            </div>
                            <div className="mt-1 break-words font-mono text-[10px] text-ink-soft dark:text-slate-400">
                              {relationship.id} · 自 {formatDateTime(relationship.startedAt)}
                            </div>
                          </div>
                          <span data-testid={`customer-vehicle-action-${vehicle.id}`} className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-primary-700 dark:text-primary-300">
                            车辆详情 <ArrowRight size={10} aria-hidden />
                          </span>
                        </Link>
                      ) : (
                        <div key={relationship.id} className="rounded-xl border border-line bg-white px-3 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                          <div className="font-mono font-semibold text-ink dark:text-slate-100">{relationship.vehicleId}</div>
                          <div className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">车辆主档当前不可用 · {relationship.id}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </DetailSection>

              <DetailSection testId="customer-section-historical-vehicles" icon={History} title="历史关联车辆" count={historicalRelationships.length}>
                {historicalRelationships.length === 0 ? (
                  <DetailEmpty>暂无历史关联车辆</DetailEmpty>
                ) : (
                  <div className="space-y-1.5">
                    {historicalRelationships.map((relationship) => {
                      const vehicle = vehiclesById.get(relationship.vehicleId);
                      return vehicle ? (
                        <Link
                          key={relationship.id}
                          href={`/vehicles/${vehicle.id}`}
                          data-testid={`customer-vehicle-history-${relationship.id}`}
                          aria-label={`查看历史关联车辆 ${vehicle.plate || vehicle.id} 详情`}
                          className="flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-xl border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900/50 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="min-w-0 text-xs font-semibold text-ink dark:text-slate-100">
                            <span className="font-mono">{vehicle.plate || "无车牌"}</span> · {vehicle.make} {vehicle.model}
                          </span>
                          <span className="shrink-0 text-[10px] text-ink-soft dark:text-slate-400">
                            {formatDateTime(relationship.startedAt)} — {relationship.endedAt ? formatDateTime(relationship.endedAt) : "—"}
                          </span>
                        </Link>
                      ) : (
                        <div key={relationship.id} className="rounded-xl border border-line bg-white px-3 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                          <span className="font-mono font-semibold text-ink dark:text-slate-100">{relationship.vehicleId}</span>
                          <span className="ml-2 text-ink-soft dark:text-slate-400">{relationship.id}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </DetailSection>

            </div>

            {!isFormalCustomerVehicleApiEnabled ? <div className="min-w-0 space-y-4">
              <DetailSection testId="customer-section-notes" icon={StickyNote} title="备注" count={customer.notes.length}>
                <div className="space-y-1.5">
                  {customer.notes.map((note) => (
                    <div key={note.id} data-testid={`customer-note-${note.id}`} className="rounded-xl border-l-[3px] border-l-amber-600 bg-amber-50/60 px-3 py-2.5 text-xs dark:bg-amber-950/30">
                      {noteEditing === note.id ? (
                        <div>
                          <textarea
                            data-testid={`note-edit-input-${note.id}`}
                            value={noteDraft}
                            onChange={(event) => setNoteDraft(event.target.value)}
                            rows={2}
                            className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                          />
                          <div className="mt-1.5 flex gap-2">
                            <button
                              type="button"
                              data-testid={`note-save-${note.id}`}
                              disabled={notePending}
                              onClick={() => {
                                setNoteError(null);
                                setNotePending(true);
                                void api.customers.action(customer.id, { type: "save_note", noteId: note.id, content: noteDraft })
                                  .then(() => { setNoteEditing(null); setReloadSequence((value) => value + 1); })
                                  .catch((caught) => setNoteError(errorMessage(caught)))
                                  .finally(() => setNotePending(false));
                              }}
                              className="min-h-8 rounded-lg bg-primary px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                            >保存</button>
                            <button type="button" onClick={() => setNoteEditing(null)} className="min-h-8 rounded-lg border border-line px-3 text-[11px] dark:border-slate-600">取消</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <p className="break-words text-ink dark:text-slate-200">{note.content}</p>
                            <button
                              type="button"
                              data-testid={`note-edit-${note.id}`}
                              onClick={() => { setNoteEditing(note.id); setNoteDraft(note.content); }}
                              className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-400"
                            >编辑</button>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-ink-soft dark:text-slate-400">
                            <span>{note.author}</span>
                            <span>{formatDateTime(note.time)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {noteEditing === "new" ? (
                    <div className="rounded-xl border border-dashed border-amber-400 bg-amber-50/40 px-3 py-2.5 dark:bg-amber-950/20">
                      <textarea
                        data-testid="note-new-input"
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                        rows={2}
                        placeholder="写点什么，比如：客户习惯早上取车…"
                        className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                      />
                      <div className="mt-1.5 flex gap-2">
                        <button
                          type="button"
                          data-testid="note-new-save"
                          disabled={notePending || !noteDraft.trim()}
                          onClick={() => {
                            setNoteError(null);
                            setNotePending(true);
                            void api.customers.action(customer.id, { type: "save_note", noteId: null, content: noteDraft })
                              .then(() => { setNoteEditing(null); setNoteDraft(""); setReloadSequence((value) => value + 1); })
                              .catch((caught) => setNoteError(errorMessage(caught)))
                              .finally(() => setNotePending(false));
                          }}
                          className="min-h-8 rounded-lg bg-primary px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                        >保存备注</button>
                        <button type="button" onClick={() => { setNoteEditing(null); setNoteDraft(""); }} className="min-h-8 rounded-lg border border-line px-3 text-[11px] dark:border-slate-600">取消</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid="note-add"
                      onClick={() => { setNoteError(null); setNoteEditing("new"); setNoteDraft(""); }}
                      className="inline-flex min-h-8 items-center rounded-lg border border-dashed border-line px-3 text-[11px] font-semibold text-ink-soft hover:border-primary-300 hover:text-primary dark:border-slate-600 dark:text-slate-400"
                    >＋ 写备注</button>
                  )}
                  {noteError ? <p role="alert" data-testid="customer-note-error" className="text-xs font-semibold text-rose-600 dark:text-rose-300">{noteError}</p> : null}
                </div>
              </DetailSection>
            </div> : null}
          </div>
          </div>
          <p data-testid="customer-revision" className="sr-only">当前 revision：{customer.revision}</p>
        </div>
      </div>

      {!isFormalCustomerVehicleApiEnabled && creditDialog ? (
        <CreditEligibilityDialog
          mode={creditDialog}
          customerId={customer.id}
          onClose={() => setCreditDialog(null)}
          onDone={() => { setCreditDialog(null); setReloadSequence((value) => value + 1); }}
        />
      ) : null}

      {editing && workspace ? (
        <CustomerFormDialog
          mode="edit"
          customer={customer}
          customers={workspace.customers}
          onClose={() => setEditing(false)}
          onSaved={(record) => {
            setEditing(false);
            setCustomer(record);
            void loadWorkspace().then((nextWorkspace) => {
              if (currentSessionKey() !== sessionKey) return;
              setWorkspace(nextWorkspace);
              if (isFormalCustomerVehicleApiEnabled) {
                setCustomer(nextWorkspace.customers.find((entry) => entry.id === customerId) ?? record);
              }
            }).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}
