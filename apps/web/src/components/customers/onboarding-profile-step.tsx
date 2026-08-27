"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ContactRound, Languages, UserRoundCheck } from "lucide-react";
import type { CustomerNamePreview, CustomerRecord, CustomerStatus, PreferredChannel } from "@/lib/customers/types";
import type { OnboardingReminder } from "@/lib/customers/onboarding-types";
import type { CustomerOnboardingState } from "./customer-onboarding-state";
import { customerDisplayName } from "./customer-list";

export interface OnboardingProfileFields {
  organizationName: string;
  primaryContactRole: string;
  salutation: string;
  language: string;
  secondaryPhone: string;
  whatsapp: string;
  email: string;
  preferredChannel: PreferredChannel;
  address: string;
  gender: string;
  birthDate: string;
  trn: string;
  status: CustomerStatus;
  reason: string;
}

function counterpart(preview: CustomerNamePreview | null): string {
  if (!preview) return "确认后显示只读对应音译";
  return preview.sourceScript === "zh" ? preview.nameEn : preview.nameZh ?? "当前离线音译库不支持，请核对姓名";
}

const fieldClass = "mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-900 dark:text-slate-100";
const labelClass = "min-w-0 text-[13px] font-semibold text-ink dark:text-slate-200";

function reminderText(reminder: OnboardingReminder): string {
  if (reminder.kind === "otp") {
    if (reminder.status === "phone_missing") return "未填写主要号码；建档后补录号码并完成 OTP。";
    if (reminder.status === "not_requested") return "验证码尚未请求；建档后可继续完成 OTP。";
    return "验证码待完成；建档后继续完成当前 OTP 核验。";
  }
  const subject = reminder.subjectType === "organization_primary_contact" ? "企业主要联系人" : "客户";
  if (reminder.kind === "kyc_profile_mismatch") {
    return `${subject}驾驶证四项与正式资料不同；以正式资料建档并后续核对。`;
  }
  return reminder.status === "evidence_missing"
    ? `${subject}驾驶证证据未提交；建档后补录。`
    : `${subject}驾驶证待核验；建档后继续完成。`;
}

export function OnboardingProfileStep({
  state,
  fields,
  customers,
  disabled,
  busy,
  nameError,
  onNameChange,
  onConfirmName,
  onFieldChange,
}: {
  state: CustomerOnboardingState;
  fields: OnboardingProfileFields;
  customers: readonly CustomerRecord[];
  disabled: boolean;
  busy: boolean;
  nameError: string | null;
  onNameChange: (value: string) => void;
  onConfirmName: () => void;
  onFieldChange: <K extends keyof OnboardingProfileFields>(field: K, value: OnboardingProfileFields[K]) => void;
}) {
  const candidates = state.customerPreview?.candidates ?? [];
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const conflictOwners = [...state.previewPhoneMatches.reduce((owners, match) => {
    const existing = owners.get(match.customerId);
    if (existing) existing.matches.push(match);
    else owners.set(match.customerId, { owner: match, matches: [match] });
    return owners;
  }, new Map<string, { owner: (typeof state.previewPhoneMatches)[number]; matches: (typeof state.previewPhoneMatches)[number][] }>()).values()];

  return (
    <section data-testid="onboarding-profile-step" aria-disabled={disabled} className={`overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-opacity dark:border-slate-700 dark:bg-slate-800/70 ${disabled ? "opacity-55" : ""}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-4 dark:bg-slate-900/50 sm:px-6">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary dark:bg-primary/15 dark:text-primary-300"><ContactRound size={18} aria-hidden /></span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">第三步</p>
          <h3 className="text-base font-bold text-ink dark:text-slate-100">确认姓名与正式客户资料</h3>
        </div>
        <span className={`ml-auto rounded-full px-3 py-1 text-[11px] font-bold ${state.customerPreview ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-primary-50 text-primary dark:bg-primary/10 dark:text-primary-300"}`}>{state.customerPreview ? "最终预览已生成" : disabled ? "请先完成前一步" : "等待检查并预览"}</span>
      </div>
      <fieldset disabled={disabled || busy} className="space-y-5 p-4 sm:p-6">
        {state.customerType === "organization" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>企业名称 <span className="text-rose-600" aria-hidden>*</span><input value={fields.organizationName} onChange={(event) => onFieldChange("organizationName", event.target.value)} data-testid="onboarding-organization-name" className={fieldClass} /></label>
            <label className={labelClass}>主要联系人职位／关系<input value={fields.primaryContactRole} onChange={(event) => onFieldChange("primaryContactRole", event.target.value)} data-testid="onboarding-primary-contact-role" className={fieldClass} /></label>
          </div>
        ) : null}

        <div className="rounded-2xl border border-primary/20 bg-primary-50/35 p-4 dark:bg-primary/5">
          <div className="mb-3 flex items-center gap-2"><Languages size={16} className="text-primary" aria-hidden /><p className="text-sm font-bold text-ink dark:text-slate-100">单一姓名来源与对应音译</p></div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className={labelClass}>{state.customerType === "organization" ? "主要联系人姓名" : "客户姓名"} <span className="text-rose-600" aria-hidden>*</span><input value={state.nameSourceValue} onChange={(event) => onNameChange(event.target.value)} data-testid="onboarding-name-source" className={fieldClass} /></label>
            <button type="button" disabled={!state.nameSourceValue.trim() || busy} onClick={onConfirmName} data-testid="customer-name-transliteration-confirm" className="min-h-11 self-end rounded-xl border border-primary bg-white px-4 text-xs font-bold text-primary disabled:opacity-40 dark:bg-slate-900">确认姓名音译</button>
            <output data-testid="customer-name-transliteration-preview" className="min-h-11 rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm font-semibold text-ink-soft dark:bg-slate-900 dark:text-slate-300 sm:col-span-2">{counterpart(state.namePreview)}</output>
          </div>
          {nameError ? <p role="alert" data-testid="onboarding-name-error" className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300">{nameError}</p> : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>主要号码（可选）<input value={state.normalizedPhone ?? state.primaryPhone} readOnly data-testid="onboarding-verified-phone" className={fieldClass} /></label>
          <label className={labelClass}>备用号码<input value={fields.secondaryPhone} onChange={(event) => onFieldChange("secondaryPhone", event.target.value)} data-testid="onboarding-secondary-phone" className={fieldClass} /></label>
          <label className={labelClass}>WhatsApp<input value={fields.whatsapp} onChange={(event) => onFieldChange("whatsapp", event.target.value)} data-testid="onboarding-whatsapp" className={fieldClass} /></label>
          <label className={labelClass}>Email<input type="email" value={fields.email} onChange={(event) => onFieldChange("email", event.target.value)} data-testid="onboarding-email" className={fieldClass} /></label>
          <label className={labelClass}>首选联系渠道<select value={fields.preferredChannel} onChange={(event) => onFieldChange("preferredChannel", event.target.value as PreferredChannel)} data-testid="onboarding-preferred-channel" className={fieldClass}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="phone">电话</option><option value="email">Email</option></select></label>
          <label className={labelClass}>语言<input value={fields.language} onChange={(event) => onFieldChange("language", event.target.value)} data-testid="onboarding-language" className={fieldClass} /></label>
          {state.customerType === "individual" ? <><label className={labelClass}>出生日期（驾驶证已确认）<input value={fields.birthDate} readOnly data-testid="onboarding-profile-birth-date" className={fieldClass} /></label><label className={labelClass}>性别（驾驶证已确认）<input value={fields.gender} readOnly data-testid="onboarding-profile-gender" className={fieldClass} /></label></> : null}
          <label className={labelClass}>TRN<input value={fields.trn} onChange={(event) => onFieldChange("trn", event.target.value)} data-testid="onboarding-trn" className={fieldClass} /></label>
          <label className={labelClass}>客户状态<select value={fields.status} onChange={(event) => onFieldChange("status", event.target.value as CustomerStatus)} data-testid="onboarding-status" className={fieldClass}><option value="active">活跃</option><option value="inactive">非活跃</option><option value="blacklisted">黑名单</option></select></label>
          <label className={`${labelClass} sm:col-span-2`}>地址{state.customerType === "individual" ? "（驾驶证已确认）" : ""}<textarea value={fields.address} readOnly={state.customerType === "individual"} onChange={(event) => onFieldChange("address", event.target.value)} data-testid="onboarding-address" rows={3} className={`${fieldClass} py-2.5`} /></label>
          <label className={`${labelClass} sm:col-span-2`}>建档说明<input value={fields.reason} onChange={(event) => onFieldChange("reason", event.target.value)} data-testid="onboarding-reason" className={fieldClass} /></label>
        </div>

        {state.customerPreview ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-800 dark:bg-emerald-950/25">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-200"><UserRoundCheck size={17} aria-hidden />最终资料已绑定到本次号码与证据</div>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">如修改任何资料，请重新点击“检查并预览”。</p>
          </div>
        ) : null}

        {state.previewPhoneMatches.length > 0 ? (
          <div data-testid="onboarding-phone-ownership-conflict" role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-xs dark:border-rose-800 dark:bg-rose-950/35">
            <p className="font-bold text-rose-800 dark:text-rose-200">备用号码或 WhatsApp 已属于其他客户，请修改或清空后重新预览。</p>
            <ul className="mt-2 space-y-2">
              {conflictOwners.map(({ owner, matches }) => (
                <li key={owner.customerId} className="flex flex-col gap-2 rounded-xl bg-white p-3 dark:bg-slate-900 sm:flex-row sm:items-center">
                  <span className="min-w-0 flex-1 text-ink-soft dark:text-slate-300"><strong className="text-ink dark:text-slate-100">{owner.customerDisplayName}</strong> · {owner.customerId}<br />{[...new Set(matches.map((match) => match.incomingField === "secondaryPhone" ? "备用号码" : "WhatsApp"))].join("、")}</span>
                  <Link href={`/customers/${encodeURIComponent(owner.customerId)}`} data-testid={`onboarding-preview-existing-customer-${owner.customerId}`} className="inline-flex min-h-9 items-center justify-center rounded-lg bg-primary px-3 font-bold text-white">打开客户档案</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.customerPreview && state.customerPreview.reminders.length > 0 ? (
          <div data-testid="onboarding-reminders" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs dark:border-amber-700 dark:bg-amber-950/35">
            <p className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-100"><AlertTriangle size={16} aria-hidden />可以继续建档，以下项目需后续补齐</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-amber-900 dark:text-amber-100">{state.customerPreview.reminders.map((reminder, index) => <li key={`${reminder.kind}-${index}`}>{reminderText(reminder)}</li>)}</ul>
          </div>
        ) : null}

        {candidates.length > 0 ? (
          <div data-testid="customer-duplicate-candidates" role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs dark:border-amber-700 dark:bg-amber-950/40">
            <p className="font-bold text-ink dark:text-slate-100">发现可能重复客户（号码未重复，可人工确认）</p>
            <ul className="mt-2 space-y-1.5 text-ink-soft dark:text-slate-300">{candidates.map((candidate) => {
              const customer = customerById.get(candidate.customerId);
              return <li key={candidate.customerId}>{candidate.customerId} · {customer ? customerDisplayName(customer) : candidate.customerId} · {candidate.reasons.join("、")}</li>;
            })}</ul>
            <p className="mt-3 font-semibold text-ink dark:text-slate-200">这些是名称或 Email 提醒，不阻断建档；请核对后继续。</p>
          </div>
        ) : null}
        {state.customerPreview && candidates.length === 0 ? <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"><CheckCircle2 size={15} aria-hidden />没有发现非号码重复候选，可以创建客户档案。</p> : null}
      </fieldset>
    </section>
  );
}
