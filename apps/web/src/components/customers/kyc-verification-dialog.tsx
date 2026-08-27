"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { createEvidenceAssetFromFile, EvidenceAssetError } from "@/lib/customers/evidence-assets";
import { normalizeDriverLicenseProfile } from "@/lib/customers/driver-license-profile";
import { ALICIA_LICENSE_PROFILE_FIXTURE } from "@/lib/customers/seed-evidence";
import type { CustomerDuplicateCandidate, CustomerNamePreview, CustomerRecord, SubmitCustomerKycInput } from "@/lib/customers/types";
import { deriveKycVerification } from "@/lib/customers/verification-domain";
import type { KycVerificationRecord } from "@/lib/customers/verification-types";
import { Dialog } from "@/components/ui/dialog";
import { currentSessionKey } from "./detail-shared";

interface KycVerificationDialogProps {
  customer: CustomerRecord;
  existingRecord?: KycVerificationRecord;
  mode: "submit" | "profile";
  boundSessionKey: string;
  boundActorId: string;
  onClose: () => void;
  onChanged: (customer: CustomerRecord) => void;
  returnFocusElement?: HTMLElement | null;
}

type KycPhase = "needs_submission" | "submitted" | "verifying" | "verified";

interface SubmittedKycRef {
  customerId: string;
  recordId: string;
  verifyMutationId: string;
}

interface KycSubmitAttempt {
  readonly customerId: string;
  readonly input: SubmitCustomerKycInput;
  readonly evidenceAssetIds: readonly string[];
  readonly submitMutationId: string;
  readonly verifyMutationId: string;
  readonly epoch: number;
}

function mutationId(operation: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `customer-ui-${operation}-${suffix}`;
}

function readableError(error: unknown): string {
  if (error instanceof EvidenceAssetError) return "驾驶证文件无效。请上传清晰的 JPEG 或 PNG 图片，文件不得超过证据规则允许的大小。";
  return error instanceof Error && error.message ? error.message : "驾驶证核验操作失败，请重试";
}

function isSameName(left: string | null, right: string): boolean {
  return (left ?? "").trim().localeCompare(right.trim(), undefined, { sensitivity: "base" }) === 0;
}

export function KycVerificationDialog({
  customer,
  existingRecord,
  mode,
  boundSessionKey,
  boundActorId,
  onClose,
  onChanged,
  returnFocusElement,
}: KycVerificationDialogProps) {
  const pendingExistingRecord = mode === "submit"
    && existingRecord
    && !existingRecord.verifiedAt
    && !existingRecord.invalidatedAt
    ? existingRecord
    : null;
  const pendingOrganizationRecord = pendingExistingRecord?.subjectType === "organization_primary_contact"
    ? pendingExistingRecord
    : null;
  const knownFixture = mode === "profile"
    && existingRecord?.frontAsset.id === "EVID-UAT-ALICIA-DL-FRONT";
  const initialProfile = useMemo(() => existingRecord?.subjectType === "organization_primary_contact" ? {
    name: existingRecord.subjectProfile.name,
    birthDate: existingRecord.subjectProfile.birthDate,
    gender: existingRecord.subjectProfile.sex === "F" ? "女" : "男",
    address: existingRecord.subjectProfile.address,
  } : knownFixture ? {
    name: ALICIA_LICENSE_PROFILE_FIXTURE.name,
    birthDate: ALICIA_LICENSE_PROFILE_FIXTURE.birthDate,
    gender: ALICIA_LICENSE_PROFILE_FIXTURE.sex === "F" ? "女" : "男",
    address: ALICIA_LICENSE_PROFILE_FIXTURE.address,
  } : { name: "", birthDate: "", gender: "", address: "" }, [existingRecord, knownFixture]);

  const [latestCustomer, setLatestCustomer] = useState(customer);
  const latestCustomerRef = useRef(customer);
  const [verifiedInDialog, setVerifiedInDialog] = useState(mode === "profile" && Boolean(existingRecord?.verifiedAt));
  const [name, setName] = useState(initialProfile.name);
  const [birthDate, setBirthDate] = useState(initialProfile.birthDate);
  const [gender, setGender] = useState(initialProfile.gender);
  const [address, setAddress] = useState(initialProfile.address);
  const [namePreview, setNamePreview] = useState<CustomerNamePreview | null>(null);
  const [duplicateCandidates, setDuplicateCandidates] = useState<readonly CustomerDuplicateCandidate[]>([]);
  const [pending, setPending] = useState<"kyc" | "profile" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sensitiveDraftRef = useRef({
    frontFile: null as File | null,
    backFile: null as File | null,
    name: initialProfile.name,
    birthDate: initialProfile.birthDate,
    gender: initialProfile.gender,
    address: initialProfile.address,
  });
  const activeRef = useRef(true);
  const lifecycleEpochRef = useRef(0);
  const operationEpochRef = useRef(0);
  const submitDraftEpochRef = useRef(0);
  const initialKycPhase: KycPhase = mode === "profile" && existingRecord?.verifiedAt
    ? "verified"
    : pendingExistingRecord ? "submitted" : "needs_submission";
  const [kycPhase, setKycPhaseState] = useState<KycPhase>(initialKycPhase);
  const kycPhaseRef = useRef<KycPhase>(initialKycPhase);
  const submittedKycRef = useRef<SubmittedKycRef | null>(pendingExistingRecord ? {
    customerId: customer.id,
    recordId: pendingExistingRecord.id,
    verifyMutationId: mutationId("kyc-verify"),
  } : null);
  const submitAttemptRef = useRef<KycSubmitAttempt | null>(null);

  const setKycPhase = (phase: KycPhase) => {
    kycPhaseRef.current = phase;
    setKycPhaseState(phase);
  };

  const publishLatestCustomer = (nextCustomer: CustomerRecord) => {
    latestCustomerRef.current = nextCustomer;
    setLatestCustomer(nextCustomer);
  };

  const sessionIsCurrent = () => currentSessionKey() === boundSessionKey;
  const beginOperation = () => ({
    lifecycleEpoch: lifecycleEpochRef.current,
    operationEpoch: ++operationEpochRef.current,
  });
  const acceptsOperation = (attempt: { lifecycleEpoch: number; operationEpoch: number }) => (
    activeRef.current
    && lifecycleEpochRef.current === attempt.lifecycleEpoch
    && operationEpochRef.current === attempt.operationEpoch
    && sessionIsCurrent()
  );
  const clearSensitiveRefs = () => {
    sensitiveDraftRef.current.frontFile = null;
    sensitiveDraftRef.current.backFile = null;
    sensitiveDraftRef.current.name = "";
    sensitiveDraftRef.current.birthDate = "";
    sensitiveDraftRef.current.gender = "";
    sensitiveDraftRef.current.address = "";
    submitAttemptRef.current = null;
    submittedKycRef.current = null;
  };

  const invalidateLifecycle = () => {
    activeRef.current = false;
    lifecycleEpochRef.current += 1;
    operationEpochRef.current += 1;
    submitDraftEpochRef.current += 1;
    clearSensitiveRefs();
  };

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      lifecycleEpochRef.current += 1;
      operationEpochRef.current += 1;
      submitDraftEpochRef.current += 1;
      // React Strict Mode immediately replays mount effects in development. Delay
      // only the reference release so that replay can keep the mounted draft;
      // lifecycle invalidation itself remains synchronous for in-flight requests.
      queueMicrotask(() => {
        if (!activeRef.current) clearSensitiveRefs();
      });
    };
  }, []);

  const closeDialog = () => {
    invalidateLifecycle();
    onClose();
  };

  const invalidateSubmitAttempt = () => {
    operationEpochRef.current += 1;
    submitDraftEpochRef.current += 1;
    submitAttemptRef.current = null;
    submittedKycRef.current = null;
    setKycPhase("needs_submission");
    setVerifiedInDialog(false);
    setPending(null);
    setError(null);
    setNotice(null);
  };

  const previewName = async () => {
    const sourceName = sensitiveDraftRef.current.name.trim();
    if (!sourceName) {
      setError("请先填写姓名");
      return;
    }
    if (!sessionIsCurrent()) return;
    const operation = beginOperation();
    setPending("profile");
    setError(null);
    try {
      const preview = await api.customers.previewName(sourceName);
      if (!acceptsOperation(operation)) return;
      setNamePreview(preview);
    } catch (caught) {
      if (!acceptsOperation(operation)) return;
      setNamePreview(null);
      setError(readableError(caught));
    } finally {
      if (acceptsOperation(operation)) setPending(null);
    }
  };

  const submitAndVerify = async () => {
    const draft = { ...sensitiveDraftRef.current };
    if (!submittedKycRef.current && !submitAttemptRef.current && !draft.frontFile) {
      setError("请先上传驾驶证正面");
      return;
    }
    if (customer.customerType === "organization" && !submittedKycRef.current && !submitAttemptRef.current
      && (!draft.name.trim() || !draft.birthDate || !["男", "女"].includes(draft.gender) || !draft.address.trim())) {
      setError("请填写主要联系人姓名、出生日期、性别和证件地址");
      return;
    }
    if (!sessionIsCurrent()) return;
    const operation = beginOperation();
    let submittedRef = submittedKycRef.current;
    setPending("kyc");
    setError(null);
    setNotice(null);
    try {
      let submitted = latestCustomerRef.current;
      if (!submittedRef) {
        let submitAttempt = submitAttemptRef.current;
        if (!submitAttempt) {
          const attemptEpoch = submitDraftEpochRef.current;
          const createdAt = latestCustomerRef.current.updatedAt;
          const preparedFrontAsset = await createEvidenceAssetFromFile(draft.frontFile!, boundActorId, () => createdAt);
          if (!acceptsOperation(operation) || attemptEpoch !== submitDraftEpochRef.current) return;
          const frontAsset = Object.freeze({ ...preparedFrontAsset });
          let backAsset;
          if (draft.backFile) {
            const preparedBackAsset = await createEvidenceAssetFromFile(draft.backFile, boundActorId, () => createdAt);
            if (!acceptsOperation(operation) || attemptEpoch !== submitDraftEpochRef.current) return;
            backAsset = Object.freeze({ ...preparedBackAsset });
          }
          const submitMutationId = mutationId("kyc-submit");
          const verifyMutationId = mutationId("kyc-verify");
          const input: SubmitCustomerKycInput = customer.customerType === "organization"
            ? Object.freeze({
              subjectType: "organization_primary_contact" as const,
              subjectProfile: Object.freeze(normalizeDriverLicenseProfile({
                name: draft.name,
                birthDate: draft.birthDate,
                sex: draft.gender === "女" ? "F" : "M",
                address: draft.address,
              })),
              frontAsset,
              ...(backAsset ? { backAsset } : {}),
              clientMutationId: submitMutationId,
            })
            : Object.freeze({
              frontAsset,
              ...(backAsset ? { backAsset } : {}),
              clientMutationId: submitMutationId,
            });
          submitAttempt = Object.freeze({
            customerId: latestCustomerRef.current.id,
            input,
            evidenceAssetIds: Object.freeze([frontAsset.id, ...(backAsset ? [backAsset.id] : [])]),
            submitMutationId,
            verifyMutationId,
            epoch: attemptEpoch,
          });
          if (!acceptsOperation(operation) || attemptEpoch !== submitDraftEpochRef.current) return;
          submitAttemptRef.current = submitAttempt;
        }
        submitted = await api.customers.submitKyc(submitAttempt.customerId, submitAttempt.input);
        if (!acceptsOperation(operation)
          || submitAttemptRef.current !== submitAttempt
          || submitAttempt.epoch !== submitDraftEpochRef.current) return;
        const record = submitted.verificationArchive.kycRecords.at(-1) ?? null;
        const returnedAssetIds = record
          ? [record.frontAsset.id, ...(record.backAsset ? [record.backAsset.id] : [])]
          : [];
        if (!record || record.verifiedAt
          || returnedAssetIds.length !== submitAttempt.evidenceAssetIds.length
          || returnedAssetIds.some((id, index) => id !== submitAttempt.evidenceAssetIds[index])) {
          throw new Error("未取得待人工核验的驾驶证记录，请重试");
        }
        submittedRef = {
          customerId: submitted.id,
          recordId: record.id,
          verifyMutationId: submitAttempt.verifyMutationId,
        };
        submittedKycRef.current = submittedRef;
        publishLatestCustomer(submitted);
        setKycPhase("submitted");
        setNotice("驾驶证证据已保存，正在进行人工核验。关闭后也可从客户详情继续。 ");
        onChanged(submitted);
      }
      if (!acceptsOperation(operation)) return;
      setKycPhase("verifying");
      const verified = await api.customers.verifyKyc(submittedRef.customerId, {
        kycRecordId: submittedRef.recordId,
        clientMutationId: submittedRef.verifyMutationId,
      });
      if (!acceptsOperation(operation)
        || submittedKycRef.current?.recordId !== submittedRef.recordId) return;
      publishLatestCustomer(verified);
      setKycPhase("verified");
      setVerifiedInDialog(true);
      const organizationKyc = customer.customerType === "organization"
        ? deriveKycVerification(verified.verificationArchive, {
          type: "organization_primary_contact",
          currentName: verified.nameSourceValue,
        })
        : null;
      setNotice(customer.customerType === "organization"
        ? `${pendingExistingRecord ? "主要联系人驾驶证证据已完成人工核验" : "主要联系人驾驶证证据已提交并完成人工核验"}。${organizationKyc?.status === "verified" ? "企业正式资料未更改。" : "证件姓名与当前主要联系人姓名不同，已保留证据并标记为需重新核验。"}`
        : `${pendingExistingRecord ? "驾驶证证据已完成人工核验" : "驾驶证证据已提交并完成人工核验"}。正式资料尚未更改；如需写入，请填写下方四项并再次确认。`);
      onChanged(verified);
    } catch (caught) {
      if (!acceptsOperation(operation)) return;
      if (submittedKycRef.current && kycPhaseRef.current !== "verified") setKycPhase("submitted");
      else if (!submittedKycRef.current) setKycPhase("needs_submission");
      setError(readableError(caught));
    } finally {
      if (acceptsOperation(operation)) setPending(null);
    }
  };

  const confirmProfile = async () => {
    const profileDraft = { ...sensitiveDraftRef.current };
    if (!verifiedInDialog) {
      setError("请先提交并核验驾驶证证据");
      return;
    }
    if (!profileDraft.name.trim() || !profileDraft.birthDate || !profileDraft.gender || !profileDraft.address.trim()) {
      setError("请人工核对并填写姓名、生日、性别和地址四项资料");
      return;
    }
    if (!sessionIsCurrent()) return;
    const operation = beginOperation();
    setPending("profile");
    setError(null);
    setNotice(null);
    try {
      const current = latestCustomerRef.current;
      const changedName = !isSameName(current.nameSourceValue, profileDraft.name);
      if (changedName && (!namePreview || !isSameName(namePreview.sourceValue, profileDraft.name))) {
        throw new Error("姓名已更改，请先预览并确认对应音译");
      }
      const draft = {
        customerType: current.customerType,
        organizationName: current.organizationName,
        nameSourceValue: profileDraft.name.trim(),
        nameTransliterationToken: changedName ? namePreview!.confirmationToken : null,
        primaryContactRole: current.primaryContactRole,
        salutation: current.salutation,
        language: current.language,
        primaryPhone: current.phone,
        secondaryPhone: current.secondaryPhone,
        whatsapp: current.whatsapp,
        email: current.email,
        preferredChannel: current.preferredChannel,
        address: profileDraft.address.trim(),
        gender: profileDraft.gender,
        birthDate: profileDraft.birthDate,
        trn: current.trn,
        status: current.status,
        reason: "驾驶证资料人工确认",
      } as const;
      const preview = await api.customers.previewUpdate(current.id, {
        ...draft,
        expectedRevision: current.revision,
      });
      if (!acceptsOperation(operation)) return;
      setDuplicateCandidates(preview.candidates);
      const updated = await api.customers.update(current.id, {
        ...preview.input,
        expectedRevision: current.revision,
        previewToken: preview.previewToken,
      });
      if (!acceptsOperation(operation)) return;
      publishLatestCustomer(updated);
      setNotice("四项资料已确认写入正式资料。未从驾驶证读取或更改其他资料。 ");
      onChanged(updated);
    } catch (caught) {
      if (!acceptsOperation(operation)) return;
      setError(readableError(caught));
    } finally {
      if (acceptsOperation(operation)) setPending(null);
    }
  };

  const cancelOperationForProfileChange = () => {
    operationEpochRef.current += 1;
    setPending(null);
    setError(null);
    setNotice(null);
  };

  const changeProfileDraft = (
    field: "name" | "birthDate" | "gender" | "address",
    value: string,
  ) => {
    sensitiveDraftRef.current[field] = value;
    if (field === "name") {
      setName(value);
      setNamePreview(null);
      setDuplicateCandidates([]);
    } else if (field === "birthDate") setBirthDate(value);
    else if (field === "gender") setGender(value);
    else setAddress(value);
    if (customer.customerType === "organization" && mode === "submit" && !pendingOrganizationRecord) {
      invalidateSubmitAttempt();
    } else {
      cancelOperationForProfileChange();
    }
  };

  const changeFrontFile = (file: File | null) => {
    invalidateSubmitAttempt();
    sensitiveDraftRef.current.frontFile = file;
  };

  const changeBackFile = (file: File | null) => {
    invalidateSubmitAttempt();
    sensitiveDraftRef.current.backFile = file;
  };

  return (
    <Dialog
      open
      title={mode === "profile" ? "核对驾驶证正式资料" : customer.customerType === "organization"
        ? pendingExistingRecord ? "继续主要联系人驾驶证核验" : existingRecord ? "重新核验主要联系人驾驶证" : "补录主要联系人驾驶证"
        : pendingExistingRecord ? "继续驾驶证 KYC" : existingRecord ? "重新驾驶证 KYC" : "补充驾驶证 KYC"}
      onClose={closeDialog}
      dataTestId="kyc-verification-dialog"
      closeLabel="关闭驾驶证核验"
      returnFocusElement={returnFocusElement}
      className="w-[min(720px,calc(100vw-2rem))]"
    >
      <div className="space-y-5 p-5">
        {mode === "submit" && pendingExistingRecord ? (
          <section aria-labelledby="kyc-pending-heading" className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
            <h3 id="kyc-pending-heading" className="text-sm font-bold text-amber-900 dark:text-amber-100">继续核验已提交的驾驶证证据</h3>
            <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">记录 {pendingExistingRecord.id} 已保存，不需要再次上传，也不会新增 KYC 记录。</p>
            <button
              type="button"
              disabled={pending !== null || verifiedInDialog}
              onClick={() => void submitAndVerify()}
              className="mt-4 min-h-10 w-full rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {pending === "kyc" || kycPhase === "verifying" ? "正在人工核验…" : verifiedInDialog ? "已完成人工核验" : "继续人工核验"}
            </button>
          </section>
        ) : mode === "submit" ? (
          <section aria-labelledby="kyc-upload-heading" className="rounded-xl border border-line p-4 dark:border-slate-600">
            <h3 id="kyc-upload-heading" className="text-sm font-bold text-ink dark:text-slate-100">驾驶证图片证据</h3>
            <p className="mt-1 text-xs leading-5 text-ink-soft dark:text-slate-400">每次补充或重新核验都会新增记录并保留历史证据。</p>
            <div className="mt-3">
              <label className="text-xs font-semibold text-ink dark:text-slate-200">
                驾驶证正面（必填）
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event) => changeFrontFile(event.target.files?.[0] ?? null)}
                  className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-white p-2 text-xs dark:border-slate-600 dark:bg-slate-700"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={pending !== null || verifiedInDialog}
              onClick={() => void submitAndVerify()}
              className="mt-4 min-h-10 w-full rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {pending === "kyc" || kycPhase === "verifying" ? "正在提交并核验…" : verifiedInDialog ? "已提交并核验" : "提交并核验"}
            </button>
          </section>
        ) : null}

        <section aria-labelledby="kyc-profile-heading" className="rounded-xl border border-line p-4 dark:border-slate-600">
          <h3 id="kyc-profile-heading" className="text-sm font-bold text-ink dark:text-slate-100">{customer.customerType === "organization" ? "主要联系人驾驶证四项" : "四项正式资料预览"}</h3>
          <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-300">
            {customer.customerType === "organization"
              ? pendingOrganizationRecord
                ? "以下为已提交的只读证件快照；续核验只核验证据，不会修改这四项或企业正式资料。"
                : "四项仅保存为主要联系人证件快照，不会写入企业地址、性别或出生日期。"
              : knownFixture
              ? "这是已知的合成演示资料预填结果，仍须人工核对并明确确认。"
              : "未启用 OCR。上传图片不会自动识别；请人工核对并填写以下四项。"}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink dark:text-slate-200">
              姓名
              <input data-testid="kyc-profile-name" value={name} disabled={Boolean(pendingOrganizationRecord)} onChange={(event) => changeProfileDraft("name", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            </label>
            <label className="text-xs font-semibold text-ink dark:text-slate-200">
              生日
              <input data-testid="kyc-profile-birth-date" type="date" value={birthDate} disabled={Boolean(pendingOrganizationRecord)} onChange={(event) => changeProfileDraft("birthDate", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            </label>
            <label className="text-xs font-semibold text-ink dark:text-slate-200">
              性别
              <select data-testid="kyc-profile-gender" value={gender} disabled={Boolean(pendingOrganizationRecord)} onChange={(event) => changeProfileDraft("gender", event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
                <option value="">请选择</option>
                <option value="女">女</option>
                <option value="男">男</option>
                {customer.customerType === "individual" ? <option value="其他">其他／未说明</option> : null}
              </select>
            </label>
            <label className="text-xs font-semibold text-ink dark:text-slate-200 sm:col-span-2">
              地址
              <textarea data-testid="kyc-profile-address" value={address} disabled={Boolean(pendingOrganizationRecord)} onChange={(event) => changeProfileDraft("address", event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            </label>
          </div>
          {customer.customerType === "individual" && !isSameName(latestCustomer.nameSourceValue, name) ? (
            <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50 p-3 dark:border-primary-500/30 dark:bg-primary/10">
              <button type="button" disabled={pending !== null || !name.trim()} onClick={() => void previewName()} className="min-h-9 rounded-lg border border-primary px-3 text-xs font-bold text-primary disabled:opacity-50 dark:text-primary-200">
                预览并确认姓名音译
              </button>
              {namePreview ? (
                <div data-testid="kyc-name-transliteration-preview" className="mt-2 text-xs leading-5 text-primary-900 dark:text-primary-100">
                  <p>中文：<strong>{namePreview.nameZh ?? "中文音译待补"}</strong></p>
                  <p>英文：<strong>{namePreview.nameEn}</strong></p>
                  <p className="text-[10px] opacity-80">方式：{namePreview.method} · 版本：{namePreview.version}</p>
                </div>
              ) : <p className="mt-2 text-[11px] text-primary-700 dark:text-primary-200">姓名变更必须先取得对应音译确认凭据。</p>}
            </div>
          ) : null}
          {duplicateCandidates.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              可能重复客户：{duplicateCandidates.map((candidate) => candidate.customerId).join("、")}。此提示仅供核对，不阻止保存。
            </div>
          ) : null}
          {customer.customerType === "individual" ? <button
            type="button"
            disabled={pending !== null || !verifiedInDialog}
            onClick={() => void confirmProfile()}
            className="mt-4 min-h-10 w-full rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending === "profile" ? "正在写入正式资料…" : "确认写入正式资料"}
          </button> : null}
        </section>

        {notice ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p> : null}
        {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p> : null}
      </div>
    </Dialog>
  );
}
