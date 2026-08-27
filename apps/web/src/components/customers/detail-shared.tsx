"use client";

import type { ComponentType, ReactNode } from "react";
import type { CustomerRecord, CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import { api, isFormalCustomerVehicleApiEnabled } from "@/lib/api/client";
import {
  deriveAgreementVerification,
  deriveKycVerification,
  deriveOtpVerification,
} from "@/lib/customers/verification-domain";
import { cn } from "@/lib/utils";
import { loadWorkspaceWithVehiclePresence } from "@/lib/customers/formal-customer-vehicle-consumer";

type IconComponent = ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

const pendingWorkspaceBySession = new Map<string, Promise<CustomerVehicleWorkspaceResponse>>();

export function currentSessionKey(): string {
  if (typeof window === "undefined") return "server";
  const raw = window.localStorage.getItem("wh_session");
  if (!raw) return "anonymous";
  try {
    const session = JSON.parse(raw) as { identity?: { id?: unknown; role?: unknown } };
    return `${String(session.identity?.id ?? "invalid")}:${String(session.identity?.role ?? "invalid")}`;
  } catch {
    return "invalid";
  }
}

export function loadWorkspace(): Promise<CustomerVehicleWorkspaceResponse> {
  const key = currentSessionKey();
  const existing = pendingWorkspaceBySession.get(key);
  if (existing) return existing;
  const request = loadWorkspaceWithVehiclePresence({
    formal: isFormalCustomerVehicleApiEnabled,
    loadWorkspace: () => api.customers.workspace(),
    loadQuickOrders: () => api.quickOrders.list(),
  });
  pendingWorkspaceBySession.set(key, request);
  void request.finally(() => {
    if (pendingWorkspaceBySession.get(key) === request) pendingWorkspaceBySession.delete(key);
  }).catch(() => undefined);
  return request;
}

/** 变更后的强制刷新：丢弃在途去重句柄，直接发新请求拿最新数据。 */
export function reloadWorkspaceFresh(): Promise<CustomerVehicleWorkspaceResponse> {
  pendingWorkspaceBySession.delete(currentSessionKey());
  return loadWorkspace();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "读取失败，请重试";
}

export const CURRENT_CUSTOMER_AGREEMENT_VERSION = "1.3";

/** 待补项数：OTP / KYC / 协议三项中，当前没有可信有效证据的数量（0-3）。 */
export function pendingVerificationCount(customer: CustomerRecord): number {
  const otp = deriveOtpVerification(customer.verificationArchive, customer.phone);
  const kyc = deriveKycVerification(
    customer.verificationArchive,
    customer.customerType === "organization"
      ? { type: "organization_primary_contact", currentName: customer.nameSourceValue }
      : { type: "customer" },
  );
  const agreement = deriveAgreementVerification(
    customer.verificationArchive,
    CURRENT_CUSTOMER_AGREEMENT_VERSION,
  );
  return (otp.status === "verified" ? 0 : 1)
    + (kyc.status === "verified" ? 0 : 1)
    + (agreement.status === "signed" ? 0 : 1);
}

/** 分区卡片：与表单 FormSection 同风格（图标 + 标题 + 提示分区头、rounded-2xl、shadow-card）。 */
export function DetailSection({
  testId,
  icon: Icon,
  title,
  hint,
  count,
  children,
}: {
  testId: string;
  icon: IconComponent;
  title: string;
  hint?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:border-slate-700 dark:bg-slate-800/60"
    >
      <div className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3 dark:border-slate-700 dark:bg-slate-900/50">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary dark:bg-primary/15 dark:text-primary-300">
          <Icon size={15} aria-hidden />
        </span>
        <h3 className="text-sm font-bold text-ink dark:text-slate-100">{title}</h3>
        {count === undefined ? null : (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-ink-soft dark:bg-slate-700 dark:text-slate-300">{count}</span>
        )}
        {hint ? <span className="ml-auto hidden text-right text-[11px] leading-4 text-ink-soft dark:text-slate-400 sm:block">{hint}</span> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function DetailField({ label, value, mono = false }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  const displayValue = value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div className="min-w-0 rounded-xl border border-line bg-white p-3 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="text-[10px] font-medium text-ink-soft dark:text-slate-400">{label}</div>
      <div className={cn("mt-1 break-words text-sm font-semibold text-ink dark:text-slate-100", mono ? "font-mono" : null)}>
        {displayValue}
      </div>
    </div>
  );
}

export function DetailEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-surface px-3 py-3 text-xs text-ink-soft dark:bg-slate-900/60 dark:text-slate-400">
      {children}
    </p>
  );
}

export function taskStatusLabel(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "in_progress") return "进行中";
  return "待处理";
}

export function taskStatusTone(status: string): string {
  if (status === "completed") return "text-emerald-700 dark:text-emerald-300";
  if (status === "in_progress") return "text-primary-700 dark:text-primary-300";
  return "text-amber-800 dark:text-amber-300";
}

export function partStatusLabel(status: string): string {
  if (status === "arrived") return "已到货";
  if (status === "ordered") return "已下单";
  return "待采购";
}

export function partStatusTone(status: string): string {
  if (status === "arrived") return "text-emerald-700 dark:text-emerald-300";
  if (status === "ordered") return "text-primary-700 dark:text-primary-300";
  return "text-amber-800 dark:text-amber-300";
}
