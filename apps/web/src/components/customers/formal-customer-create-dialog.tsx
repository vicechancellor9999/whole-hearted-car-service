"use client";

import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import {
  FormalCustomerLicenseSection,
  emptyFormalCustomerLicense,
  type FormalCustomerLicenseValue,
} from "@/components/customers/formal-customer-license-section";
import { Dialog } from "@/components/ui/dialog";
import {
  createFormalCustomer,
  type FormalCustomerCreateDraft,
  type FormalCustomerCreateExtension,
} from "@/lib/customers/formal-customer-create";
import type { CustomerRecord, CustomerType } from "@/lib/customers/types";
import { cn } from "@/lib/utils";

const inputClass = cn(
  "mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[13px] text-ink outline-none",
  "focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100",
);
const labelClass = "block text-[13px] font-semibold text-ink dark:text-slate-200";

type PrimaryContactMode = "new" | "existing" | "none";
type PrimaryContactDraft = {
  fullName: string;
  phone: string;
  whatsapp: string;
  trn: string;
  jobTitle: string;
  existingCustomerNo: string;
};

function emptyDraft(): FormalCustomerCreateDraft {
  return {
    customerType: "individual",
    fullName: "",
    organizationName: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    trn: "",
  };
}

function emptyPrimaryContact(): PrimaryContactDraft {
  return { fullName: "", phone: "", whatsapp: "", trn: "", jobTitle: "", existingCustomerNo: "" };
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "客户档案保存失败";
}

function textOrUndefined(value: string): string | undefined {
  return value.trim() || undefined;
}

export function FormalCustomerCreateDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (customer: CustomerRecord) => void | Promise<void>;
}) {
  const initial = useMemo(emptyDraft, []);
  const [draft, setDraft] = useState(initial);
  const [license, setLicense] = useState(emptyFormalCustomerLicense);
  const [primaryContactMode, setPrimaryContactMode] = useState<PrimaryContactMode>("new");
  const [primaryContact, setPrimaryContact] = useState(emptyPrimaryContact);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const change = (field: keyof FormalCustomerCreateDraft, value: string | CustomerType) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "customerType") {
      setLicense(emptyFormalCustomerLicense());
      setPrimaryContactMode("new");
      setPrimaryContact(emptyPrimaryContact());
      setErrors({});
    } else {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
    setSaveError(null);
  };

  const changeContact = (field: keyof PrimaryContactDraft, value: string) => {
    setPrimaryContact((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next.primaryContact;
      return next;
    });
    setSaveError(null);
  };

  const changeLicense = useCallback((next: FormalCustomerLicenseValue) => {
    setLicense(next);
    setSaveError(null);
    setErrors((current) => {
      const copy = { ...current };
      delete copy.license;
      return copy;
    });
    if (!next.fields.name.trim()) return;
    if (draft.customerType === "individual") {
      setDraft((current) => ({
        ...current,
        fullName: next.fields.name,
        address: next.fields.address.trim() || current.address,
      }));
    } else if (primaryContactMode === "new") {
      setPrimaryContact((current) => ({ ...current, fullName: next.fields.name }));
    }
  }, [draft.customerType, primaryContactMode]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (draft.customerType === "individual" && !draft.fullName.trim()) next.fullName = "客户姓名为必填项";
    if (draft.customerType === "organization" && !draft.organizationName.trim()) next.organizationName = "公司名称为必填项";
    if (draft.customerType === "organization" && primaryContactMode === "new" && !primaryContact.fullName.trim()) {
      next.primaryContact = "主要联系人姓名为必填项；也可以选择暂不设置";
    }
    if (draft.customerType === "organization" && primaryContactMode === "existing" && !primaryContact.existingCustomerNo.trim()) {
      next.primaryContact = "请输入已确认复用的个人客户编号";
    }
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) next.email = "请输入有效的 Email 地址";
    if (license.file && !(license.fields.name.trim() && license.fields.birthDate && license.fields.sex && license.fields.address.trim())) {
      next.license = "已选择驾驶证图片，请补全姓名、出生日期、性别和证件地址";
    }
    setErrors(next);
    if (next.fullName || next.organizationName) nameRef.current?.focus();
    return Object.keys(next).length === 0;
  };

  const buildExtension = (): FormalCustomerCreateExtension | undefined => {
    const licenseExtension = license.file && license.fields.sex
      ? {
          file: license.file,
          transform: license.transform,
          profile: {
            name: license.fields.name.trim(),
            birthDate: license.fields.birthDate,
            sex: license.fields.sex,
            address: license.fields.address.trim(),
          },
          verified: license.attested,
          status: license.status,
        }
      : undefined;
    if (draft.customerType === "individual") return licenseExtension ? { license: licenseExtension } : undefined;
    const primaryContactExtension: FormalCustomerCreateExtension["primaryContact"] = primaryContactMode === "existing"
      ? { existingPersonalCustomerNo: primaryContact.existingCustomerNo.trim() }
      : primaryContactMode === "new"
        ? { newPrimaryContact: {
            fullName: primaryContact.fullName.trim(),
            phone: textOrUndefined(primaryContact.phone),
            whatsapp: textOrUndefined(primaryContact.whatsapp),
            trn: textOrUndefined(primaryContact.trn),
            jobTitle: textOrUndefined(primaryContact.jobTitle),
          } }
        : undefined;
    return primaryContactExtension || licenseExtension
      ? { primaryContact: primaryContactExtension, license: licenseExtension }
      : undefined;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const customer = await createFormalCustomer(draft, buildExtension());
      await onSaved(customer);
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  const licenseStatus = !license.file ? "待补" : license.attested ? "已核验" : "待核验";
  const contactIdentity = draft.customerType === "organization" && primaryContactMode === "new";
  const missing = [
    `驾驶证：${licenseStatus}${!license.file ? "，将在客户档案中保留提醒" : ""}`,
    `手机号：${(contactIdentity ? primaryContact.phone : draft.phone).trim() ? "已填写" : "待补"}`,
    `TRN：${(contactIdentity ? primaryContact.trn : draft.trn).trim() ? "已填写" : "待补"}`,
  ];

  return (
    <Dialog
      open
      title="新建客户"
      onClose={() => { if (!saving) onClose(); }}
      closeLabel="关闭客户建档表单"
      dataTestId="formal-customer-create-dialog"
      closeTestId="formal-customer-create-close"
      className="w-[min(980px,calc(100vw-1.5rem))]"
    >
      <form noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void save(); }} className="max-h-[calc(100vh-7rem)] space-y-5 overflow-y-auto p-4 sm:p-6">
        <p className="rounded-xl border border-primary/20 bg-primary-50/50 px-3.5 py-2.5 text-xs leading-5 text-ink-soft dark:bg-primary/10 dark:text-slate-300">
          资料直接写入正式客户档案。手机号、TRN 或驾驶证暂缺时仍可建档，系统会保留待补提醒。
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>客户类型
            <select value={draft.customerType} onChange={(event) => change("customerType", event.target.value as CustomerType)} data-testid="formal-customer-create-type" className={inputClass}><option value="individual">个人</option><option value="organization">公司</option></select>
          </label>
          {draft.customerType === "individual" ? (
            <label className={labelClass}>客户姓名 <span className="text-rose-700">*</span><input ref={nameRef} value={draft.fullName} onChange={(event) => change("fullName", event.target.value)} data-testid="formal-customer-create-name" className={inputClass} />{errors.fullName ? <span role="alert" className="mt-1 block text-[11px] text-rose-700">{errors.fullName}</span> : null}</label>
          ) : (
            <label className={labelClass}>公司名称 <span className="text-rose-700">*</span><input ref={nameRef} value={draft.organizationName} onChange={(event) => change("organizationName", event.target.value)} data-testid="formal-customer-create-organization" className={inputClass} />{errors.organizationName ? <span role="alert" className="mt-1 block text-[11px] text-rose-700">{errors.organizationName}</span> : null}</label>
          )}
          <label className={labelClass}>{draft.customerType === "organization" ? "公司电话" : "手机号"}<input type="tel" value={draft.phone} onChange={(event) => change("phone", event.target.value)} data-testid="formal-customer-create-phone" className={inputClass} /></label>
          {draft.customerType === "individual" ? <label className={labelClass}>WhatsApp<input type="tel" value={draft.whatsapp} onChange={(event) => change("whatsapp", event.target.value)} data-testid="formal-customer-create-whatsapp" className={inputClass} /></label> : null}
          <label className={labelClass}>{draft.customerType === "organization" ? "公司 TRN 税号" : "TRN 税号"}<input inputMode="numeric" value={draft.trn} onChange={(event) => change("trn", event.target.value)} data-testid="formal-customer-create-trn" className={inputClass} /></label>
          <label className={labelClass}>Email<input type="email" value={draft.email} onChange={(event) => change("email", event.target.value)} data-testid="formal-customer-create-email" className={inputClass} />{errors.email ? <span role="alert" className="mt-1 block text-[11px] text-rose-700">{errors.email}</span> : null}</label>
          <label className={cn(labelClass, "sm:col-span-2")}>{draft.customerType === "organization" ? "公司通讯地址" : "地址"}<input value={draft.address} onChange={(event) => change("address", event.target.value)} data-testid="formal-customer-create-address" className={inputClass} /></label>
        </div>

        {draft.customerType === "organization" ? (
          <section className="rounded-2xl border border-line bg-surface p-4 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-sm font-bold text-ink dark:text-slate-100">主要联系人</h3><p className="mt-1 text-[11px] text-ink-soft">联系人证件地址不会覆盖公司通讯地址</p></div>
              <select value={primaryContactMode} onChange={(event) => { setPrimaryContactMode(event.target.value as PrimaryContactMode); setLicense(emptyFormalCustomerLicense()); }} className="min-h-10 rounded-lg border border-line bg-white px-3 text-xs font-semibold dark:bg-slate-900"><option value="new">新建主要联系人</option><option value="existing">复用已有个人客户</option><option value="none">暂不设置</option></select>
            </div>
            {primaryContactMode === "existing" ? (
              <label className={cn(labelClass, "mt-4")}>已确认复用的个人客户编号 <span className="text-rose-700">*</span><input value={primaryContact.existingCustomerNo} onChange={(event) => changeContact("existingCustomerNo", event.target.value)} placeholder="CUST-202608-0001" className={inputClass} /></label>
            ) : primaryContactMode === "new" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className={labelClass}>联系人姓名 <span className="text-rose-700">*</span><input value={primaryContact.fullName} onChange={(event) => changeContact("fullName", event.target.value)} className={inputClass} /></label>
                <label className={labelClass}>职位<input value={primaryContact.jobTitle} onChange={(event) => changeContact("jobTitle", event.target.value)} className={inputClass} /></label>
                <label className={labelClass}>手机号<input type="tel" value={primaryContact.phone} onChange={(event) => changeContact("phone", event.target.value)} className={inputClass} /></label>
                <label className={labelClass}>WhatsApp<input type="tel" value={primaryContact.whatsapp} onChange={(event) => changeContact("whatsapp", event.target.value)} className={inputClass} /></label>
                <label className={labelClass}>TRN<input value={primaryContact.trn} onChange={(event) => changeContact("trn", event.target.value)} className={inputClass} /></label>
              </div>
            ) : <p className="mt-4 rounded-xl bg-white px-3 py-2 text-xs text-ink-soft dark:bg-slate-900">公司将先建档，主要联系人显示待补，后续可在公司详情补录。</p>}
            {errors.primaryContact ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{errors.primaryContact}</p> : null}
          </section>
        ) : null}

        <FormalCustomerLicenseSection subjectLabel={draft.customerType === "individual" ? "客户" : "主要联系人"} value={license} disabled={saving || (draft.customerType === "organization" && primaryContactMode === "none")} onChange={changeLicense} />
        {errors.license ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{errors.license}</p> : null}

        <section className="rounded-xl border border-line bg-surface px-4 py-3 dark:bg-slate-900/40"><h3 className="text-xs font-bold text-ink dark:text-slate-100">当前缺项摘要</h3><ul className="mt-2 space-y-1 text-xs text-ink-soft">{missing.map((item) => <li key={item}>{item}</li>)}</ul></section>
        {saveError ? <p role="alert" data-testid="formal-customer-create-error" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{saveError}</p> : null}
        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-line bg-white pt-4 dark:bg-slate-800 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={onClose} className="min-h-10 rounded-lg border border-line bg-white px-4 text-xs font-medium text-ink-soft disabled:opacity-50 dark:bg-slate-900">取消</button><button type="submit" disabled={saving} data-testid="formal-customer-create-save" className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-50">{saving ? "保存中…" : "创建并使用"}</button></div>
      </form>
    </Dialog>
  );
}
