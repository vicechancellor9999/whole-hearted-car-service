"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  executeFormalRecordDeletion,
  FormalRecordDeletionApiError,
  previewFormalRecordDeletion,
} from "@/lib/api/formal-record-deletions";
import type {
  DeletionReasonCode,
  RecordDeletionPreview,
  RecordLocator,
  RecordReference,
} from "@formal/modules/record-deletion/record-deletion-types";

type RecordDeleteButtonProps = {
  record: RecordReference;
  title: string;
  returnTo: string;
  className?: string;
};

const reasonOptions: Array<{ value: DeletionReasonCode; label: string }> = [
  { value: "duplicate", label: "重复创建" },
  { value: "input_error", label: "录入错误" },
  { value: "test_data", label: "测试数据" },
  { value: "other", label: "其他" },
];

const dependentLabels: Record<string, string> = {
  vehicle_owner_history: "车主关系",
  vehicle_attachments: "车辆附件",
  customer_driver_license_records: "驾驶证资料",
  company_contacts: "公司联系人关系",
  repair_rounds: "维修轮次",
  business_order_charge_versions: "收费草稿",
  business_order_charge_items: "收费项目",
  business_order_notes: "业务备注",
  inspection_report_findings: "检查项目",
  inspection_paper_photo_files: "检查单纸质照片",
};

const identityLabels = {
  phone: "手机号",
  trn: "TRN",
  plate: "车牌",
  vin: "VIN",
};

export function RecordDeleteButton({
  record,
  title,
  returnTo,
  className,
}: RecordDeleteButtonProps) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestIdRef = useRef<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RecordDeletionPreview | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<RecordLocator[]>([
    { kind: record.kind, recordNo: record.recordNo },
  ]);
  const [reasonCode, setReasonCode] = useState<DeletionReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [confirmationRecordNo, setConfirmationRecordNo] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/formal/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => response.ok
        ? response.json() as Promise<{ account?: { role?: unknown } }>
        : null)
      .then((payload) => {
        const role = payload?.account?.role;
        setAllowed(role === "super_admin" || role === "front_desk");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!allowed) return null;

  const root = { kind: record.kind, recordNo: record.recordNo };

  const loadPreview = async (records: RecordLocator[]) => {
    setBusy(true);
    setErrorMessage(null);
    try {
      const result = await previewFormalRecordDeletion({
        root,
        selectedRecords: records,
      });
      setPreview(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除关联检查失败");
    } finally {
      setBusy(false);
    }
  };

  const openPreview = () => {
    const initial = [root];
    requestIdRef.current = `delete-${crypto.randomUUID()}`;
    setOpen(true);
    setPreview(null);
    setSelectedRecords(initial);
    setReasonCode("");
    setReasonNote("");
    setConfirmationRecordNo("");
    setErrorMessage(null);
    void loadPreview(initial);
  };

  const close = () => {
    if (!busy) setOpen(false);
  };

  const toggleLinkedRecord = (linked: RecordReference) => {
    const key = recordKey(linked);
    setSelectedRecords((current) => current.some((item) => recordKey(item) === key)
      ? current.filter((item) => recordKey(item) !== key)
      : [...current, { kind: linked.kind, recordNo: linked.recordNo }]);
  };

  const canConfirm = preview?.eligible === true
    && reasonCode !== ""
    && (reasonCode !== "other" || reasonNote.trim().length > 0)
    && confirmationRecordNo.normalize("NFKC").trim().toUpperCase() === record.recordNo
    && !busy;

  const confirm = async () => {
    if (!preview || !canConfirm) return;
    const requestId = requestIdRef.current
      ?? `delete-${crypto.randomUUID()}`;
    requestIdRef.current = requestId;
    setBusy(true);
    setErrorMessage(null);
    try {
      await executeFormalRecordDeletion({
        root,
        selectedRecords,
        reasonCode,
        reasonNote: reasonCode === "other" ? reasonNote.trim() : null,
        confirmationRecordNo,
        previewFingerprint: preview.previewFingerprint,
        requestId,
      });
      setOpen(false);
      router.push(returnTo);
      router.refresh();
    } catch (error) {
      if (error instanceof FormalRecordDeletionApiError
          && error.code === "DELETION_PREVIEW_STALE") {
        setErrorMessage("关联资料已经变化，系统已重新检查，请再次确认。");
        await loadPreview(selectedRecords);
      } else {
        setErrorMessage(error instanceof Error ? error.message : "删除操作未完成");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPreview}
        className={className ?? "inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:border-rose-900/70 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-950/40"}
      >
        <Trash2 size={16} aria-hidden />
        <span>删除</span>
      </button>

      <Dialog
        open={open}
        title={title}
        onClose={close}
        returnFocusElement={triggerRef.current}
        dataTestId="record-delete-dialog"
        className="w-[min(680px,calc(100vw-2rem))]"
      >
        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 shrink-0" size={18} aria-hidden />
            <div>
              <p className="text-sm font-bold">删除后无法恢复</p>
              <p className="mt-1 text-xs leading-5 opacity-80">系统会先检查关联资料；符合条件的记录才会进入最终确认。</p>
            </div>
          </div>

          {busy && !preview ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-ink-soft">
              <LoaderCircle className="animate-spin motion-reduce:animate-none" size={18} />
              正在检查关联资料…
            </div>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200">
              {errorMessage}
            </p>
          ) : null}

          {preview ? (
            <>
              <section aria-label="删除范围" className="rounded-xl border border-line p-4 dark:border-slate-700">
                <h3 className="text-sm font-bold text-ink dark:text-slate-100">本次删除范围</h3>
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm font-semibold text-ink dark:bg-slate-900 dark:text-slate-100">
                  {record.recordNo}
                </p>
                {preview.selectableLinkedRecords.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-ink-soft dark:text-slate-400">关联主记录需要逐项勾选，然后重新检查。</p>
                    {preview.selectableLinkedRecords.map((linked) => (
                      <label key={recordKey(linked)} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm dark:border-slate-700">
                        <input
                          type="checkbox"
                          checked={selectedRecords.some((item) => recordKey(item) === recordKey(linked))}
                          onChange={() => toggleLinkedRecord(linked)}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                        />
                        <span className="font-mono font-semibold">{linked.recordNo}</span>
                      </label>
                    ))}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void loadPreview(selectedRecords)}
                      className="mt-2 min-h-10 rounded-lg border border-primary-200 px-4 text-sm font-semibold text-primary hover:bg-primary-50 disabled:opacity-50"
                    >
                      {busy ? "正在重新检查…" : "重新检查关联"}
                    </button>
                  </div>
                ) : null}
              </section>

              {preview.eligible ? (
                <DeletionConfirmation
                  preview={preview}
                  recordNo={record.recordNo}
                  reasonCode={reasonCode}
                  reasonNote={reasonNote}
                  confirmationRecordNo={confirmationRecordNo}
                  busy={busy}
                  canConfirm={canConfirm}
                  onReasonCode={setReasonCode}
                  onReasonNote={setReasonNote}
                  onConfirmationRecordNo={setConfirmationRecordNo}
                  onCancel={close}
                  onConfirm={() => void confirm()}
                />
              ) : (
                <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/70 dark:bg-rose-950/25">
                  <h3 className="text-sm font-bold text-rose-700 dark:text-rose-200">当前记录无法删除</h3>
                  <ul className="mt-2 space-y-2 text-sm text-rose-700 dark:text-rose-200">
                    {preview.blockers.map((blocker) => (
                      <li key={`${blocker.code}:${blocker.linkedRecord?.recordNo ?? "root"}`}>
                        {blocker.label}{blocker.linkedRecord ? ` · ${blocker.linkedRecord.recordNo}` : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

function DeletionConfirmation({
  preview,
  recordNo,
  reasonCode,
  reasonNote,
  confirmationRecordNo,
  busy,
  canConfirm,
  onReasonCode,
  onReasonNote,
  onConfirmationRecordNo,
  onCancel,
  onConfirm,
}: {
  preview: RecordDeletionPreview;
  recordNo: string;
  reasonCode: DeletionReasonCode | "";
  reasonNote: string;
  confirmationRecordNo: string;
  busy: boolean;
  canConfirm: boolean;
  onReasonCode(value: DeletionReasonCode | ""): void;
  onReasonNote(value: string): void;
  onConfirmationRecordNo(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const dependentEntries = Object.entries(preview.dependentCounts)
    .filter(([, count]) => count > 0);
  return (
    <section className="space-y-4">
      {dependentEntries.length > 0 ? (
        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/70">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft dark:text-slate-400">随主记录删除</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {dependentEntries.map(([name, count]) => (
              <span key={name} className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
                {dependentLabels[name] ?? name} {count}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {preview.releasedIdentityKinds.length > 0 ? (
        <p className="text-xs text-ink-soft dark:text-slate-400">
          删除后将释放：{preview.releasedIdentityKinds.map((kind) => identityLabels[kind]).join("、")}
        </p>
      ) : null}
      <label className="block text-sm font-semibold text-ink dark:text-slate-100">
        删除原因
        <select
          value={reasonCode}
          onChange={(event) => onReasonCode(event.target.value as DeletionReasonCode | "")}
          className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">请选择</option>
          {reasonOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {reasonCode === "other" ? (
        <label className="block text-sm font-semibold text-ink dark:text-slate-100">
          原因说明
          <textarea
            value={reasonNote}
            maxLength={1000}
            onChange={(event) => onReasonNote(event.target.value)}
            className="mt-2 min-h-24 w-full rounded-xl border border-line bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
      ) : null}
      <label className="block text-sm font-semibold text-ink dark:text-slate-100">
        输入记录编号确认
        <span className="ml-2 font-mono text-xs text-ink-soft">{recordNo}</span>
        <input
          value={confirmationRecordNo}
          onChange={(event) => onConfirmationRecordNo(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 font-mono dark:border-slate-700 dark:bg-slate-900"
        />
      </label>
      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end dark:border-slate-700">
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-line px-5 text-sm font-semibold disabled:opacity-50 dark:border-slate-700">取消</button>
        <button type="button" disabled={!canConfirm} onClick={onConfirm} className="min-h-11 rounded-xl bg-rose-600 px-5 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "正在删除…" : "确认删除"}
        </button>
      </div>
    </section>
  );
}

function recordKey(record: RecordLocator): string {
  return `${record.kind}:${record.recordNo}`;
}
