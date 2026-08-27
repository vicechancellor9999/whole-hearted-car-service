"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Building2, CheckCircle2, Phone, Search, ShieldCheck, UserRound } from "lucide-react";
import { formatPhoneE164 } from "@/lib/customers/phone";
import type { CustomerType } from "@/lib/customers/types";
import type { CustomerOnboardingState } from "./customer-onboarding-state";

const fieldLabel = {
  phone: "主要电话",
  secondaryPhone: "备用电话",
  whatsapp: "WhatsApp",
} as const;

export function OnboardingPhoneStep({
  state,
  busy,
  phoneChangeDisabled,
  error,
  otpCode,
  onCustomerTypeChange,
  onPhoneChange,
  onCheckPhone,
  onSendOtp,
  onOtpCodeChange,
  onVerifyOtp,
}: {
  state: CustomerOnboardingState;
  busy: boolean;
  phoneChangeDisabled: boolean;
  error: string | null;
  otpCode: string;
  onCustomerTypeChange: (value: CustomerType) => void;
  onPhoneChange: (value: string) => void;
  onCheckPhone: () => void;
  onSendOtp: () => void;
  onOtpCodeChange: (value: string) => void;
  onVerifyOtp: () => void;
}) {
  const otpRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.otpChallenge && !state.otpVerification) otpRef.current?.focus();
  }, [state.otpChallenge, state.otpVerification]);

  const typeLocked = state.onboardingToken !== null;
  const matchGroups = [...state.phoneMatches.reduce((groups, match) => {
    const existing = groups.get(match.customerId);
    if (existing) existing.fields.add(match.existingField);
    else groups.set(match.customerId, { match, fields: new Set([match.existingField]) });
    return groups;
  }, new Map<string, { match: (typeof state.phoneMatches)[number]; fields: Set<(typeof state.phoneMatches)[number]["existingField"]> }>()).values()];
  const statusText = state.phoneStatus === "duplicate"
    ? "该号码属于已有客户"
    : state.phoneStatus === "missing"
      ? "请填写主要号码（必填）"
    : state.phoneStatus === "clear"
      ? "号码未被使用，可选做 OTP"
      : state.phoneStatus === "verified"
        ? "号码已验证"
        : state.phoneStatus === "checking"
          ? "正在查询号码"
          : "请填写主要号码（必填），然后查询";

  return (
    <section data-testid="onboarding-phone-step" className="overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-4 dark:bg-slate-900/50 sm:px-6">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary dark:bg-primary/15 dark:text-primary-300"><Phone size={18} aria-hidden /></span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">第一步</p>
          <h3 className="text-base font-bold text-ink dark:text-slate-100">查询主要号码（OTP 可选）</h3>
        </div>
        <span data-testid="onboarding-phone-status" className={`ml-auto rounded-full px-3 py-1 text-[11px] font-bold ${state.phoneStatus === "verified" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : state.phoneStatus === "duplicate" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : "bg-primary-50 text-primary dark:bg-primary/10 dark:text-primary-300"}`}>{statusText}</span>
      </div>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(180px,0.45fr)_minmax(260px,1fr)]">
          <label className="text-[13px] font-semibold text-ink dark:text-slate-200">
            客户类型
            <span className="mt-1.5 flex min-h-12 rounded-xl border border-line bg-surface p-1 dark:bg-slate-900">
              {(["individual", "organization"] as const).map((value) => {
                const selected = state.customerType === value;
                const Icon = value === "individual" ? UserRound : Building2;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={typeLocked || busy}
                    onClick={() => onCustomerTypeChange(value)}
                    data-testid={`onboarding-customer-type-${value}`}
                    className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed ${selected ? "bg-primary text-white shadow-sm" : "text-ink-soft hover:text-primary dark:text-slate-300"}`}
                  >
                    <Icon size={14} aria-hidden />{value === "individual" ? "个人" : "企业"}
                  </button>
                );
              })}
              <select
                aria-label="客户类型"
                data-testid="onboarding-customer-type"
                value={state.customerType}
                disabled={typeLocked || busy}
                onChange={(event) => onCustomerTypeChange(event.target.value as CustomerType)}
                className="sr-only"
              >
                <option value="individual">个人</option><option value="organization">企业</option>
              </select>
            </span>
            {typeLocked ? <button type="button" disabled={busy} onClick={() => onCustomerTypeChange(state.customerType === "individual" ? "organization" : "individual")} data-testid="onboarding-change-type" className="mt-2 text-[11px] font-semibold text-primary underline underline-offset-2">结束当前号码会话并改为{state.customerType === "individual" ? "企业" : "个人"}</button> : null}
          </label>
          <label className="text-[13px] font-semibold text-ink dark:text-slate-200">
            主要号码（必填 · OTP 可后补）
            <div className="mt-1.5 flex min-w-0 flex-col gap-2 sm:flex-row">
              <input
                type="tel"
                inputMode="tel"
                disabled={phoneChangeDisabled}
                value={state.primaryPhone}
                onChange={(event) => onPhoneChange(event.target.value)}
                data-testid="onboarding-phone"
                placeholder="+1 876 555 0000"
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100"
              />
              <button type="button" disabled={busy || state.onboardingToken !== null || !state.primaryPhone.trim()} onClick={onCheckPhone} data-testid="onboarding-check-phone" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-primary bg-white px-4 text-xs font-bold text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-900"><Search size={14} aria-hidden />{state.primaryPhone.trim() ? "查询号码" : "请先填写号码"}</button>
            </div>
          </label>
        </div>

        {state.phoneStatus === "duplicate" ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-800 dark:bg-rose-950/30">
            <p className="text-xs font-bold text-rose-800 dark:text-rose-200">该号码已登记，不能重复创建客户。</p>
            <div className="mt-2 grid gap-2">
              {matchGroups.map(({ match, fields }) => (
                <div key={match.customerId} className="flex flex-col gap-2 rounded-lg bg-white p-3 text-xs dark:bg-slate-900 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 text-ink-soft dark:text-slate-300">
                    <strong className="text-ink dark:text-slate-100">{match.customerDisplayName}</strong> · {match.customerId}<br />
                    {[...fields].map((field) => fieldLabel[field]).join("、")} · {formatPhoneE164(match.phoneE164)}
                  </div>
                  <Link href={`/customers/${encodeURIComponent(match.customerId)}`} data-testid={`onboarding-existing-customer-${match.customerId}`} className="inline-flex min-h-9 items-center justify-center rounded-lg bg-primary px-3 font-bold text-white">打开客户档案</Link>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(220px,1fr)_auto] sm:items-end">
            <button
              type="button"
              disabled={busy || state.phoneStatus !== "clear" || Boolean(state.otpChallenge)}
              onClick={onSendOtp}
              data-testid="onboarding-send-otp"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShieldCheck size={14} aria-hidden />{state.otpChallenge ? "验证码已发送" : "发送验证码"}
            </button>
            {state.otpChallenge && !state.otpVerification ? (
              <label className="text-[13px] font-semibold text-ink dark:text-slate-200">
                演示验证码
                <input ref={otpRef} value={otpCode} onChange={(event) => onOtpCodeChange(event.target.value)} data-testid="onboarding-otp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="输入 123456" className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm tracking-[0.28em] text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100" />
              </label>
            ) : <p className="text-xs leading-5 text-ink-soft dark:text-slate-400">{state.phoneStatus === "missing" ? "请填写主要号码才能继续建档；OTP 验证码可稍后补验。" : "号码查重通过后可选发送验证码（OTP），不验证也可继续建档。"}</p>}
            {state.otpChallenge && !state.otpVerification ? <button type="button" disabled={busy || otpCode.length !== 6} onClick={onVerifyOtp} data-testid="onboarding-verify-otp" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-primary px-4 text-xs font-bold text-primary disabled:opacity-40"><CheckCircle2 size={14} aria-hidden />验证号码</button> : null}
          </div>
        )}
        {error ? <p data-testid="onboarding-phone-error" role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
      </div>
    </section>
  );
}
