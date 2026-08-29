"use client";

import { translateVehicleMake, translateVehicleModel } from "@/lib/customers/bilingual";
import {
  type ComponentType,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, CarFront, FileImage, Info, Phone, ScanLine, Search, UserPlus, UserRound, UserRoundCheck, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { api, isFormalCustomerVehicleApiEnabled } from "@/lib/api/client";
import type {
  CustomerRecord,
  CustomerNamePreview,
  CustomerSavePreview,
  CustomerStatus,
  CustomerType,
  PreferredChannel,
  VehicleCustomerRelationship,
  VehicleRecord,
  VehicleSavePreview,
} from "@/lib/customers/types";
import { formatPhoneE164 } from "@/lib/customers/phone";
import {
  mergeVehicleRecognition,
  type VehicleRecognitionResult,
} from "@/lib/customers/vehicle-photo-recognition";
import {
  recognizeVehicleDocumentWithAi,
} from "@/lib/customers/vehicle-document-ai";
import { cn } from "@/lib/utils";
import { customerDisplayName } from "./customer-list";
import { VehiclePhotoSource } from "./vehicle-photo-source";
import { filterVehicleCustomerCandidates } from "@/lib/customers/vehicle-customer-search";
import { vehicleYearInputValue } from "@/lib/customers/vehicle-year";

const CustomerOnboardingDialog = dynamic(
  () => import("./customer-onboarding-dialog").then((module) => module.CustomerOnboardingDialog),
  { ssr: false },
);
const FormalCustomerCreateDialog = dynamic(
  () => import("./formal-customer-create-dialog").then((module) => module.FormalCustomerCreateDialog),
  { ssr: false },
);

type MaybePromise = void | Promise<void>;
type CloseKind = "control" | "history";

const inputClass = cn(
  "min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[13px] text-ink outline-none transition-shadow",
  "focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100",
);
const textAreaClass = cn(inputClass, "min-h-20 resize-y py-2.5");
const invalidClass = "border-danger focus:border-danger focus:ring-danger/15";
const labelClass = "block text-[13px] font-semibold text-ink dark:text-slate-200";

function FormSection({
  icon: Icon,
  title,
  hint,
  required,
  tone = "blue",
  children,
}: {
  icon: ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  hint?: string;
  required?: boolean;
  tone?: "blue" | "amber";
  children: ReactNode;
}) {
  return (
    <fieldset className="overflow-hidden rounded-2xl border border-line bg-white shadow-card dark:border-slate-700 dark:bg-slate-800/60">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3 dark:border-slate-700 dark:bg-slate-900/50">
        <span className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
          tone === "blue" ? "bg-primary-50 text-primary dark:bg-primary/15 dark:text-primary-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
        )}>
          <Icon size={15} aria-hidden />
        </span>
        <span className="text-sm font-bold text-ink dark:text-slate-100">
          {title}
          {required ? <RequiredMark /> : null}
        </span>
        {hint ? <span className="ml-auto hidden text-right text-[11px] leading-4 text-ink-soft dark:text-slate-400 sm:block">{hint}</span> : null}
      </div>
      <div className="p-4">{children}</div>
    </fieldset>
  );
}

function PlainHint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary-50/50 px-3.5 py-2.5 text-xs leading-5 text-ink-soft dark:border-primary/25 dark:bg-primary/10 dark:text-slate-300">
      <Info size={14} className="mt-0.5 shrink-0 text-primary dark:text-primary-300" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "保存失败，请重试";
}

function RequiredMark() {
  return <span className="ml-0.5 text-rose-700 dark:text-rose-300" aria-hidden>*</span>;
}

function AiReviewMark({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <span className="ml-2 text-[10px] font-medium text-amber-700 dark:text-amber-300">AI 识别，请核对</span>;
}

function FieldError({ id, testId, children }: { id: string; testId: string; children?: string }) {
  if (!children) return null;
  return <p id={id} data-testid={testId} className="mt-1 text-[11px] font-medium text-rose-700 dark:text-rose-300">{children}</p>;
}

function toLocalDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function strictDate(value: string): string | null {
  return value ? `${value}T00:00:00.000Z` : null;
}

function transliterationCounterpart(preview: CustomerNamePreview | null): string {
  if (!preview) return "确认后显示对应音译";
  return preview.sourceScript === "zh" ? preview.nameEn : preview.nameZh ?? "中文音译待补";
}

export function useDirtyCloseGuard({
  dirty,
  blocked,
  onClose,
}: {
  dirty: boolean;
  blocked: boolean;
  onClose: () => void;
}) {
  const [closeKind, setCloseKind] = useState<CloseKind | null>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const ignoreNextPopRef = useRef(false);

  const openConfirmation = useCallback((kind: CloseKind) => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCloseKind(kind);
  }, []);

  const continueEditing = useCallback(() => {
    setCloseKind(null);
    window.requestAnimationFrame(() => previousFocusRef.current?.isConnected && previousFocusRef.current.focus());
  }, []);

  const requestClose = useCallback(() => {
    if (blocked) return;
    if (closeKind !== null) {
      continueEditing();
      return;
    }
    if (dirty) openConfirmation("control");
    else onClose();
  }, [blocked, closeKind, continueEditing, dirty, onClose, openConfirmation]);

  const discardChanges = useCallback(() => {
    setCloseKind(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (closeKind === null) return;
    const frame = window.requestAnimationFrame(() => continueButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [closeKind]);

  useEffect(() => {
    const handlePopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      if (!dirty) {
        onClose();
        return;
      }
      ignoreNextPopRef.current = true;
      window.history.forward();
      if (blocked) return;
      openConfirmation("history");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [blocked, dirty, onClose, openConfirmation]);

  return {
    confirmationOpen: closeKind !== null,
    continueButtonRef,
    continueEditing,
    discardChanges,
    requestClose,
  };
}

export function DiscardConfirmation({
  continueButtonRef,
  onContinue,
  onDiscard,
  testIdPrefix = "",
}: {
  continueButtonRef: RefObject<HTMLButtonElement | null>;
  onContinue: () => void;
  onDiscard: () => void;
  testIdPrefix?: string;
}) {
  const testId = (name: string) => testIdPrefix ? `${testIdPrefix}-${name}` : name;
  return (
    <div data-testid={testId("discard-confirmation")} className="p-5 sm:p-7">
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-950/60">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200">
            <AlertTriangle size={20} aria-hidden />
          </div>
          <div>
            <h3 className="text-base font-bold text-ink dark:text-slate-100">放弃更改？</h3>
            <p className="mt-1.5 text-sm leading-6 text-ink-soft dark:text-slate-300">当前表单有尚未保存的内容。放弃后，这些改动无法恢复。</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-testid={testId("discard-changes")}
            onClick={onDiscard}
            className="min-h-10 rounded-lg border border-rose-300 bg-white px-4 text-xs font-bold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:bg-slate-900 dark:text-rose-300"
          >
            放弃更改
          </button>
          <button
            ref={continueButtonRef}
            type="button"
            data-testid={testId("continue-editing")}
            onClick={onContinue}
            className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-600"
          >
            继续编辑
          </button>
        </div>
      </div>
    </div>
  );
}

interface CustomerFormDialogProps {
  mode: "edit";
  customer: CustomerRecord;
  customers: CustomerRecord[];
  onClose: () => void;
  onSaved: (customer: CustomerRecord) => MaybePromise;
}

type CustomerErrorKey = "name" | "email";

export function CustomerFormDialog({ customer, customers, onClose, onSaved }: CustomerFormDialogProps) {
  const initial = useMemo(() => ({
    customerType: customer.customerType,
    name: customer.formalFullName ?? customer.nameSourceValue ?? "",
    organizationName: customer.organizationName ?? "",
    primaryContactRole: customer.primaryContactRole ?? "",
    salutation: customer.salutation ?? "",
    language: customer.language ?? "English",
    primaryPhone: customer.phone ? formatPhoneE164(customer.phone) : "",
    secondaryPhone: customer.secondaryPhone ? formatPhoneE164(customer.secondaryPhone) : "",
    whatsapp: customer.whatsapp ? formatPhoneE164(customer.whatsapp) : "",
    email: customer.email ?? "",
    preferredChannel: customer.preferredChannel,
    address: customer.address ?? "",
    gender: customer.gender ?? "",
    birthDate: customer.birthDate ?? "",
    trn: customer.trn ?? "",
    status: customer.status,
    reason: "",
  }), [customer]);

  const [customerType, setCustomerType] = useState<CustomerType>(initial.customerType);
  const [name, setName] = useState(initial.name);
  const [nameConfirmation, setNameConfirmation] = useState<CustomerNamePreview | null>(null);
  const [organizationName, setOrganizationName] = useState(initial.organizationName);
  const [primaryContactRole, setPrimaryContactRole] = useState(initial.primaryContactRole);
  const [salutation, setSalutation] = useState(initial.salutation);
  const [language, setLanguage] = useState(initial.language);
  const [primaryPhone, setPrimaryPhone] = useState(initial.primaryPhone);
  const [secondaryPhone, setSecondaryPhone] = useState(initial.secondaryPhone);
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp);
  const [email, setEmail] = useState(initial.email);
  const [preferredChannel, setPreferredChannel] = useState<PreferredChannel>(initial.preferredChannel);
  const [address, setAddress] = useState(initial.address);
  const [gender, setGender] = useState(initial.gender);
  const [birthDate, setBirthDate] = useState(initial.birthDate);
  const [trn, setTrn] = useState(initial.trn);
  const [status, setStatus] = useState<CustomerStatus>(initial.status);
  const [reason, setReason] = useState(initial.reason);
  const [preview, setPreview] = useState<CustomerSavePreview | null>(null);
  const [errors, setErrors] = useState<Partial<Record<CustomerErrorKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const snapshot = {
    customerType, name, organizationName, primaryContactRole, salutation, language, primaryPhone, secondaryPhone,
    whatsapp, email, preferredChannel, address, gender, birthDate, trn, status, reason,
  };
  const dirty = !committed && JSON.stringify(snapshot) !== JSON.stringify(initial);
  const guard = useDirtyCloseGuard({ dirty, blocked: saving, onClose });

  const invalidate = useCallback((...keys: CustomerErrorKey[]) => {
    setPreview(null);
    setSaveError(null);
    if (keys.length > 0) {
      setErrors((current) => {
        const next = { ...current };
        keys.forEach((key) => delete next[key]);
        return next;
      });
    }
  }, []);

  const changeText = (setter: (value: string) => void, ...keys: CustomerErrorKey[]) =>
    (value: string) => {
      setter(value);
      invalidate(...keys);
    };

  const changeCustomerType = (nextType: CustomerType) => {
    setCustomerType(nextType);
    if (nextType === "individual") {
      setOrganizationName("");
      setPrimaryContactRole("");
    }
    setNameConfirmation(null);
    invalidate("name");
  };

  const draft = () => ({
    customerType,
    nameSourceValue: name.trim() || null,
    nameTransliterationToken: nameConfirmation?.confirmationToken ?? null,
    organizationName: organizationName.trim() || null,
    primaryContactRole: primaryContactRole.trim() || null,
    salutation: salutation.trim() || null,
    language: language.trim() || null,
    primaryPhone: primaryPhone.trim() || null,
    secondaryPhone: secondaryPhone.trim() || null,
    whatsapp: whatsapp.trim() || null,
    email: email.trim() || null,
    preferredChannel,
    address: address.trim() || null,
    gender: gender.trim() || null,
    birthDate: birthDate.trim() || null,
    trn: trn.trim() || null,
    status,
    reason: reason.trim() || null,
  });

  const validate = (): boolean => {
    const next: Partial<Record<CustomerErrorKey, string>> = {};
    const unchangedName = name.trim().toLocaleLowerCase() === initial.name.trim().toLocaleLowerCase();
    if (customerType === "organization" && !organizationName.trim()) next.name = "机构名称为必填项";
    else if (customerType === "individual" && !name.trim()) next.name = "客户姓名为必填项";
    else if (!isFormalCustomerVehicleApiEnabled && !unchangedName && !nameConfirmation) next.name = "请先确认姓名音译结果";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = "请输入有效的 Email 地址";
    setErrors(next);
    if (next.name) nameRef.current?.focus();
    else if (next.email) emailRef.current?.focus();
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input = draft();
      const activePreview = preview ?? await api.customers.previewUpdate(customer.id, { ...input, expectedRevision: customer.revision });
      setPreview(activePreview);
      if (!preview && activePreview.candidates.length > 0) return;
      const saved = await api.customers.update(customer.id, {
        ...activePreview.input,
        expectedRevision: customer.revision,
        previewToken: activePreview.previewToken,
      });
      setCommitted(true);
      await onSaved(saved);
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  const candidateNames = preview?.candidates.map((candidate) => {
    const match = customers.find((entry) => entry.id === candidate.customerId);
    return { ...candidate, name: match ? customerDisplayName(match) : candidate.customerId };
  }) ?? [];

  return (
    <Dialog
      open
      title={`编辑客户 · ${customerDisplayName(customer)}`}
      onClose={guard.requestClose}
      closeLabel="关闭客户表单"
      dataTestId="customer-form-dialog"
      closeTestId="customer-form-close"
      className="w-[min(820px,calc(100vw-2rem))]"
    >
      {guard.confirmationOpen ? (
        <DiscardConfirmation
          continueButtonRef={guard.continueButtonRef}
          onContinue={guard.continueEditing}
          onDiscard={guard.discardChanges}
        />
      ) : (
        <form noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void save(); }} className="space-y-4 p-4 sm:p-6">
          <PlainHint>{isFormalCustomerVehicleApiEnabled
            ? "这里维护正式后端已经支持的客户字段，保存后会直接写入正式档案并保留审计记录。"
            : "保存时系统会先检查资料是否填写规范、是否有疑似重复的客户，确认无误后才会写入档案；所有改动都会留痕。"}</PlainHint>

          <div data-testid="customer-formal-details" className="space-y-4">
          <FormSection icon={UserRound} title="客户身份与名称" hint="一个姓名栏同时维护中文与英文对应姓名">
            <div className="mt-1 grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>客户类型<select value={customerType} disabled={isFormalCustomerVehicleApiEnabled} onChange={(event) => changeCustomerType(event.target.value as CustomerType)} data-testid="form-customer-type" className={cn(inputClass, "mt-1.5", isFormalCustomerVehicleApiEnabled && "disabled:cursor-not-allowed disabled:bg-surface")}><option value="individual">个人</option><option value="organization">机构</option></select></label>
              {customerType === "organization" ? <label className={labelClass}>机构名称<RequiredMark /><input ref={isFormalCustomerVehicleApiEnabled ? nameRef : undefined} value={organizationName} onChange={(event) => changeText(setOrganizationName, "name")(event.target.value)} data-testid="form-customer-organization-name" className={cn(inputClass, "mt-1.5", errors.name && invalidClass)} /></label> : null}
              {customerType === "individual" || !isFormalCustomerVehicleApiEnabled ? <label className={labelClass}>{customerType === "organization" ? "主要联系人姓名" : "客户姓名"}<RequiredMark /><input ref={nameRef} value={name} onChange={(event) => { setName(event.target.value); setNameConfirmation(null); invalidate("name"); }} data-testid="form-customer-name" aria-required="true" aria-invalid={errors.name ? "true" : "false"} aria-describedby={errors.name ? "form-customer-name-error-message" : undefined} placeholder="填写中文或英文姓名" className={cn(inputClass, "mt-1.5", errors.name && invalidClass)} /><FieldError id="form-customer-name-error-message" testId="form-customer-name-error">{errors.name}</FieldError></label> : null}
              {!isFormalCustomerVehicleApiEnabled ? <>
                <button type="button" data-testid="customer-name-transliteration-confirm" onClick={async () => { try { setSaveError(null); setNameConfirmation(await api.customers.previewName(name)); } catch (error) { setNameConfirmation(null); setSaveError(messageOf(error)); } }} className="min-h-11 rounded-xl border border-primary px-4 text-xs font-bold text-primary">确认姓名音译</button>
                <output data-testid="customer-name-transliteration-preview" className="min-h-11 rounded-xl bg-surface px-3 py-2 text-sm dark:bg-slate-900">{transliterationCounterpart(nameConfirmation)}</output>
                {customerType === "organization" ? <label className={labelClass}>主要联系人职位／关系<input value={primaryContactRole} onChange={(event) => changeText(setPrimaryContactRole)(event.target.value)} data-testid="form-customer-primary-contact-role" className={cn(inputClass, "mt-1.5")} /></label> : <label className={labelClass}>称谓<input value={salutation} onChange={(event) => changeText(setSalutation)(event.target.value)} data-testid="form-customer-salutation" className={cn(inputClass, "mt-1.5")} /></label>}
                <label className={labelClass}>语言<input value={language} onChange={(event) => changeText(setLanguage)(event.target.value)} data-testid="form-customer-language" className={cn(inputClass, "mt-1.5")} /></label>
              </> : null}
            </div>
          </FormSection>

          <FormSection icon={Phone} title="正式资料" hint="身份资料与联系方式统一维护；联系方式可留空，缺失时系统提醒">
            <div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>主要电话<input type="tel" value={primaryPhone} onChange={(event) => changeText(setPrimaryPhone)(event.target.value)} data-testid="form-customer-phone" className={cn(inputClass, "mt-1.5")} /></label>
              {!isFormalCustomerVehicleApiEnabled ? <label className={labelClass}>备用电话<input type="tel" value={secondaryPhone} onChange={(event) => changeText(setSecondaryPhone)(event.target.value)} data-testid="form-customer-secondary-phone" className={cn(inputClass, "mt-1.5")} /></label> : null}
              {customerType === "individual" || !isFormalCustomerVehicleApiEnabled ? <label className={labelClass}>WhatsApp<input type="tel" value={whatsapp} onChange={(event) => changeText(setWhatsapp)(event.target.value)} data-testid="form-customer-whatsapp" className={cn(inputClass, "mt-1.5")} /></label> : null}
              <label className={labelClass}>Email<input ref={emailRef} type="email" value={email} onChange={(event) => changeText(setEmail, "email")(event.target.value)} data-testid="form-customer-email" aria-invalid={errors.email ? "true" : "false"} aria-describedby={errors.email ? "form-customer-email-error-message" : undefined} className={cn(inputClass, "mt-1.5", errors.email && invalidClass)} /><FieldError id="form-customer-email-error-message" testId="form-customer-email-error">{errors.email}</FieldError></label>
              {!isFormalCustomerVehicleApiEnabled ? <>
                <label className={labelClass}>偏好联系渠道<select value={preferredChannel} onChange={(event) => { setPreferredChannel(event.target.value as PreferredChannel); invalidate(); }} data-testid="form-customer-channel" className={cn(inputClass, "mt-1.5")}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="phone">电话</option><option value="email">邮件</option></select></label>
                <label className={labelClass}>性别<input value={gender} onChange={(event) => changeText(setGender)(event.target.value)} data-testid="form-customer-gender" className={cn(inputClass, "mt-1.5")} /></label>
                <label className={labelClass}>生日<input type="date" value={birthDate} onChange={(event) => changeText(setBirthDate)(event.target.value)} data-testid="form-customer-birthdate" className={cn(inputClass, "mt-1.5")} /></label>
              </> : null}
              <label className={labelClass}>TRN 税号<input value={trn} onChange={(event) => changeText(setTrn)(event.target.value)} data-testid="form-customer-trn" className={cn(inputClass, "mt-1.5")} /></label>
              <label className={cn(labelClass, "sm:col-span-2")}>地址<input value={address} onChange={(event) => changeText(setAddress)(event.target.value)} data-testid="form-customer-address" className={cn(inputClass, "mt-1.5")} /></label>
            </div>
              <label className={labelClass}>客户状态<select value={status} onChange={(event) => { setStatus(event.target.value as CustomerStatus); invalidate(); }} data-testid="form-customer-status" className={cn(inputClass, "mt-1.5")}><option value="active">活跃</option><option value="inactive">非活跃</option>{!isFormalCustomerVehicleApiEnabled ? <option value="blacklisted">黑名单</option> : null}</select></label>
            </div>
          </FormSection>
          </div>

          {!isFormalCustomerVehicleApiEnabled ? <label className={labelClass}>保存原因<input value={reason} onChange={(event) => changeText(setReason)(event.target.value)} data-testid="form-customer-reason" className={cn(inputClass, "mt-1.5")} /></label> : null}

          {candidateNames.length > 0 ? (
            <div data-testid="customer-duplicate-candidates" role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-xs dark:border-amber-700 dark:bg-amber-950/50">
              <div className="font-bold text-ink dark:text-slate-100">发现可能重复客户</div>
              <ul className="mt-2 space-y-1 text-ink-soft dark:text-slate-300">{candidateNames.map((candidate) => <li key={candidate.customerId}>{candidate.customerId} · {candidate.name} · {candidate.reasons.join("、")}</li>)}</ul>
              <p className="mt-3 font-semibold text-ink dark:text-slate-200">这些是名称、Email 或企业名提醒，不阻断保存；请核对后再次点击保存。</p>
            </div>
          ) : null}
          {saveError ? <p data-testid="form-save-error" role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{saveError}</p> : null}
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={guard.requestClose} data-testid="form-cancel" className="min-h-10 rounded-lg border border-line bg-white px-4 text-xs font-medium text-ink-soft dark:bg-slate-900 dark:text-slate-300">取消</button>
            <button type="submit" disabled={saving || committed} data-testid="form-save" className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50">{committed ? "已保存" : saving ? "保存中…" : candidateNames.length > 0 ? "继续保存" : "保存"}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

interface VehicleFormDialogProps {
  mode: "create" | "edit";
  vehicle?: VehicleRecord;
  initialPlate?: string;
  customers: CustomerRecord[];
  relationships: VehicleCustomerRelationship[];
  onClose: () => void;
  onSaved: (vehicle: VehicleRecord) => MaybePromise;
}

type VehicleErrorKey = "make" | "model" | "year";

export function VehicleFormDialog({ mode, vehicle, initialPlate, customers, relationships, onClose, onSaved }: VehicleFormDialogProps) {
  const originalCurrentCustomerId = useMemo(
    () => relationships.find((relationship) => relationship.endedAt === null)?.customerId ?? "",
    [relationships],
  );
  const initial = useMemo(() => ({
    plate: vehicle?.plate ?? initialPlate ?? "",
    vin: vehicle?.vin ?? "",
    engineNumber: vehicle?.engineNumber ?? "",
    make: vehicle?.make ?? "",
    makeZh: vehicle?.makeZh ?? "",
    model: vehicle?.model ?? "",
    modelZh: vehicle?.modelZh ?? "",
    year: vehicle ? vehicleYearInputValue(vehicle.year) : "",
    color: vehicle?.color ?? "",
    bodyType: vehicle?.bodyType ?? "",
    seating: vehicle?.seating === null || vehicle?.seating === undefined ? "" : String(vehicle.seating),
    ccRating: vehicle?.ccRating === null || vehicle?.ccRating === undefined ? "" : String(vehicle.ccRating),
    fuelType: vehicle?.fuelType ?? "",
    usage: vehicle?.usage ?? "",
    specialNotes: vehicle?.specialNotes ?? "",
    status: vehicle?.status ?? "off_site",
    reason: "",
    currentCustomerId: originalCurrentCustomerId,
  }), [initialPlate, originalCurrentCustomerId, vehicle]);

  const [plate, setPlate] = useState(initial.plate);
  const [vin, setVin] = useState(initial.vin);
  const [engineNumber, setEngineNumber] = useState(initial.engineNumber);
  const [make, setMake] = useState(initial.make);
  const [makeZh, setMakeZh] = useState(initial.makeZh);
  const [model, setModel] = useState(initial.model);
  const [modelZh, setModelZh] = useState(initial.modelZh);
  const makeAutoEnRef = useRef<string | null>(null);
  const makeAutoZhRef = useRef<string | null>(null);
  const modelAutoEnRef = useRef<string | null>(null);
  const modelAutoZhRef = useRef<string | null>(null);
  const [year, setYear] = useState(initial.year);
  const [color, setColor] = useState(initial.color);
  const [bodyType, setBodyType] = useState(initial.bodyType);
  const [seating, setSeating] = useState(initial.seating);
  const [ccRating, setCcRating] = useState(initial.ccRating);
  const [fuelType, setFuelType] = useState(initial.fuelType);
  const [usage, setUsage] = useState(initial.usage);
  const [specialNotes, setSpecialNotes] = useState(initial.specialNotes);
  const [reason, setReason] = useState(initial.reason);
  const [currentCustomerId, setCurrentCustomerId] = useState(initial.currentCustomerId);
  const [customerQuery, setCustomerQuery] = useState("");
  const [newCustomers, setNewCustomers] = useState<CustomerRecord[]>([]);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [preview, setPreview] = useState<VehicleSavePreview | null>(null);
  const [errors, setErrors] = useState<Partial<Record<VehicleErrorKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recognitionFile, setRecognitionFile] = useState<File | null>(null);
  const [recognitionImageUrl, setRecognitionImageUrl] = useState<string | null>(null);
  const [recognitionState, setRecognitionState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [recognitionMessage, setRecognitionMessage] = useState<string | null>(null);
  const [aiFilledFields, setAiFilledFields] = useState<ReadonlySet<string>>(() => new Set());
  const recognitionAbortRef = useRef<AbortController | null>(null);
  const makeRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
  const selectableCustomers = useMemo(() => [...customers, ...newCustomers.filter((created) => !customers.some((customer) => customer.id === created.id))], [customers, newCustomers]);
  const customerCandidates = useMemo(
    () => filterVehicleCustomerCandidates(selectableCustomers, customerQuery),
    [customerQuery, selectableCustomers],
  );
  const selectedCustomer = useMemo(
    () => selectableCustomers.find((customer) => customer.id === currentCustomerId) ?? null,
    [currentCustomerId, selectableCustomers],
  );

  useEffect(() => () => {
    recognitionAbortRef.current?.abort();
    if (recognitionImageUrl) URL.revokeObjectURL(recognitionImageUrl);
  }, [recognitionImageUrl]);

  const snapshot = {
    plate, vin, engineNumber, make, makeZh, model, modelZh, year, color, bodyType, seating, ccRating, fuelType,
    usage, specialNotes, status: initial.status, reason,
    currentCustomerId,
  };
  const dirty = !committed && JSON.stringify(snapshot) !== JSON.stringify(initial);
  const guard = useDirtyCloseGuard({ dirty, blocked: saving, onClose });

  const invalidate = useCallback((...keys: VehicleErrorKey[]) => {
    setPreview(null);
    setSaveError(null);
    if (keys.length > 0) {
      setErrors((current) => {
        const next = { ...current };
        keys.forEach((key) => delete next[key]);
        return next;
      });
    }
  }, []);
  const changeText = (setter: (value: string) => void, ...keys: VehicleErrorKey[]) =>
    (value: string) => {
      setter(value);
      invalidate(...keys);
    };

  const relationshipDrafts = () => {
    const changedAt = new Date().toISOString();
    return [
      ...relationships.map((relationship) => ({
        relationshipId: relationship.id,
        customerId: relationship.customerId,
        startedAt: relationship.startedAt,
        endedAt: relationship.endedAt === null && relationship.customerId !== currentCustomerId
          ? changedAt
          : relationship.endedAt,
      })),
      ...(currentCustomerId && currentCustomerId !== originalCurrentCustomerId
        ? [{ relationshipId: null, customerId: currentCustomerId, startedAt: changedAt, endedAt: null }]
        : []),
    ];
  };

  const selectRecognitionPhoto = (file: File | null) => {
    recognitionAbortRef.current?.abort();
    if (recognitionImageUrl) URL.revokeObjectURL(recognitionImageUrl);
    setRecognitionFile(file);
    setRecognitionImageUrl(file ? URL.createObjectURL(file) : null);
    setRecognitionState("idle");
    setRecognitionMessage(null);
  };

  const applyRecognizedFields = (recognized: VehicleRecognitionResult) => {
    const currentValues = { plate, vin, engineNumber, make, model, year, color, bodyType, seating, ccRating, fuelType };
    const refillable = Object.fromEntries(Object.entries(currentValues).map(([key, value]) => [
      key,
      aiFilledFields.has(key) ? "" : value,
    ])) as typeof currentValues;
    const merged = mergeVehicleRecognition({
      ...refillable,
    }, recognized);
    const nextAiFields = new Set<string>();
    for (const [key, value] of Object.entries(recognized)) {
      if (value && (!currentValues[key as keyof typeof currentValues] || aiFilledFields.has(key))) nextAiFields.add(key);
    }
    setPlate(merged.plate.replace(/\s+/g, ""));
    setVin(merged.vin.replace(/\s+/g, ""));
    setEngineNumber(merged.engineNumber.replace(/\s+/g, ""));
    setMake(merged.make);
    setModel(merged.model);
    setYear(merged.year);
    setColor(merged.color);
    setBodyType(merged.bodyType);
    setSeating(merged.seating);
    setCcRating(merged.ccRating);
    setFuelType(merged.fuelType);
    setAiFilledFields(nextAiFields);
    if (!makeZh && recognized.make) setMakeZh(translateVehicleMake(recognized.make) ?? "");
    if (!modelZh && recognized.model) setModelZh(translateVehicleModel(recognized.model) ?? "");
    invalidate("make", "model", "year");
  };

  const runVehicleRecognition = async () => {
    if (!recognitionFile || recognitionState === "running") return;
    recognitionAbortRef.current?.abort();
    const controller = new AbortController();
    recognitionAbortRef.current = controller;
    setRecognitionState("running");
    setRecognitionMessage(null);
    try {
      const fields = await recognizeVehicleDocumentWithAi(recognitionFile, controller.signal);
      const recognizedCount = Object.keys(fields).length;
      if (recognizedCount === 0) {
        setRecognitionState("error");
        setRecognitionMessage("没有识别出可用车辆资料，请换一张更清晰、正向拍摄的图片，或直接手工填写。");
        return;
      }
      applyRecognizedFields(fields);
      setRecognitionState("success");
      setRecognitionMessage(`已识别并填入 ${recognizedCount} 项，原来已经手填的内容未被覆盖。请核对后保存。`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRecognitionState("error");
      setRecognitionMessage(error instanceof Error && error.message ? error.message : "图片识别失败，请重试或直接手工填写。");
    }
  };

  const draft = () => ({
    ...(vehicle?.formalIsActive === undefined ? {} : { formalIsActive: vehicle.formalIsActive }),
    plate: plate.replace(/\s+/g, "").trim() || null,
    vin: vin.replace(/\s+/g, "").trim() || null,
    engineNumber: engineNumber.replace(/\s+/g, "").trim() || null,
    make: make.trim() || null,
    makeZh: makeZh.trim() || null,
    model: model.trim() || null,
    modelZh: modelZh.trim() || null,
    variant: null,
    year: year.trim() ? Number(year) : null,
    color: color.trim() || null,
    powertrain: null,
    bodyType: bodyType.trim() || null,
    seating: seating.trim() || null,
    ccRating: ccRating.trim() || null,
    fuelType: fuelType.trim() || null,
    usage: usage.trim() || null,
    specialNotes: specialNotes.trim() || null,
    status: initial.status,
    reason: reason.trim() || null,
    relationships: relationshipDrafts(),
  });

  const validate = (): boolean => {
    const next: Partial<Record<VehicleErrorKey, string>> = {};
    if (!make.trim()) next.make = "品牌为必填项";
    if (!model.trim()) next.model = "车型为必填项";
    if (!year.trim() && !isFormalCustomerVehicleApiEnabled) next.year = "年份为必填项";
    else if (year.trim()) {
      const parsed = Number(year);
      if (!Number.isInteger(parsed) || parsed < 1886 || parsed > new Date().getFullYear() + 1) next.year = `年份必须在 1886 至 ${new Date().getFullYear() + 1} 之间`;
    }
    setErrors(next);
    if (next.make) makeRef.current?.focus();
    else if (next.model) modelRef.current?.focus();
    else if (next.year) yearRef.current?.focus();
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input = draft();
      const activePreview = preview ?? (mode === "edit" && vehicle
        ? await api.vehicles.previewUpdate(vehicle.id, { ...input, expectedRevision: vehicle.revision })
        : await api.vehicles.preview(input));
      setPreview(activePreview);
      if (!activePreview.canSave) return;
      const saved = mode === "edit" && vehicle
        ? await api.vehicles.update(vehicle.id, {
          ...activePreview.input,
          expectedRevision: vehicle.revision,
          previewToken: activePreview.previewToken,
        })
        : await api.vehicles.create({ ...activePreview.input, previewToken: activePreview.previewToken });
      setCommitted(true);
      await onSaved(saved);
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={mode === "create" ? "新建车辆" : `编辑车辆 · ${vehicle?.plate || "无车牌"}`}
      onClose={guard.requestClose}
      closeLabel="关闭车辆表单"
      dataTestId="vehicle-form-dialog"
      closeTestId="vehicle-form-close"
      className="w-[min(1080px,calc(100vw-2rem))]"
    >
      {guard.confirmationOpen ? (
        <DiscardConfirmation
          continueButtonRef={guard.continueButtonRef}
          onContinue={guard.continueEditing}
          onDiscard={guard.discardChanges}
        />
      ) : (
        <form noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void save(); }} className="space-y-4 p-4 sm:p-6">
          <PlainHint>车牌可以留空；同一个车牌只会对应一台车，重复录入会自动指向已有档案。一台车同一时间只有一位当前客户，更换客户会保留完整历史。</PlainHint>

          {mode === "create" ? (
            <FormSection icon={ScanLine} title="照片识别车辆资料" hint="车辆登记证、检验合格证或清晰车牌照片">
              <div className="grid gap-4 sm:grid-cols-[minmax(220px,0.75fr)_minmax(280px,1.25fr)]">
                <VehiclePhotoSource imageUrl={recognitionImageUrl} busy={recognitionState === "running"} onFile={selectRecognitionPhoto} />
                <div className="flex min-w-0 flex-col justify-center rounded-xl bg-surface p-4 dark:bg-slate-900/60">
                  <p className="flex items-start gap-2 text-xs leading-5 text-ink-soft dark:text-slate-300"><FileImage size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden />系统会使用后台统一配置的识别服务；API Key 不会进入浏览器。</p>
                  <button type="button" disabled={!recognitionFile || recognitionState === "running"} onClick={() => void runVehicleRecognition()} data-testid="form-vehicle-recognition-run" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"><ScanLine size={17} aria-hidden />{recognitionState === "running" ? "AI 识别中…" : "AI 识别并填入车辆资料"}</button>
                  {recognitionMessage ? <p data-testid="form-vehicle-recognition-message" role={recognitionState === "error" ? "alert" : "status"} className={cn("mt-3 rounded-lg px-3 py-2 text-xs font-semibold leading-5", recognitionState === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/35 dark:text-amber-300")}>{recognitionMessage}</p> : null}
                </div>
              </div>
            </FormSection>
          ) : null}

          <FormSection icon={CarFront} title="车辆主档" hint={isFormalCustomerVehicleApiEnabled ? "品牌、车型为必填；年份可待补" : "品牌、车型、年份为必填"}>
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-[11px] font-bold tracking-wide text-primary">车辆身份</div>
                <div className="grid gap-3 lg:grid-cols-[minmax(150px,0.7fr)_minmax(300px,1.45fr)_minmax(170px,0.85fr)]">
                  <label className={labelClass}>车牌号（可空）<AiReviewMark visible={aiFilledFields.has("plate")} /><input value={plate} onChange={(event) => { setAiFilledFields((current) => new Set([...current].filter((key) => key !== "plate"))); changeText(setPlate)(event.target.value.toUpperCase().replace(/\s+/g, "")); }} data-testid="form-vehicle-plate" className={cn(inputClass, "mt-1.5 font-mono tracking-normal")} /></label>
                  <label className={labelClass}>CHASSIS NO.<AiReviewMark visible={aiFilledFields.has("vin")} /><input value={vin} onChange={(event) => { setAiFilledFields((current) => new Set([...current].filter((key) => key !== "vin"))); changeText(setVin)(event.target.value.toUpperCase().replace(/\s+/g, "")); }} data-testid="form-vehicle-vin" className={cn(inputClass, "mt-1.5 font-mono tracking-normal")} /></label>
                  <label className={labelClass}>发动机号<AiReviewMark visible={aiFilledFields.has("engineNumber")} /><input value={engineNumber} onChange={(event) => changeText(setEngineNumber)(event.target.value.toUpperCase().replace(/\s+/g, ""))} data-testid="form-vehicle-engine-number" className={cn(inputClass, "mt-1.5 font-mono tracking-normal")} /></label>
                </div>
              </div>

              <div className="border-t border-line pt-4">
                <div className="mb-2 text-[11px] font-bold tracking-wide text-primary">品牌与车型</div>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <label className={labelClass}>品牌（中文）<input value={makeZh} onChange={(event) => {
                const value = event.target.value;
                setMakeZh(value);
                invalidate("make");
                const translated = translateVehicleMake(value);
                if (translated && (make === "" || make === makeAutoEnRef.current)) {
                  setMake(translated); makeAutoEnRef.current = translated;
                }
              }} data-testid="form-vehicle-make-zh" placeholder="宝马" className={cn(inputClass, "mt-1.5")} /></label>
              <label className={labelClass}>品牌（英文）<RequiredMark /><input ref={makeRef} value={make} onChange={(event) => {
                const value = event.target.value;
                changeText(setMake, "make")(value);
                const translated = translateVehicleMake(value);
                if (translated && (makeZh === "" || makeZh === makeAutoZhRef.current)) {
                  setMakeZh(translated); makeAutoZhRef.current = translated;
                }
              }} data-testid="form-vehicle-make" aria-required="true" aria-invalid={errors.make ? "true" : "false"} aria-describedby={errors.make ? "form-vehicle-make-error-message" : undefined} placeholder="BMW" className={cn(inputClass, "mt-1.5", errors.make && invalidClass)} /><FieldError id="form-vehicle-make-error-message" testId="form-vehicle-make-error">{errors.make}</FieldError></label>
              <label className={labelClass}>车型（中文）<input value={modelZh} onChange={(event) => {
                const value = event.target.value;
                setModelZh(value);
                invalidate("model");
                const translated = translateVehicleModel(value);
                if (translated && (model === "" || model === modelAutoEnRef.current)) {
                  setModel(translated); modelAutoEnRef.current = translated;
                }
              }} data-testid="form-vehicle-model-zh" placeholder="X5 xDrive" className={cn(inputClass, "mt-1.5")} /></label>
              <label className={labelClass}>车型（英文）<RequiredMark /><input ref={modelRef} value={model} onChange={(event) => {
                const value = event.target.value;
                changeText(setModel, "model")(value);
                const translated = translateVehicleModel(value);
                if (translated && (modelZh === "" || modelZh === modelAutoZhRef.current)) {
                  setModelZh(translated); modelAutoZhRef.current = translated;
                }
              }} data-testid="form-vehicle-model" aria-required="true" aria-invalid={errors.model ? "true" : "false"} aria-describedby={errors.model ? "form-vehicle-model-error-message" : undefined} placeholder="X5 XDRIVE" className={cn(inputClass, "mt-1.5", errors.model && invalidClass)} /><FieldError id="form-vehicle-model-error-message" testId="form-vehicle-model-error">{errors.model}</FieldError></label>
                </div>
              </div>

              <div className="border-t border-line pt-4">
                <div className="mb-2 text-[11px] font-bold tracking-wide text-primary">车辆参数</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className={labelClass}>年份{isFormalCustomerVehicleApiEnabled ? null : <RequiredMark />}<input ref={yearRef} type="number" value={year} onChange={(event) => changeText(setYear, "year")(event.target.value)} data-testid="form-vehicle-year" aria-required={isFormalCustomerVehicleApiEnabled ? undefined : "true"} aria-invalid={errors.year ? "true" : "false"} aria-describedby={errors.year ? "form-vehicle-year-error-message" : undefined} className={cn(inputClass, "mt-1.5", errors.year && invalidClass)} /><FieldError id="form-vehicle-year-error-message" testId="form-vehicle-year-error">{errors.year}</FieldError></label>
                  <label className={labelClass}>颜色<input value={color} onChange={(event) => changeText(setColor)(event.target.value)} data-testid="form-vehicle-color" className={cn(inputClass, "mt-1.5")} /></label>
                  <label className={labelClass}>车身类型<input value={bodyType} onChange={(event) => changeText(setBodyType)(event.target.value)} placeholder="旅行车 / 轿车" data-testid="form-vehicle-body-type" className={cn(inputClass, "mt-1.5")} /></label>
                  <label className={labelClass}>燃油<input value={fuelType} onChange={(event) => changeText(setFuelType)(event.target.value)} placeholder="汽油 / 柴油" data-testid="form-vehicle-fuel" className={cn(inputClass, "mt-1.5")} /></label>
                  <label className={labelClass}>排量 CC<input value={ccRating} onChange={(event) => changeText(setCcRating)(event.target.value)} inputMode="numeric" data-testid="form-vehicle-cc" className={cn(inputClass, "mt-1.5")} /></label>
                  <label className={labelClass}>座位数<input value={seating} onChange={(event) => changeText(setSeating)(event.target.value)} inputMode="numeric" data-testid="form-vehicle-seating" className={cn(inputClass, "mt-1.5")} /></label>
                  <label className={cn(labelClass, "lg:col-span-2")}>用途<input value={usage} onChange={(event) => changeText(setUsage)(event.target.value)} data-testid="form-vehicle-usage" className={cn(inputClass, "mt-1.5")} /></label>
                  <label className={cn(labelClass, "lg:col-span-2")}>特别说明<textarea value={specialNotes} onChange={(event) => changeText(setSpecialNotes)(event.target.value)} data-testid="form-vehicle-special-notes" className={cn(textAreaClass, "mt-1.5 min-h-11")} /></label>
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection icon={UserRoundCheck} title="当前客户" hint="一台车同一时间只有一位当前客户">
            {selectedCustomer ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary-50/50 px-3.5 py-2.5" data-testid="form-vehicle-selected-customer">
                <div className="min-w-0"><div className="truncate text-sm font-bold text-ink">{customerDisplayName(selectedCustomer)}</div><div className="mt-0.5 truncate text-[11px] text-ink-soft">{selectedCustomer.phone ? formatPhoneE164(selectedCustomer.phone) : "手机号待补"} · {selectedCustomer.trn ? `TRN ${selectedCustomer.trn}` : selectedCustomer.id}</div></div>
                <button type="button" aria-label="取消绑定当前客户" onClick={() => { setCurrentCustomerId(""); setCustomerQuery(""); invalidate(); }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-white"><X size={15} aria-hidden /></button>
              </div>
            ) : null}
            <div className="relative">
              <label className={labelClass}>搜索客户
                <span className="relative mt-1.5 block">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden />
                  <input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} data-testid="form-vehicle-current-customer" aria-describedby="form-vehicle-current-customer-help" placeholder="输入姓名、手机号、TRN 或客户编号" className={cn(inputClass, "pl-9")} />
                </span>
              </label>
              {customerQuery.trim() ? (
                <div className="mt-2 overflow-hidden rounded-xl border border-line bg-white" data-testid="form-vehicle-customer-results">
                  {customerCandidates.length > 0 ? customerCandidates.map((entry) => (
                    <button key={entry.id} type="button" onClick={() => { setCurrentCustomerId(entry.id); setCustomerQuery(""); invalidate(); }} className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-line px-3 text-left last:border-b-0 hover:bg-surface">
                      <span className="min-w-0"><span className="block truncate text-xs font-bold text-ink">{customerDisplayName(entry)}</span><span className="mt-0.5 block truncate text-[10px] text-ink-soft">{entry.phone ? formatPhoneE164(entry.phone) : "手机号待补"} · {entry.trn ? `TRN ${entry.trn}` : entry.id}</span></span>
                      <span className="shrink-0 text-[10px] font-bold text-primary">选择</span>
                    </button>
                  )) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div><div className="text-xs font-bold text-ink">没有找到客户</div><div className="mt-0.5 text-[10px] text-ink-soft">可直接新建，完成后会自动绑定这辆车</div></div>
                      <button type="button" onClick={() => setCreatingCustomer(true)} data-testid="form-vehicle-create-customer" className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-primary px-3 text-xs font-bold text-primary"><UserPlus size={15} aria-hidden />新建客户</button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <p id="form-vehicle-current-customer-help" className="mt-2 text-xs leading-5 text-ink-soft dark:text-slate-400">
              换绑客户会结束原当前关系并保留历史；没有搜索结果时可直接新建客户并自动绑定。
            </p>
          </FormSection>

          {creatingCustomer ? (
            isFormalCustomerVehicleApiEnabled
              ? <FormalCustomerCreateDialog onClose={() => setCreatingCustomer(false)} onSaved={(created) => { setNewCustomers((current) => [...current, created]); setCurrentCustomerId(created.id); setCreatingCustomer(false); invalidate(); }} />
              : <CustomerOnboardingDialog customers={selectableCustomers} onClose={() => setCreatingCustomer(false)} onSaved={(created) => { setNewCustomers((current) => [...current, created]); setCurrentCustomerId(created.id); setCreatingCustomer(false); invalidate(); }} />
          ) : null}

          <label className={labelClass}>保存原因<input value={reason} onChange={(event) => changeText(setReason)(event.target.value)} data-testid="form-vehicle-reason" className={cn(inputClass, "mt-1.5")} /></label>
          {preview && !preview.canSave ? <div data-testid="vehicle-duplicate-existing" role="alert" className="rounded-xl border border-rose-400 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-300"><div className="font-bold">车牌已存在，禁止重复保存</div><div className="mt-1">已有车辆：{preview.existingVehicleId}</div></div> : null}
          {saveError ? <p data-testid="vehicle-form-save-error" role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{saveError}</p> : null}
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={guard.requestClose} data-testid="vehicle-form-cancel" className="min-h-10 rounded-lg border border-line bg-white px-4 text-xs font-medium text-ink-soft dark:bg-slate-900 dark:text-slate-300">取消</button><button type="submit" disabled={saving || committed || preview?.canSave === false} data-testid="vehicle-form-save" className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50">{committed ? "已保存" : saving ? "保存中…" : mode === "create" ? "创建" : "保存"}</button></div>
        </form>
      )}
    </Dialog>
  );
}
