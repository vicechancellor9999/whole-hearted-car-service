"use client";

import { Camera, CheckCircle2, FileImage, Keyboard, ScanLine, ShieldAlert } from "lucide-react";
import type { LicenseExtractionField } from "@/lib/customers/license-extraction/types";
import type { LicenseImageTransform } from "@/lib/customers/license-extraction/image-input";
import type { CustomerOnboardingState } from "./customer-onboarding-state";
import { LicenseImageEditor } from "./license-image-editor";

type LicenseMode = "ai" | "manual";
type LicenseExtractionUiState = "idle" | "running" | "success" | "error";

interface OnboardingLicenseStepProps {
  readonly subjectLabel: "客户" | "企业主要联系人";
  readonly optional: true;
  readonly state: CustomerOnboardingState;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly mode: LicenseMode;
  readonly imageUrl: string | null;
  readonly extractionReady: boolean;
  readonly transform: LicenseImageTransform;
  readonly extractionStatus: Readonly<Record<LicenseExtractionField, "extracted" | "manual_required">>;
  readonly extractionState: LicenseExtractionUiState;
  readonly extractionProgress: number | null;
  readonly error: string | null;
  readonly onModeChange: (mode: LicenseMode) => void;
  readonly onFileChange: (file: File | null) => void;
  readonly onTransformChange: (transform: LicenseImageTransform) => void;
  readonly onExtract: () => void;
  readonly onFieldChange: (field: LicenseExtractionField, value: string) => void;
  readonly onAttestationChange: (checked: boolean) => void;
}

export function OnboardingLicenseStep({
  subjectLabel,
  optional,
  state,
  disabled,
  busy,
  mode,
  imageUrl,
  extractionReady,
  transform,
  extractionStatus,
  extractionState,
  extractionProgress,
  error,
  onModeChange,
  onFileChange,
  onTransformChange,
  onExtract,
  onFieldChange,
  onAttestationChange,
}: OnboardingLicenseStepProps) {
  const profile = state.licenseProfile;
  const contactSubject = subjectLabel === "企业主要联系人";
  const complete = Boolean(profile.name.trim() && profile.birthDate && profile.sex && profile.address.trim());
  const fieldHint = (field: LicenseExtractionField) => extractionStatus[field] === "manual_required"
    ? <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">请人工填写</span>
    : null;

  return (
    <section data-testid="onboarding-license-step" aria-disabled={disabled} className={`overflow-hidden rounded-2xl border border-line bg-white shadow-card transition-opacity dark:border-slate-700 dark:bg-slate-800/70 ${disabled ? "opacity-55" : ""}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-4 dark:bg-slate-900/50 sm:px-6">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary dark:bg-primary/15 dark:text-primary-300"><ScanLine size={18} aria-hidden /></span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">第二步</p>
          <h3 className="text-base font-bold text-ink dark:text-slate-100">{subjectLabel}驾驶证{optional ? "（选填）" : ""}</h3>
        </div>
        <span data-testid="onboarding-kyc-status" className={`ml-auto rounded-full px-3 py-1 text-[11px] font-bold ${state.kycConfirmation ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-primary-50 text-primary dark:bg-primary/10 dark:text-primary-300"}`}>{state.kycConfirmation ? "驾驶证已人工核验" : disabled ? "请先查询号码或选择无号码继续" : imageUrl ? "等待员工确认" : "可跳过，建档后补录"}</span>
      </div>
      <fieldset disabled={disabled || busy} className="space-y-5 p-4 disabled:cursor-not-allowed sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" aria-pressed={mode === "ai"} onClick={() => onModeChange("ai")} data-testid="onboarding-license-mode-ai" className={`flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left ${mode === "ai" ? "border-primary bg-primary-50/60 ring-1 ring-primary dark:bg-primary/10" : "border-line bg-white dark:bg-slate-900"}`}><ScanLine className="shrink-0 text-primary" size={21} aria-hidden /><span><strong className="block text-sm text-ink dark:text-slate-100">驾驶证 AI 辅助识别</strong><span className="mt-1 block text-xs text-ink-soft dark:text-slate-400">选择后使用下方AI辅助识别按钮</span></span></button>
          <button type="button" aria-pressed={mode === "manual"} onClick={() => onModeChange("manual")} data-testid="onboarding-license-mode-manual" className={`flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left ${mode === "manual" ? "border-primary bg-primary-50/60 ring-1 ring-primary dark:bg-primary/10" : "border-line bg-white dark:bg-slate-900"}`}><Keyboard className="shrink-0 text-primary" size={21} aria-hidden /><span><strong className="block text-sm text-ink dark:text-slate-100">对照原件手动填写</strong><span className="mt-1 block text-xs text-ink-soft dark:text-slate-400">仍需上传证据并现场确认</span></span></button>
        </div>

        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-200"><ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden />纯 Mock 演示，请勿上传真实客户证件</p>

        {!imageUrl ? (
          <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/35 bg-surface px-4 text-center hover:border-primary dark:bg-slate-900/50">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-50 text-primary dark:bg-primary/10"><Camera size={21} aria-hidden /></span>
            <strong className="mt-3 text-sm text-ink dark:text-slate-100">选择或拍摄驾驶证正面</strong>
            <span className="mt-1 text-xs text-ink-soft dark:text-slate-400">仅支持 JPEG、PNG，不支持 PDF</span>
            <input type="file" accept="image/jpeg,image/png" capture="environment" data-testid="onboarding-license-file" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} className="sr-only" />
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="inline-flex items-center gap-2 text-xs font-semibold text-ink dark:text-slate-200"><FileImage size={15} className="text-primary" aria-hidden />已加载驾驶证正面证据</p>
              <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-primary px-3 text-xs font-bold text-primary">更换图片<input type="file" accept="image/jpeg,image/png" capture="environment" data-testid="onboarding-license-file" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} className="sr-only" /></label>
            </div>
            <LicenseImageEditor imageUrl={imageUrl} transform={transform} disabled={busy} onChange={onTransformChange} />
          </div>
        )}

        {imageUrl && mode === "ai" && extractionReady ? (
          <button type="button" data-testid="onboarding-license-extract" disabled={extractionState === "running"} onClick={onExtract} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {extractionState === "running" ? "识别中…" : extractionState === "error" ? "重新尝试AI辅助识别" : "AI辅助识别"}
          </button>
        ) : null}

        {extractionProgress !== null ? (
          <div data-testid="onboarding-extraction-progress" role="progressbar" aria-label="驾驶证 AI 辅助识别进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={extractionProgress} className="rounded-xl bg-primary-50 p-3 dark:bg-primary/10">
            <div className="h-2 overflow-hidden rounded-full bg-white dark:bg-slate-800"><div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${extractionProgress}%` }} /></div>
            <p className="mt-2 text-[11px] font-semibold text-primary dark:text-primary-300">识别中…</p>
          </div>
        ) : null}
        {extractionState === "success" ? <p data-testid="onboarding-extraction-status" className="rounded-xl bg-surface px-3 py-2 text-xs font-semibold text-ink-soft dark:bg-slate-900 dark:text-slate-300">模拟 AI 辅助结果（仅演示）</p> : null}
        {extractionState === "error" ? <p data-testid="onboarding-extraction-status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-950/35 dark:text-amber-200">AI辅助识别当前不可用，请对照原件手动填写</p> : null}
        {mode === "manual" ? <p className="rounded-xl bg-surface px-3 py-2 text-xs font-semibold text-ink-soft dark:bg-slate-900 dark:text-slate-300">已选择手动模式，请对照原件填写四项</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[13px] font-semibold text-ink dark:text-slate-200">{contactSubject ? "联系人姓名" : "姓名"} <span className="text-rose-600" aria-hidden>*</span>{fieldHint("name")}<input value={profile.name} onChange={(event) => onFieldChange("name", event.target.value)} data-testid="onboarding-license-name" className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100" /></label>
          <label className="text-[13px] font-semibold text-ink dark:text-slate-200">{contactSubject ? "联系人出生日期" : "出生日期"} <span className="text-rose-600" aria-hidden>*</span>{fieldHint("birthDate")}<input type="date" value={profile.birthDate} onChange={(event) => onFieldChange("birthDate", event.target.value)} data-testid="onboarding-license-birth-date" className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100" /></label>
          <label className="text-[13px] font-semibold text-ink dark:text-slate-200">{contactSubject ? "联系人性别" : "性别"} <span className="text-rose-600" aria-hidden>*</span>{fieldHint("sex")}<select value={profile.sex} onChange={(event) => onFieldChange("sex", event.target.value)} data-testid="onboarding-license-sex" className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100"><option value="">请选择</option><option value="M">M / 男</option><option value="F">F / 女</option></select></label>
          <label className="text-[13px] font-semibold text-ink dark:text-slate-200 sm:col-span-2">{contactSubject ? "联系人证件地址" : "地址"} <span className="text-rose-600" aria-hidden>*</span>{fieldHint("address")}<textarea value={profile.address} onChange={(event) => onFieldChange("address", event.target.value)} data-testid="onboarding-license-address" rows={3} className="mt-1.5 w-full resize-y rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100" /></label>
        </div>

        <label className={`flex items-start gap-3 rounded-2xl border p-4 ${state.licenseAttested ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30" : "border-line bg-surface dark:bg-slate-900/50"}`}>
          <input type="checkbox" checked={state.licenseAttested} disabled={!imageUrl || !complete || busy || extractionState === "running"} onChange={(event) => onAttestationChange(event.target.checked)} data-testid="onboarding-license-attestation" className="mt-0.5 h-4 w-4 accent-primary" />
          <span className="text-xs font-semibold leading-5 text-ink dark:text-slate-200">已核对到场{subjectLabel}及驾驶证原件，以上四项与原件一致</span>
          {state.kycConfirmation ? <CheckCircle2 size={17} className="ml-auto shrink-0 text-emerald-600" aria-hidden /> : null}
        </label>
        {error ? <p data-testid="onboarding-license-error" role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p> : null}
      </fieldset>
    </section>
  );
}
