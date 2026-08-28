"use client";

import { useRouter } from "next/navigation";
import { Building2, ChevronRight, User } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { CustomerRecord } from "@/lib/customers/types";
import {
  customerDisplayNameV3,
  deriveCustomerRiskLevel,
  deriveProfileCompleteness,
} from "@/lib/customers/selectors";
import { formatPhoneE164 } from "@/lib/customers/phone";
import { formatJMDFull } from "@/lib/utils";
import { pendingVerificationCount } from "./detail-shared";
import {
  ChannelBadge,
  CustomerStatusBadge,
  ProfileBadge,
  RiskBadge,
} from "./badges";
import { useI18n } from "@/lib/i18n/language";

interface CustomerListProps {
  customers: CustomerRecord[];
  vehicleCounts: Map<string, number>;
  formal?: boolean;
  /** 欠账（客户档案 id → 未结清 JMD），Invoice 权威来源归并。 */
  debtByCustomer?: Map<string, number>;
}

export function customerDisplayName(customer: CustomerRecord): string {
  return customerDisplayNameV3(customer);
}

function CustomerIdentity({ customer, testIdSuffix = "" }: { customer: CustomerRecord; testIdSuffix?: string }) {
  const { language } = useI18n();
  const tr = (zh: string, en: string) => language === "en" ? en : zh;
  const organization = customer.customerType === "organization";
  const Icon = organization ? Building2 : User;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${organization ? "bg-purple-50 text-purple-500 dark:bg-purple-500/15" : "bg-primary-50 text-primary dark:bg-primary/15 dark:text-primary-300"}`}>
        <Icon size={14} aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink dark:text-slate-100">{customerDisplayName(customer)}</div>
        <div
          data-testid={`customer-secondary-${customer.id}${testIdSuffix}`}
          className="mt-0.5 truncate text-[10px] text-ink-soft dark:text-slate-400"
        >
          <span className="font-mono">{customer.id}</span> · {organization ? tr("机构", "Company") : tr("个人", "Individual")}
          {organization ? tr(` · 联系人 ${customer.nameZh && customer.nameEn ? `${customer.nameZh} / ${customer.nameEn}` : customer.nameZh ?? customer.nameEn ?? "待补"}`, ` · Contact ${customer.nameEn ?? customer.nameZh ?? "Not provided"}`) : ""}
          {customer.phone ? ` · ${formatPhoneE164(customer.phone)}` : ""}
          {customer.email ? ` · ${customer.email}` : ""}
        </div>
      </div>
    </div>
  );
}

function CustomerTableRow({
  customer,
  vehicleCount,
  debtJmd,
  formal,
}: {
  customer: CustomerRecord;
  vehicleCount: number;
  debtJmd: number;
  formal: boolean;
}) {
  const router = useRouter();
  const { language } = useI18n();
  const tr = (zh: string, en: string) => language === "en" ? en : zh;
  const openDetail = () => router.push(`/customers/${customer.id}`);
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail();
    }
  };
  const pending = pendingVerificationCount(customer);
  const riskLevel = deriveCustomerRiskLevel(customer);
  const profileCompleteness = deriveProfileCompleteness(customer);
  return (
    <tr
      data-testid={`customer-row-${customer.id}`}
      role="link"
      tabIndex={0}
      aria-label={tr(`查看客户 ${customerDisplayName(customer)} 详情`, `View details for ${customerDisplayName(customer)}`)}
      onClick={openDetail}
      onKeyDown={handleKeyDown}
      className="cursor-pointer border-b border-line bg-white transition-colors last:border-b-0 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:bg-slate-800 dark:hover:bg-slate-700/40"
    >
      <td className="px-3 py-2"><CustomerIdentity customer={customer} /></td>
      {!formal ? <td className="hidden px-3 py-2 lg:table-cell">
        <ChannelBadge channel={customer.preferredChannel} />
      </td> : null}
      {!formal ? <td className="hidden px-3 py-2 lg:table-cell">
        <span data-testid={`customer-profile-${customer.id}`}><ProfileBadge completeness={profileCompleteness} /></span>
      </td> : null}
      <td className="px-3 py-2 text-center">
        <span data-testid={`customer-active-vehicle-count-${customer.id}`} className="text-sm font-semibold tabular-nums text-ink dark:text-slate-100">{vehicleCount}</span>
        <span className="ml-0.5 text-[10px] text-ink-soft dark:text-slate-400">{tr("辆", "")}</span>
      </td>
      {!formal ? <td className="px-3 py-2 text-center">
        {pending > 0 ? (
          <span data-testid={`customer-pending-${customer.id}`} className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{pending} 项待补</span>
        ) : (
          <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">证据齐全</span>
        )}
      </td> : null}
      {!formal ? <td data-testid={`customer-debt-${customer.id}`} className="px-3 py-2 text-right">
        {debtJmd > 0 ? (
          <span className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatJMDFull(debtJmd)}</span>
        ) : (
          <span className="text-xs text-ink-soft dark:text-slate-500">—</span>
        )}
      </td> : null}
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              {!formal ? <RiskBadge level={riskLevel} /> : null}
              <CustomerStatusBadge
                status={customer.status}
                dataTestId={`customer-status-${customer.status}-${customer.id}`}
              />
            </div>
          </div>
          <button
            type="button"
            data-testid={`customer-open-${customer.id}`}
            aria-label={tr(`查看客户 ${customerDisplayName(customer)} 详情`, `View details for ${customerDisplayName(customer)}`)}
            onClick={(event) => {
              event.stopPropagation();
              openDetail();
            }}
            className="grid h-7 w-7 place-items-center rounded-md border border-line bg-white text-ink-soft hover:border-primary-200 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:bg-slate-900 dark:text-slate-300 dark:hover:text-primary-300"
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
      </td>
    </tr>
  );
}

function CustomerCard({
  customer,
  vehicleCount,
  debtJmd,
  formal,
}: {
  customer: CustomerRecord;
  vehicleCount: number;
  debtJmd: number;
  formal: boolean;
}) {
  const router = useRouter();
  const { language } = useI18n();
  const tr = (zh: string, en: string) => language === "en" ? en : zh;
  const riskLevel = deriveCustomerRiskLevel(customer);
  const profileCompleteness = deriveProfileCompleteness(customer);
  const pending = pendingVerificationCount(customer);
  return (
    <button
      type="button"
      data-testid={`customer-card-${customer.id}`}
      aria-label={tr(`查看客户 ${customerDisplayName(customer)} 详情`, `View details for ${customerDisplayName(customer)}`)}
      onClick={() => router.push(`/customers/${customer.id}`)}
      className="w-full rounded-xl border border-line bg-white p-3 text-left shadow-card transition-colors hover:border-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:bg-slate-800"
    >
      <CustomerIdentity customer={customer} testIdSuffix="-mobile" />
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {!formal ? <ChannelBadge channel={customer.preferredChannel} /> : null}
        {!formal ? <RiskBadge level={riskLevel} /> : null}
        <CustomerStatusBadge status={customer.status} dataTestId={`customer-status-${customer.status}-${customer.id}-mobile`} />
        {!formal ? <span data-testid={`customer-profile-${customer.id}-mobile`}><ProfileBadge completeness={profileCompleteness} /></span> : null}
        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-ink-soft dark:bg-slate-700 dark:text-slate-200">
          <span data-testid={`customer-active-vehicle-count-${customer.id}-mobile`}>{vehicleCount}</span>&nbsp;{tr("辆当前车辆", "current vehicles")}
        </span>
        {!formal && pending > 0 ? (
          <span data-testid={`customer-pending-${customer.id}-mobile`} className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">{pending} 项验证待补</span>
        ) : null}
        {!formal && debtJmd > 0 ? (
          <span data-testid={`customer-debt-${customer.id}-mobile`} className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">欠 {formatJMDFull(debtJmd)}</span>
        ) : null}
      </div>
    </button>
  );
}

export function CustomerList({ customers, vehicleCounts, debtByCustomer, formal = false }: CustomerListProps) {
  const { language } = useI18n();
  const tr = (zh: string, en: string) => language === "en" ? en : zh;
  if (customers.length === 0) {
    return (
      <div data-testid="customer-list-empty" className="flex flex-col items-center justify-center py-16 text-center">
        <User size={32} className="text-ink-soft dark:text-slate-400" aria-hidden />
        <p className="mt-2 text-sm text-ink-soft dark:text-slate-400">{tr("未找到匹配的客户", "No matching customers")}</p>
        <p className="mt-1 text-xs text-ink-soft dark:text-slate-400">{tr("尝试调整搜索条件或重置筛选", "Change the search terms or reset the filters.")}</p>
      </div>
    );
  }

  return (
    <div data-testid="customer-list" className="h-full min-h-0">
      <div className="hidden h-full min-h-0 overflow-hidden sm:block">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface text-left dark:bg-slate-900/40">
              <th className="px-3 py-2 text-[11px] font-semibold text-ink-soft dark:text-slate-400">{tr("客户 / 联系方式", "Customer / Contact")}</th>
              {!formal ? <th className="hidden w-[105px] px-3 py-2 text-[11px] font-semibold text-ink-soft dark:text-slate-400 lg:table-cell">渠道</th> : null}
              {!formal ? <th className="hidden w-[105px] px-3 py-2 text-[11px] font-semibold text-ink-soft dark:text-slate-400 lg:table-cell">档案</th> : null}
              <th className="w-[80px] px-3 py-2 text-center text-[11px] font-semibold text-ink-soft dark:text-slate-400">{tr("当前车辆", "Vehicles")}</th>
              {!formal ? <th className="w-[120px] px-3 py-2 text-center text-[11px] font-semibold text-ink-soft dark:text-slate-400">验证证据</th> : null}
              {!formal ? <th className="w-[110px] px-3 py-2 text-right text-[11px] font-semibold text-ink-soft dark:text-slate-400">欠账</th> : null}
              <th className="w-[180px] px-3 py-2 text-right text-[11px] font-semibold text-ink-soft dark:text-slate-400">{formal ? tr("状态 / 操作", "Status / Actions") : tr("风险 / 状态 / 操作", "Risk / Status / Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <CustomerTableRow
                key={customer.id}
                customer={customer}
                vehicleCount={vehicleCounts.get(customer.id) ?? 0}
                debtJmd={debtByCustomer?.get(customer.id) ?? 0}
                formal={formal}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2.5 sm:hidden">
        {customers.map((customer) => (
          <CustomerCard
            key={customer.id}
            customer={customer}
            vehicleCount={vehicleCounts.get(customer.id) ?? 0}
            debtJmd={debtByCustomer?.get(customer.id) ?? 0}
            formal={formal}
          />
        ))}
      </div>
    </div>
  );
}
