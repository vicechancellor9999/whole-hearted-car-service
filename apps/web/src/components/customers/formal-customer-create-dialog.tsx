"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import {
  createFormalCustomer,
  type FormalCustomerCreateDraft,
} from "@/lib/customers/formal-customer-create";
import type { CustomerRecord, CustomerType } from "@/lib/customers/types";
import { cn } from "@/lib/utils";

const inputClass = cn(
  "mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-[13px] text-ink outline-none",
  "focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100",
);
const labelClass = "block text-[13px] font-semibold text-ink dark:text-slate-200";

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

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "客户档案保存失败";
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const change = (field: keyof FormalCustomerCreateDraft, value: string | CustomerType) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "customerType") {
      setErrors({});
      setSaveError(null);
      return;
    }
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      if (field === "phone" || field === "trn") delete next.identity;
      return next;
    });
    setSaveError(null);
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (draft.customerType === "individual" && !draft.fullName.trim()) {
      next.fullName = "客户姓名为必填项";
    }
    if (draft.customerType === "organization" && !draft.organizationName.trim()) {
      next.organizationName = "公司名称为必填项";
    }
    if (draft.customerType === "individual" && !draft.phone.trim() && !draft.trn.trim()) {
      next.identity = "个人客户至少填写手机号或 TRN";
    }
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
      next.email = "请输入有效的 Email 地址";
    }
    setErrors(next);
    if (next.fullName || next.organizationName) nameRef.current?.focus();
    else if (next.identity) phoneRef.current?.focus();
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const customer = await createFormalCustomer(draft);
      await onSaved(customer);
    } catch (error) {
      setSaveError(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title="新建客户"
      onClose={() => { if (!saving) onClose(); }}
      closeLabel="关闭客户建档表单"
      dataTestId="formal-customer-create-dialog"
      closeTestId="formal-customer-create-close"
      className="w-[min(720px,calc(100vw-2rem))]"
    >
      <form noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); void save(); }} className="space-y-4 p-4 sm:p-6">
        <p className="rounded-xl border border-primary/20 bg-primary-50/50 px-3.5 py-2.5 text-xs leading-5 text-ink-soft dark:bg-primary/10 dark:text-slate-300">
          资料会直接写入正式客户档案。个人客户必须具备手机号或 TRN；其余缺失资料可后续编辑补齐。
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>客户类型
            <select value={draft.customerType} onChange={(event) => change("customerType", event.target.value as CustomerType)} data-testid="formal-customer-create-type" className={inputClass}>
              <option value="individual">个人</option>
              <option value="organization">公司</option>
            </select>
          </label>
          {draft.customerType === "individual" ? (
            <label className={labelClass}>客户姓名 <span className="text-rose-700">*</span>
              <input ref={nameRef} value={draft.fullName} onChange={(event) => change("fullName", event.target.value)} data-testid="formal-customer-create-name" className={inputClass} />
              {errors.fullName ? <span role="alert" className="mt-1 block text-[11px] text-rose-700">{errors.fullName}</span> : null}
            </label>
          ) : (
            <label className={labelClass}>公司名称 <span className="text-rose-700">*</span>
              <input ref={nameRef} value={draft.organizationName} onChange={(event) => change("organizationName", event.target.value)} data-testid="formal-customer-create-organization" className={inputClass} />
              {errors.organizationName ? <span role="alert" className="mt-1 block text-[11px] text-rose-700">{errors.organizationName}</span> : null}
            </label>
          )}
          <label className={labelClass}>手机号
            <input ref={phoneRef} type="tel" value={draft.phone} onChange={(event) => change("phone", event.target.value)} data-testid="formal-customer-create-phone" className={inputClass} />
            {errors.identity ? <span role="alert" className="mt-1 block text-[11px] text-rose-700">{errors.identity}</span> : null}
          </label>
          {draft.customerType === "individual" ? <label className={labelClass}>WhatsApp
            <input type="tel" value={draft.whatsapp} onChange={(event) => change("whatsapp", event.target.value)} data-testid="formal-customer-create-whatsapp" className={inputClass} />
          </label> : null}
          <label className={labelClass}>TRN 税号
            <input inputMode="numeric" value={draft.trn} onChange={(event) => change("trn", event.target.value)} data-testid="formal-customer-create-trn" className={inputClass} />
          </label>
          <label className={labelClass}>Email
            <input type="email" value={draft.email} onChange={(event) => change("email", event.target.value)} data-testid="formal-customer-create-email" className={inputClass} />
            {errors.email ? <span role="alert" className="mt-1 block text-[11px] text-rose-700">{errors.email}</span> : null}
          </label>
          <label className={cn(labelClass, "sm:col-span-2")}>地址
            <input value={draft.address} onChange={(event) => change("address", event.target.value)} data-testid="formal-customer-create-address" className={inputClass} />
          </label>
        </div>

        {saveError ? <p role="alert" data-testid="formal-customer-create-error" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{saveError}</p> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <button type="button" disabled={saving} onClick={onClose} className="min-h-10 rounded-lg border border-line bg-white px-4 text-xs font-medium text-ink-soft disabled:opacity-50 dark:bg-slate-900">取消</button>
          <button type="submit" disabled={saving} data-testid="formal-customer-create-save" className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-50">{saving ? "保存中…" : "创建并使用"}</button>
        </div>
      </form>
    </Dialog>
  );
}
