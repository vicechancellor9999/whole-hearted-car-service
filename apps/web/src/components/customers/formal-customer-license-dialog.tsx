"use client";

import { useState, type FormEvent } from "react";
import { Dialog } from "@/components/ui/dialog";
import {
  emptyFormalCustomerLicense,
  FormalCustomerLicenseSection,
  type FormalCustomerLicenseValue,
} from "@/components/customers/formal-customer-license-section";
import {
  supplementFormalCustomerLicense,
  type FormalCustomerLicenseRecord,
} from "@/lib/customers/formal-customer-license-detail";

export function FormalCustomerLicenseDialog({
  customerNo,
  organization,
  replacing,
  onClose,
  onSaved,
}: {
  customerNo: string;
  organization: boolean;
  replacing: boolean;
  onClose: () => void;
  onSaved: (record: FormalCustomerLicenseRecord) => void | Promise<void>;
}) {
  const [value, setValue] = useState<FormalCustomerLicenseValue>(emptyFormalCustomerLicense);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!value.file) return setError("请先拍摄或选择驾驶证正面");
    if (!value.fields.name.trim() || !value.fields.birthDate || !value.fields.sex ||
        !value.fields.address.trim()) {
      return setError("请完整填写驾驶证姓名、出生日期、性别和证件地址");
    }
    if (!value.attested) return setError("请先对照原件完成核验确认");
    setPending(true);
    try {
      const record = await supplementFormalCustomerLicense(customerNo, {
        file: value.file,
        transform: value.transform,
        profile: {
          name: value.fields.name.trim(),
          birthDate: value.fields.birthDate,
          sex: value.fields.sex,
          address: value.fields.address.trim(),
        },
        verified: value.attested,
      });
      await onSaved(record);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "驾驶证补录失败，请重试");
    } finally {
      setPending(false);
    }
  };

  const title = replacing ? "替换驾驶证记录" : "补录驾驶证";
  return (
    <Dialog
      open
      title={title}
      onClose={() => { if (!pending) onClose(); }}
      dataTestId="formal-customer-license-dialog"
      closeLabel={`关闭${title}`}
      className="w-[min(920px,calc(100vw-1.5rem))]"
      mobileFullscreen
    >
      <form
        noValidate
        onSubmit={(event: FormEvent) => { event.preventDefault(); void save(); }}
        className="space-y-4 p-4 sm:p-6"
      >
        <p className="rounded-xl border border-primary/20 bg-primary-50/50 px-3.5 py-2.5 text-xs leading-5 text-ink-soft dark:bg-primary/10 dark:text-slate-300">
          {replacing
            ? "新记录保存后立即生效，旧记录继续保留在历史中。"
            : "资料将补入正式客户档案，并保留操作与核验记录。"}
        </p>
        <FormalCustomerLicenseSection
          subjectLabel={organization ? "主要联系人" : "客户"}
          value={value}
          disabled={pending}
          onChange={setValue}
        />
        {error ? (
          <p role="alert" data-testid="formal-customer-license-save-error" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <button type="button" disabled={pending} onClick={onClose} className="min-h-10 rounded-lg border border-line bg-white px-4 text-xs font-medium text-ink-soft disabled:opacity-50 dark:bg-slate-900">取消</button>
          <button type="submit" disabled={pending} data-testid="formal-customer-license-save" className="min-h-10 rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-50">
            {pending ? "保存中…" : replacing ? "保存新记录" : "完成补录"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
