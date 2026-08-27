"use client";

import { useEffect, useMemo, useState } from "react";
import { History, ShieldCheck } from "lucide-react";
import type { CustomerRecord } from "@/lib/customers/types";
import type { AgreementRecord, EvidenceAsset, KycVerificationRecord, OtpVerificationRecord } from "@/lib/customers/verification-types";
import {
  deriveAgreementVerification,
  deriveKycVerification,
  deriveOtpVerification,
} from "@/lib/customers/verification-domain";
import { formatPhoneE164 } from "@/lib/customers/phone";
import { formatDateTime } from "@/lib/utils";
import { AgreementEvidenceDialog } from "./agreement-evidence-dialog";
import { CURRENT_CUSTOMER_AGREEMENT_VERSION, currentSessionKey } from "./detail-shared";
import { EvidenceAssetViewer } from "./evidence-asset-viewer";
import { KycVerificationDialog } from "./kyc-verification-dialog";
import { OtpVerificationDialog } from "./otp-verification-dialog";

interface VerificationEvidenceSectionProps {
  customer: CustomerRecord;
  onChanged: (customer: CustomerRecord) => void;
}

function readBoundSession(): { key: string; actorId: string } {
  if (typeof window === "undefined") return { key: "server", actorId: "invalid" };
  const raw = window.localStorage.getItem("wh_session");
  if (!raw) return { key: "anonymous", actorId: "invalid" };
  try {
    const session = JSON.parse(raw) as { identity?: { id?: unknown; role?: unknown } };
    const actorId = session.identity?.id;
    const role = session.identity?.role;
    if (typeof actorId !== "string" || !actorId.trim() || /data\s*:/i.test(actorId)
      || typeof role !== "string" || !role.trim()) {
      return { key: "invalid", actorId: "invalid" };
    }
    return { key: `${actorId}:${role}`, actorId };
  } catch {
    return { key: "invalid", actorId: "invalid" };
  }
}

type Tone = "success" | "warning" | "danger";
type OtpDialogState = { mode: "invalidate" | "verify"; trigger: HTMLElement | null } | null;
type KycDialogState = { mode: "submit" | "profile"; trigger: HTMLElement | null } | null;
type ViewerState = { asset: EvidenceAsset; title: string; trigger: HTMLElement | null } | null;

function ToneBadge({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone === "success"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : tone === "danger"
        ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
        : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"}`}>
      {children}
    </span>
  );
}

function CardButton({ children, onClick }: { children: string; onClick: (trigger: HTMLElement) => void }) {
  return (
    <button type="button" onClick={(event) => onClick(event.currentTarget)} className="inline-flex min-h-8 items-center rounded-lg border border-line bg-white px-2.5 text-[11px] font-semibold text-primary hover:border-primary-200 dark:border-slate-600 dark:bg-slate-800 dark:text-primary-300">
      {children}
    </button>
  );
}

type EvidenceGapReason = "legacy_completion_without_evidence" | "onboarding_incomplete" | undefined;

function otpGapReason(customer: CustomerRecord): EvidenceGapReason {
  return customer.verificationArchive.evidenceGaps.find((gap) => gap.kind === "otp")?.reason;
}

function kycGapReason(customer: CustomerRecord): EvidenceGapReason {
  return customer.verificationArchive.evidenceGaps.find((gap) => gap.kind === "kyc"
    && (gap.reason === "legacy_completion_without_evidence"
      ? customer.customerType === "individual"
      : gap.subjectType === (customer.customerType === "organization" ? "organization_primary_contact" : "customer")))?.reason;
}

function otpDescription(
  customer: CustomerRecord,
  record: OtpVerificationRecord | undefined,
  status: string,
  gapReason: EvidenceGapReason,
): string {
  if (status === "verified" && record) return `${formatPhoneE164(record.phoneE164)} · 验证于 ${formatDateTime(record.verifiedAt ?? record.requestedAt)}`;
  if (status === "pending" && record) return `${formatPhoneE164(record.phoneE164)} · 验证码待确认`;
  if (status === "needs_reverification" && record) return `${formatPhoneE164(record.phoneE164)} 已失效或与当前号码不一致`;
  if (status === "evidence_missing") return gapReason === "legacy_completion_without_evidence"
    ? "旧完成状态没有可查号码或验证记录"
    : "手机号待补";
  return customer.phone ? `${formatPhoneE164(customer.phone)} 尚未验证` : "尚未登记可验证号码";
}

function kycDescription(
  customer: CustomerRecord,
  record: KycVerificationRecord | undefined,
  status: string,
  gapReason: EvidenceGapReason,
): string {
  if (!record) return status === "evidence_missing"
    ? gapReason === "legacy_completion_without_evidence"
      ? "旧完成状态没有可查驾驶证照片"
      : customer.customerType === "organization" ? "企业主要联系人驾驶证待补" : "驾驶证待补"
    : "尚未上传驾驶证图片";
  if (status === "verified") return `人工核验于 ${formatDateTime(record.verifiedAt ?? record.submittedAt)}`;
  if (status === "needs_reverification") return `原核验已失效${record.invalidationReason ? `：${record.invalidationReason}` : ""}`;
  return `提交于 ${formatDateTime(record.submittedAt)}，等待人工核验`;
}

function agreementDescription(record: AgreementRecord | undefined, status: string): string {
  if (!record) return status === "evidence_missing" ? "旧完成状态没有文件或纸质调取位置" : `尚未登记 ${CURRENT_CUSTOMER_AGREEMENT_VERSION} 版协议`;
  return `${record.medium === "electronic" ? "电子版" : "纸质版"} · ${record.version} · ${record.signedBy} · ${formatDateTime(record.signedAt)}`;
}

function VerificationHistory({ customer }: { customer: CustomerRecord }) {
  const [open, setOpen] = useState(false);
  const count = customer.verificationArchive.otpRecords.length
    + customer.verificationArchive.kycRecords.length
    + customer.verificationArchive.agreementRecords.length;
  return (
    <div className="mt-3 border-t border-line pt-3 dark:border-slate-700">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[11px] font-semibold text-ink-soft dark:border-slate-600 dark:text-slate-300">
        <History size={12} aria-hidden />{open ? "收起全部验证历史" : `查看全部验证历史（${count}）`}
      </button>
      {open ? (
        <div data-testid="customer-verification-history" className="mt-2 grid gap-2 lg:grid-cols-3">
          <HistoryList title="OTP 历史" items={customer.verificationArchive.otpRecords.map((record) => ({
            id: record.id,
            line: `${formatPhoneE164(record.phoneE164)} · ${record.invalidatedAt ? `已作废（${record.invalidationReason ?? "未注明原因"}）` : record.verifiedAt ? "已验证" : "待验证"}`,
            time: record.invalidatedAt ?? record.verifiedAt ?? record.requestedAt,
          }))} />
          <HistoryList title="KYC 历史" items={customer.verificationArchive.kycRecords.map((record) => ({
            id: record.id,
            line: `${record.subjectType === "organization_primary_contact"
              ? `主要联系人：${record.subjectProfile.name}`
              : customer.customerType === "organization" ? "主体待确认" : "客户本人"} · ${record.invalidatedAt ? `已失效（${record.invalidationReason ?? "未注明原因"}）` : record.verifiedAt ? "已核验" : "待核验"}`,
            time: record.invalidatedAt ?? record.verifiedAt ?? record.submittedAt,
          }))} />
          <HistoryList title="协议历史" items={customer.verificationArchive.agreementRecords.map((record) => ({
            id: record.id,
            line: `${record.medium === "electronic" ? "电子版" : "纸质版"} · ${record.version}${record.version === CURRENT_CUSTOMER_AGREEMENT_VERSION ? "" : " · 已过期"}`,
            time: record.signedAt,
          }))} />
        </div>
      ) : null}
    </div>
  );
}

function HistoryList({ title, items }: { title: string; items: Array<{ id: string; line: string; time: string }> }) {
  return (
    <div className="rounded-xl bg-surface p-3 dark:bg-slate-900/50">
      <p className="text-xs font-bold text-ink dark:text-slate-100">{title}</p>
      {items.length === 0 ? <p className="mt-2 text-[11px] text-ink-soft dark:text-slate-400">无记录</p> : (
        <ol className="mt-2 space-y-1.5">
          {[...items].reverse().map((item) => (
            <li key={item.id} className="rounded-lg border border-line bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[11px] font-semibold text-ink dark:text-slate-200">{item.line}</p>
              <p className="mt-0.5 font-mono text-[9px] text-ink-soft dark:text-slate-400">{formatDateTime(item.time)} · {item.id}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function VerificationEvidenceSection({ customer, onChanged }: VerificationEvidenceSectionProps) {
  const [boundSession] = useState(readBoundSession);
  const otp = useMemo(() => deriveOtpVerification(customer.verificationArchive, customer.phone), [customer]);
  const kyc = useMemo(() => deriveKycVerification(
    customer.verificationArchive,
    customer.customerType === "organization"
      ? { type: "organization_primary_contact", currentName: customer.nameSourceValue }
      : { type: "customer" },
  ), [customer]);
  const agreement = useMemo(() => deriveAgreementVerification(customer.verificationArchive, CURRENT_CUSTOMER_AGREEMENT_VERSION), [customer]);
  const [otpDialog, setOtpDialog] = useState<OtpDialogState>(null);
  const [kycDialog, setKycDialog] = useState<KycDialogState>(null);
  const [agreementTrigger, setAgreementTrigger] = useState<HTMLElement | null | undefined>(undefined);
  const [viewer, setViewer] = useState<ViewerState>(null);

  useEffect(() => {
    const clearSessionBoundUi = () => {
      if (currentSessionKey() === boundSession.key) return;
      setOtpDialog(null);
      setKycDialog(null);
      setAgreementTrigger(undefined);
      setViewer(null);
    };
    window.addEventListener("storage", clearSessionBoundUi);
    window.addEventListener("popstate", clearSessionBoundUi);
    return () => {
      window.removeEventListener("storage", clearSessionBoundUi);
      window.removeEventListener("popstate", clearSessionBoundUi);
    };
  }, [boundSession.key]);

  const acceptChanged = (next: CustomerRecord) => {
    if (currentSessionKey() !== boundSession.key) return;
    onChanged(next);
  };
  const openViewer = (asset: EvidenceAsset, title: string, trigger: HTMLElement) => setViewer({ asset, title, trigger });

  const otpTone: Tone = otp.status === "verified" ? "success" : otp.status === "pending" || otp.status === "unverified" ? "warning" : "danger";
  const kycTone: Tone = kyc.status === "verified" ? "success" : kyc.status === "pending" ? "warning" : "danger";
  const agreementTone: Tone = agreement.status === "signed" ? "success" : agreement.status === "pending" ? "warning" : "danger";
  const activeKyc = kyc.activeRecord;
  const currentOtpGapReason = otpGapReason(customer);
  const currentKycGapReason = kycGapReason(customer);
  const electronicAgreement = agreement.activeRecord?.medium === "electronic" ? agreement.activeRecord : null;
  const paperAgreement = agreement.activeRecord?.medium === "paper" ? agreement.activeRecord : null;

  return (
    <>
      <section data-testid="customer-verification-section" className="rounded-2xl border border-line bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <ShieldCheck size={15} className="shrink-0 text-primary" aria-hidden />
          <h3 className="text-sm font-bold text-ink dark:text-slate-100">验证证据与客户协议</h3>
          <span className="text-[10px] text-ink-soft dark:text-slate-400">所有状态都可追溯、可调取、可重新验证 · 未补齐只提醒不阻止办理</span>
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          <article data-testid="customer-otp-evidence-card" className="h-full min-w-0 rounded-xl bg-surface dark:bg-slate-900/50">
            <div data-testid="verification-row-otp" className="flex h-full min-w-0 flex-col px-3 py-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink dark:text-slate-100">手机号 OTP</p>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-soft dark:text-slate-400">{otpDescription(customer, otp.activeRecord, otp.status, currentOtpGapReason)}</p>
              </div>
              <ToneBadge tone={otpTone}>{otp.status === "verified" ? "已验证" : otp.status === "pending" ? "验证中" : otp.status === "needs_reverification" ? "需重新验证" : otp.status === "evidence_missing" ? "证据待补" : "待补验证"}</ToneBadge>
            </div>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              {otp.status === "verified" && otp.activeRecord ? <CardButton onClick={(trigger) => setOtpDialog({ mode: "invalidate", trigger })}>标记联系不上</CardButton> : null}
              <CardButton onClick={(trigger) => setOtpDialog({ mode: "verify", trigger })}>{otp.status === "pending" ? "继续 OTP" : "重新 OTP"}</CardButton>
            </div>
            </div>
          </article>

          <article data-testid="customer-kyc-evidence-card" className="h-full min-w-0 rounded-xl bg-surface dark:bg-slate-900/50">
            <div data-testid="verification-row-kyc" className="flex h-full min-w-0 flex-col px-3 py-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink dark:text-slate-100">{customer.customerType === "organization" ? "主要联系人驾驶证" : "驾驶证 KYC"}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-soft dark:text-slate-400">{kycDescription(customer, kyc.activeRecord, kyc.status, currentKycGapReason)}</p>
              </div>
              <ToneBadge tone={kycTone}>{kyc.status === "verified" ? "已核验" : kyc.status === "needs_reverification" ? "需重新核验" : customer.customerType === "organization" ? kyc.activeRecord ? "待核验" : "待补" : kyc.status === "evidence_missing" ? "证据待补" : kyc.activeRecord ? "待人工核验" : "待补 KYC"}</ToneBadge>
            </div>
            {activeKyc?.subjectType === "organization_primary_contact" ? (
              <dl data-testid="organization-contact-license-profile" className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] leading-4 text-ink-soft dark:text-slate-400">
                <div><dt className="font-medium">联系人姓名</dt><dd className="break-words font-semibold text-ink dark:text-slate-200">{activeKyc.subjectProfile.name}</dd></div>
                <div><dt className="font-medium">出生日期</dt><dd className="font-semibold text-ink dark:text-slate-200">{activeKyc.subjectProfile.birthDate}</dd></div>
                <div><dt className="font-medium">性别</dt><dd className="font-semibold text-ink dark:text-slate-200">{activeKyc.subjectProfile.sex === "F" ? "女" : "男"}</dd></div>
                <div><dt className="font-medium">证件地址</dt><dd className="break-words font-semibold text-ink dark:text-slate-200">{activeKyc.subjectProfile.address}</dd></div>
              </dl>
            ) : null}
            {customer.customerType === "organization" && kyc.status === "needs_reverification" && activeKyc ? (
              <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">当前主要联系人姓名与证件快照不同；历史证据已保留，请重新核验。</p>
            ) : null}
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              {activeKyc ? <CardButton onClick={(trigger) => openViewer(activeKyc.frontAsset, "驾驶证正面证据", trigger)}>查看驾驶证</CardButton> : null}
              {activeKyc?.backAsset ? <CardButton onClick={(trigger) => openViewer(activeKyc.backAsset!, "驾驶证背面证据", trigger)}>查看驾驶证背面</CardButton> : null}
              {customer.customerType === "individual" && kyc.status === "verified" && activeKyc ? <CardButton onClick={(trigger) => setKycDialog({ mode: "profile", trigger })}>核对正式资料</CardButton> : null}
              <CardButton onClick={(trigger) => setKycDialog({ mode: "submit", trigger })}>{customer.customerType === "organization"
                ? activeKyc ? kyc.status === "pending" ? "继续核验主要联系人驾驶证" : "重新核验主要联系人驾驶证" : "补录主要联系人驾驶证"
                : kyc.status === "pending" && activeKyc ? "继续 KYC" : activeKyc ? "重新 KYC" : "补充驾驶证"}</CardButton>
            </div>
            </div>
          </article>

          <article data-testid="customer-agreement-evidence-card" className="h-full min-w-0 rounded-xl bg-surface dark:bg-slate-900/50">
            <div data-testid="verification-row-agreement" className="flex h-full min-w-0 flex-col px-3 py-3">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink dark:text-slate-100">客户服务协议</p>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-soft dark:text-slate-400">{agreementDescription(agreement.activeRecord, agreement.status)}</p>
                {agreement.activeRecord?.medium === "paper" && (agreement.activeRecord.physicalRecordNumber || agreement.activeRecord.physicalStorageLocation) ? (
                  <p className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">档案号：{agreement.activeRecord.physicalRecordNumber ?? "—"} · 位置：{agreement.activeRecord.physicalStorageLocation ?? "—"}</p>
                ) : null}
              </div>
              <ToneBadge tone={agreementTone}>{agreement.status === "signed" ? "已签署" : agreement.status === "expired" ? "协议已过期" : agreement.status === "evidence_missing" ? "证据待补" : "待签署"}</ToneBadge>
            </div>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              {electronicAgreement ? (
                <>
                  <CardButton onClick={(trigger) => openViewer(electronicAgreement.signedDocumentAsset, "电子协议签署文件", trigger)}>查看签署文件</CardButton>
                  <CardButton onClick={(trigger) => openViewer(electronicAgreement.signatureAsset, "电子签名证据", trigger)}>查看电子签名</CardButton>
                </>
              ) : paperAgreement?.paperScanAsset ? (
                <CardButton onClick={(trigger) => openViewer(paperAgreement.paperScanAsset!, "纸质协议扫描件", trigger)}>查看纸质协议</CardButton>
              ) : null}
              <CardButton onClick={(trigger) => setAgreementTrigger(trigger)}>{agreement.activeRecord ? "重新登记协议" : "登记协议"}</CardButton>
            </div>
            </div>
          </article>
        </div>
        <VerificationHistory customer={customer} />
      </section>

      {otpDialog ? (
        <OtpVerificationDialog
          customer={customer}
          activeRecord={otp.activeRecord}
          mode={otpDialog.mode}
          boundSessionKey={boundSession.key}
          returnFocusElement={otpDialog.trigger}
          onClose={() => setOtpDialog(null)}
          onChanged={acceptChanged}
          onDone={(next) => { setOtpDialog(null); acceptChanged(next); }}
        />
      ) : null}
      {kycDialog ? (
        <KycVerificationDialog
          customer={customer}
          existingRecord={kyc.activeRecord}
          mode={kycDialog.mode}
          boundSessionKey={boundSession.key}
          boundActorId={boundSession.actorId}
          returnFocusElement={kycDialog.trigger}
          onClose={() => setKycDialog(null)}
          onChanged={acceptChanged}
        />
      ) : null}
      {agreementTrigger !== undefined ? (
        <AgreementEvidenceDialog
          customer={customer}
          boundSessionKey={boundSession.key}
          boundActorId={boundSession.actorId}
          returnFocusElement={agreementTrigger}
          onClose={() => setAgreementTrigger(undefined)}
          onChanged={acceptChanged}
        />
      ) : null}
      <EvidenceAssetViewer
        asset={viewer?.asset ?? null}
        title={viewer?.title}
        returnFocusElement={viewer?.trigger}
        onClose={() => setViewer(null)}
      />
    </>
  );
}
