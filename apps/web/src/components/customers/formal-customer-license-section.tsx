"use client";

import { Camera, ClipboardPaste, FileImage, Keyboard, ScanLine, ShieldCheck, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LicenseImageEditor } from "@/components/customers/license-image-editor";
import { recognizeFormalCustomerLicense } from "@/lib/customers/formal-customer-license-client";
import type { CustomerLicenseRecognition } from "@/lib/customers/customer-driver-license-recognition";
import type { LicenseImageTransform } from "@/lib/customers/license-extraction/image-input";
import { cn } from "@/lib/utils";
import { isEditablePasteTarget, selectSingleDocumentImage } from "@/lib/customers/document-image-selection";

export type FormalCustomerLicenseValue = {
  file: File | null;
  transform: LicenseImageTransform;
  fields: { name: string; birthDate: string; sex: "" | "M" | "F"; address: string };
  status: CustomerLicenseRecognition["status"];
  attested: boolean;
  mode: "ai" | "manual";
};

export function emptyFormalCustomerLicense(): FormalCustomerLicenseValue {
  return {
    file: null,
    transform: { rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } },
    fields: { name: "", birthDate: "", sex: "", address: "" },
    status: {
      name: "manual_required",
      birthDate: "manual_required",
      sex: "manual_required",
      address: "manual_required",
    },
    attested: false,
    mode: "ai",
  };
}

const fieldClass = cn(
  "mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none",
  "focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900 dark:text-slate-100",
);

export function FormalCustomerLicenseSection({
  subjectLabel,
  value,
  disabled = false,
  onChange,
}: {
  subjectLabel: "客户" | "主要联系人";
  value: FormalCustomerLicenseValue;
  disabled?: boolean;
  onChange: (value: FormalCustomerLicenseValue) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [recognitionState, setRecognitionState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const attemptRef = useRef(0);
  const revisionRef = useRef(0);

  useEffect(() => {
    if (!value.file) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(value.file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value.file]);

  useEffect(() => {
    revisionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setRecognitionState((current) => current === "running" ? "idle" : current);
  }, [
    value.file,
    value.transform.rotation,
    value.transform.crop.x,
    value.transform.crop.y,
    value.transform.crop.width,
    value.transform.crop.height,
    value.fields.name,
    value.fields.birthDate,
    value.fields.sex,
    value.fields.address,
  ]);

  useEffect(() => () => {
    attemptRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const update = useCallback((next: FormalCustomerLicenseValue) => {
    setError(null);
    onChange(next);
  }, [onChange]);

  const chooseFiles = useCallback((files: Iterable<File>) => {
    const selection = selectSingleDocumentImage(files);
    if ("error" in selection) {
      setError(selection.error);
      return;
    }
    update({ ...emptyFormalCustomerLicense(), file: selection.file, mode: value.mode });
  }, [update, value.mode]);

  useEffect(() => {
    if (disabled) return;
    const onPaste = (event: ClipboardEvent) => {
      if (isEditablePasteTarget(event.target)) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (!files.length) return;
      event.preventDefault();
      chooseFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [chooseFiles, disabled]);

  const recognize = async () => {
    if (!value.file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const attempt = ++attemptRef.current;
    const revision = revisionRef.current;
    setRecognitionState("running");
    setError(null);
    try {
      const result = await recognizeFormalCustomerLicense({
        file: value.file,
        transform: value.transform,
        signal: controller.signal,
      });
      if (controller.signal.aborted || attempt !== attemptRef.current || revision !== revisionRef.current) return;
      update({
        ...value,
        fields: {
          name: result.fields.name ?? value.fields.name,
          birthDate: result.fields.birthDate ?? value.fields.birthDate,
          sex: result.fields.sex ?? value.fields.sex,
          address: result.fields.address ?? value.fields.address,
        },
        status: result.status,
      });
      setRecognitionState("success");
    } catch (recognitionError) {
      if (controller.signal.aborted || attempt !== attemptRef.current) return;
      setRecognitionState("error");
      setError(recognitionError instanceof Error
        ? recognitionError.message
        : "证件识别暂时不可用，已保留当前图片和输入");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const complete = Boolean(
    value.file && value.fields.name.trim() && validIsoBirthDate(value.fields.birthDate) &&
    value.fields.sex && value.fields.address.trim(),
  );
  const status = !value.file ? "待补" : value.attested && complete ? "已核验" : "待核验";

  return (
    <section data-testid="formal-customer-license-section" className="overflow-hidden rounded-2xl border border-line bg-white dark:border-slate-700 dark:bg-slate-800/70">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-4 dark:bg-slate-900/50 sm:px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-50 text-primary dark:bg-primary/15"><ScanLine size={18} aria-hidden /></span>
        <div>
          <h3 className="text-sm font-bold text-ink dark:text-slate-100">扫描{subjectLabel}驾驶证</h3>
          <p className="mt-0.5 text-[11px] text-ink-soft dark:text-slate-400">正面 · JPEG/PNG · 可跳过后续补录</p>
        </div>
        <span className={cn("ml-auto rounded-full px-3 py-1 text-[11px] font-bold", status === "已核验" ? "bg-emerald-50 text-emerald-700" : status === "待核验" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600")}>{status}</span>
      </div>
      <fieldset disabled={disabled} className="space-y-4 p-4 disabled:opacity-60 sm:p-5">
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" aria-pressed={value.mode === "ai"} onClick={() => update({ ...value, mode: "ai" })} className={cn("flex min-h-14 items-center gap-2 rounded-xl border px-3 text-left text-xs font-semibold", value.mode === "ai" ? "border-primary bg-primary-50/60 text-primary" : "border-line text-ink-soft")}><ScanLine size={17} aria-hidden />AI 辅助识别</button>
          <button type="button" aria-pressed={value.mode === "manual"} onClick={() => update({ ...value, mode: "manual" })} className={cn("flex min-h-14 items-center gap-2 rounded-xl border px-3 text-left text-xs font-semibold", value.mode === "manual" ? "border-primary bg-primary-50/60 text-primary" : "border-line text-ink-soft")}><Keyboard size={17} aria-hidden />对照原件手动填写</button>
        </div>

        {!imageUrl ? (
          <label
            data-testid="formal-customer-license-dropzone"
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFiles(event.dataTransfer.files); }}
            className={cn(
              "flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 text-center transition-colors dark:bg-slate-900/50",
              dragging ? "border-primary bg-primary-50 ring-2 ring-primary/20" : "border-primary/35 bg-surface",
            )}
          >
            {dragging ? <Upload size={24} className="text-primary" aria-hidden /> : <Camera size={22} className="text-primary" aria-hidden />}
            <strong className="mt-2 text-sm text-ink dark:text-slate-100">拖拽、粘贴、拍摄或选择驾驶证正面</strong>
            <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-soft"><ClipboardPaste size={13} aria-hidden />支持 Command/Ctrl + V · JPEG/PNG · 12 MB 以内</span>
            <span className="mt-1 text-[11px] text-ink-soft">资料只提交到正式系统</span>
            <input type="file" accept="image/jpeg,image/png" capture="environment" data-testid="formal-customer-license-file" onChange={(event) => chooseFiles(event.target.files ?? [])} className="sr-only" />
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-soft"><FileImage size={15} aria-hidden />已加载证件正面</span>
              <label className="cursor-pointer rounded-lg border border-primary px-3 py-2 text-xs font-bold text-primary">更换图片<input type="file" accept="image/jpeg,image/png" capture="environment" onChange={(event) => chooseFiles(event.target.files ?? [])} className="sr-only" /></label>
            </div>
            <LicenseImageEditor imageUrl={imageUrl} transform={value.transform} disabled={recognitionState === "running"} onChange={(transform) => update({ ...value, transform, attested: false })} />
          </div>
        )}

        {value.file && value.mode === "ai" ? (
          <button type="button" onClick={() => void recognize()} disabled={recognitionState === "running"} data-testid="formal-customer-license-recognize" className="min-h-11 rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:opacity-50">{recognitionState === "running" ? "识别中…" : "AI 辅助识别"}</button>
        ) : null}
        {recognitionState === "success" ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">识别结果已填入，请对照原件核对</p> : null}
        {error ? <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{error}</p> : null}

        {value.file ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="姓名" manual={value.status.name === "manual_required"}><input value={value.fields.name} onChange={(event) => update({ ...value, fields: { ...value.fields, name: event.target.value }, attested: false })} className={fieldClass} /></Field>
            <Field label="出生日期" manual={value.status.birthDate === "manual_required"}><input inputMode="numeric" placeholder="YYYY-MM-DD" maxLength={10} value={value.fields.birthDate} onChange={(event) => update({ ...value, fields: { ...value.fields, birthDate: event.target.value }, attested: false })} className={fieldClass} /></Field>
            <Field label="性别" manual={value.status.sex === "manual_required"}><select value={value.fields.sex} onChange={(event) => update({ ...value, fields: { ...value.fields, sex: event.target.value as "" | "M" | "F" }, attested: false })} className={fieldClass}><option value="">请选择</option><option value="M">M / 男</option><option value="F">F / 女</option></select></Field>
            <Field label="证件地址" manual={value.status.address === "manual_required"} wide><textarea rows={3} value={value.fields.address} onChange={(event) => update({ ...value, fields: { ...value.fields, address: event.target.value }, attested: false })} className={cn(fieldClass, "py-2.5")} /></Field>
          </div>
        ) : null}

        {value.file ? (
          <label className={cn("flex items-start gap-3 rounded-xl border p-3 text-xs leading-5", value.attested ? "border-emerald-300 bg-emerald-50" : "border-line bg-surface")}>
            <input type="checkbox" checked={value.attested} disabled={!complete} onChange={(event) => update({ ...value, attested: event.target.checked })} className="mt-1 accent-primary" />
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden />
            <span>已核对到场本人、驾驶证原件和以上四项资料</span>
          </label>
        ) : null}
      </fieldset>
    </section>
  );
}

function Field({ label, manual, wide = false, children }: {
  label: string;
  manual: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return <label className={cn("text-[13px] font-semibold text-ink dark:text-slate-200", wide && "sm:col-span-2")}>{label} <span className="text-rose-600">*</span>{manual ? <span className="ml-2 text-[10px] text-amber-700">请人工填写</span> : null}{children}</label>;
}

function validIsoBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day && date <= new Date();
}
