"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useDeletionAccount } from "./use-deletion-account";
import { forgetDeletionAttempt, readDeletionAttempts, rememberDeletionAttempt } from "@/lib/record-deletion-recovery";
import {
  executeFormalRecordDeletion,
  FormalRecordDeletionApiError,
  previewFormalRecordDeletion,
  readFormalRecordDeletionResult,
} from "@/lib/api/formal-record-deletions";
import type {
  DeletionReasonCode,
  RecordDeletionPreview,
  RecordDeletionExecuteInput,
  RecordDeletionResult,
  RecordLocator,
  RecordReference,
} from "@formal/modules/record-deletion/record-deletion-types";

type RecordDeleteButtonProps = {
  record: RecordReference;
  title: string;
  returnTo: string;
  className?: string;
  onReviewBlockers?(preview: RecordDeletionPreview): void;
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
  inspection_report_workspace_versions: "AI／编辑草稿版本",
  inspection_paper_photo_files: "检查单纸质照片",
};

const identityLabels = {
  phone: "手机号",
  trn: "TRN",
  plate: "车牌",
  vin: "VIN",
};

export function RecordDeleteButton(props: RecordDeleteButtonProps) {
  const { accountId, error, reload, isCurrentAccount } = useDeletionAccount();
  if (error) return <button type="button" onClick={reload} title={error} className="min-h-11 text-sm text-state-danger-text">重新读取删除权限</button>;
  if (!accountId) return null;
  return <AccountRecordDeleteButton key={`${accountId}:${props.record.kind}:${props.record.recordNo}`} {...props} accountId={accountId} isCurrentAccount={isCurrentAccount} />;
}

function AccountRecordDeleteButton({
  record,
  title,
  returnTo,
  className,
  onReviewBlockers,
  accountId,
  isCurrentAccount,
}: RecordDeleteButtonProps & { accountId: number; isCurrentAccount(): boolean }) {
  const router = useRouter();
  const requestIdRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);
  const executingRef = useRef(false);
  const resultQueryRef = useRef(0);
  const resultQueryActive = useRef(false);
  const [checkingResult, setCheckingResult] = useState(false);
  const openRef = useRef(false);
  const mounted = useRef(true);
  const [restored] = useState(() => readDeletionAttempts(accountId));
  const [storageAvailable, setStorageAvailable] = useState(restored.available);
  const [submittedDelete, setSubmittedDelete] = useState<RecordDeletionExecuteInput | null>(() => restored.entries.find(entry => entry.input.root.kind === record.kind && entry.input.root.recordNo === record.recordNo)?.input ?? null);
  const [deletionResult, setDeletionResult] = useState<RecordDeletionResult | null>(null);
  const [navigationFailed, setNavigationFailed] = useState(false);
  const [returnFocusElement, setReturnFocusElement] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RecordDeletionPreview | null>(null);
  const [checkedSelection, setCheckedSelection] = useState<string | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<RecordLocator[]>([
    { kind: record.kind, recordNo: record.recordNo },
  ]);
  const [reasonCode, setReasonCode] = useState<DeletionReasonCode | "">("");
  const [reasonNote, setReasonNote] = useState("");
  const [confirmationRecordNo, setConfirmationRecordNo] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; previewRequestRef.current += 1; resultQueryRef.current += 1; openRef.current = false; };
  }, []);

  const root = { kind: record.kind, recordNo: record.recordNo };

  const loadPreview = async (records: RecordLocator[], notice?: string) => {
    const request = ++previewRequestRef.current;
    setBusy(true);
    setCheckedSelection(null);
    setErrorMessage(null);
    try {
      const result = await previewFormalRecordDeletion({
        root,
        selectedRecords: records,
      });
      if (request !== previewRequestRef.current) return;
      setPreview(result);
      setCheckedSelection(selectionKey(records));
      setErrorMessage(notice ?? null);
    } catch (error) {
      if (request === previewRequestRef.current) setErrorMessage(error instanceof Error ? error.message : "删除关联检查失败");
    } finally {
      if (request === previewRequestRef.current) setBusy(false);
    }
  };

  const openPreview = (event: MouseEvent<HTMLButtonElement>) => {
    const initial = [root];
    setReturnFocusElement(event.currentTarget);
    openRef.current = true;
    setOpen(true);
    if (submittedDelete || deletionResult) return;
    requestIdRef.current = `delete-${crypto.randomUUID()}`;
    setPreview(null);
    setSelectedRecords(initial);
    setReasonCode("");
    setReasonNote("");
    setConfirmationRecordNo("");
    setErrorMessage(null);
    void loadPreview(initial);
  };

  const close = () => {
    openRef.current = false;
    previewRequestRef.current += 1;
    resultQueryRef.current += 1;
    resultQueryActive.current = false;
    setCheckingResult(false);
    if (!executingRef.current) setBusy(false);
    setOpen(false);
  };

  const toggleLinkedRecord = (linked: RecordReference) => {
    const key = recordKey(linked);
    setSelectedRecords((current) => current.some((item) => recordKey(item) === key)
      ? current.filter((item) => recordKey(item) !== key)
      : [...current, { kind: linked.kind, recordNo: linked.recordNo }]);
  };

  const canConfirm = preview?.eligible === true
    && !submittedDelete && !deletionResult
    && checkedSelection === selectionKey(selectedRecords)
    && reasonCode !== ""
    && (reasonCode !== "other" || reasonNote.trim().length > 0)
    && confirmationRecordNo.normalize("NFKC").trim().toUpperCase() === record.recordNo
    && !busy;

  const executeAttempt = async (input: RecordDeletionExecuteInput) => {
    if (executingRef.current || deletionResult || resultQueryActive.current || !isCurrentAccount()) return;
    executingRef.current = true;
    setStorageAvailable(rememberDeletionAttempt(accountId, input));
    setSubmittedDelete(input);
    setBusy(true);
    setErrorMessage(null);
    try {
      const result = await executeFormalRecordDeletion(input);
      const cleared = forgetDeletionAttempt(accountId, input.requestId);
      if (!mounted.current || !isCurrentAccount()) return;
      setStorageAvailable(cleared);
      resultQueryRef.current += 1;
      resultQueryActive.current = false;
      setCheckingResult(false);
      setDeletionResult(result);
      // Navigation is not part of the committed deletion. A closed dialog
      // must not pull the user away from their next read-only action.
      if (openRef.current) {
        try { router.push(returnTo); router.refresh(); }
        catch { setNavigationFailed(true); }
      }
    } catch (error) {
      if (!mounted.current || !isCurrentAccount()) return;
      if (error instanceof FormalRecordDeletionApiError
          && error.code === "DELETION_PREVIEW_STALE") {
        setStorageAvailable(forgetDeletionAttempt(accountId, input.requestId));
        resultQueryRef.current += 1;
        resultQueryActive.current = false;
        setCheckingResult(false);
        setSubmittedDelete(null);
        await loadPreview(input.selectedRecords, "关联资料已经变化，系统已重新检查，请再次确认。");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "删除操作未完成");
      }
    } finally {
      executingRef.current = false;
      if (mounted.current && isCurrentAccount()) setBusy(false);
    }
  };

  const checkResult = async () => {
    if (!submittedDelete || deletionResult || resultQueryActive.current) return;
    const query = ++resultQueryRef.current;
    resultQueryActive.current = true;
    setCheckingResult(true);
    setErrorMessage(null);
    try {
      const result = await readFormalRecordDeletionResult(submittedDelete);
      if (query !== resultQueryRef.current || !isCurrentAccount()) return;
      if (result) { setDeletionResult(result); setStorageAvailable(forgetDeletionAttempt(accountId, submittedDelete.requestId)); }
      else setErrorMessage("尚未找到已完成的删除回执，结果仍未确认。可以稍后再次查询，或沿用原请求重试；请勿新建删除请求。");
    } catch (error) {
      if (query === resultQueryRef.current && isCurrentAccount()) setErrorMessage(error instanceof Error ? error.message : "删除结果查询失败，可以重新查询。");
    } finally {
      if (query === resultQueryRef.current) { resultQueryActive.current = false; setCheckingResult(false); }
    }
  };

  const confirm = async () => {
    if (!preview || !canConfirm || executingRef.current || !reasonCode) return;
    const requestId = requestIdRef.current ?? `delete-${crypto.randomUUID()}`;
    requestIdRef.current = requestId;
    await executeAttempt({ root, selectedRecords: structuredClone(selectedRecords), reasonCode, reasonNote: reasonCode === "other" ? reasonNote.trim() : null, confirmationRecordNo, previewFingerprint: preview.previewFingerprint, requestId });
  };

  return (
    <>
      <button
        type="button"
        onClick={openPreview}
        className={className ?? "inline-flex min-h-10 items-center gap-2 rounded-xl border border-state-danger-border bg-card px-4 text-sm font-semibold text-state-danger-text transition hover:bg-state-danger-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-danger-border"}
      >
        <Trash2 size={16} aria-hidden />
        <span>{deletionResult ? "查看删除结果" : submittedDelete ? "查看删除进度" : "删除"}</span>
      </button>

      {!open && (submittedDelete || deletionResult) ? <p role="status" className="basis-full text-sm text-ink-soft">{deletionResult ? "删除已完成，可查看删除结果并返回列表。" : busy ? "删除请求尚未返回，关闭窗口没有取消这次删除。" : "删除结果尚待确认，请查看删除进度并沿用原请求重试。"}</p> : null}

      <Dialog
        open={open}
        title={title}
        onClose={close}
        returnFocusElement={returnFocusElement}
        dataTestId="record-delete-dialog"
        className="w-[min(680px,calc(100vw-2rem))]"
      >
        <div className="space-y-5 p-4 sm:p-6">
          {!storageAvailable ? <div role="alert" className="text-sm text-state-warning-text"><p>删除进度暂存或清理失败。当前详情仍保留结果；刷新前请记下请求编号并核对，公共恢复入口可能不完整。</p><button type="button" className="min-h-11 underline" onClick={() => setStorageAvailable(submittedDelete && !deletionResult ? rememberDeletionAttempt(accountId, submittedDelete) : forgetDeletionAttempt(accountId, deletionResult?.requestId ?? requestIdRef.current ?? ""))}>重试本机暂存处理</button></div> : submittedDelete ? <p className="text-xs text-ink-soft">原请求在当前标签页为本账号暂存24小时，刷新后可从页面顶部“删除进度”继续查询。</p> : null}
          {deletionResult ? <section className="space-y-4">
            <h3 className="text-base font-bold text-state-success-text">删除已完成</h3>
            <p className="break-all font-mono text-sm">{deletionResult.root.recordNo}</p>
            <p className="text-sm text-ink-soft">已删除 {deletionResult.deletedRecords.length} 条主记录。{deletionResult.fileCleanupPending > 0 ? `另有 ${deletionResult.fileCleanupPending} 项附件清理在后台处理。` : ""}</p>
            {navigationFailed ? <p role="alert" className="text-sm text-ink-soft">页面未能自动跳转，删除已经完成。请使用下面的入口返回列表。</p> : null}
            <a href={returnTo} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold">返回列表</a>
          </section> : submittedDelete ? <section className="space-y-4">
            <h3 className="text-base font-bold">{busy ? "正在处理删除" : "核对这次删除的结果"}</h3>
            <p role="status" className="text-sm text-ink-soft">{busy ? "删除请求尚未返回。可以先返回记录，关闭窗口不会取消删除，请勿另开请求重复删除。" : "服务器可能已经完成删除。重试将沿用同一请求和原删除范围，服务器会返回已完成的结果，或继续处理这次删除。"}</p>
            <ul className="space-y-1 break-all font-mono text-sm">{submittedDelete.selectedRecords.map((item) => <li key={recordKey(item)}>{item.recordNo}</li>)}</ul>
            <p className="break-all text-xs text-ink-soft">请求编号：{submittedDelete.requestId}</p>
            {errorMessage ? <p role="alert" className="text-sm text-state-danger-text">{errorMessage}</p> : null}
            <div className="flex flex-wrap gap-2"><button type="button" onClick={close} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold">返回记录</button><button type="button" disabled={checkingResult} onClick={() => void checkResult()} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold disabled:opacity-50">{checkingResult ? "正在查询结果…" : "只查询删除结果"}</button>{!busy ? <button type="button" disabled={checkingResult} onClick={() => void executeAttempt(submittedDelete)} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold disabled:opacity-50">重试同一次删除</button> : null}</div>
          </section> : <>
          <div className="flex gap-3 rounded-xl border border-state-warning-border bg-state-warning-subtle p-4 text-state-warning-text">
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
            <p role="alert" className="rounded-xl border border-state-danger-border bg-state-danger-subtle px-4 py-3 text-sm font-semibold text-state-danger-text">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void loadPreview(selectedRecords)} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold disabled:opacity-50">
              {busy ? "正在检查关联…" : "重新检查关联"}
            </button>
            {!preview?.eligible ? <button type="button" onClick={close} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold">返回记录</button> : null}
            {preview?.eligible && checkedSelection !== selectionKey(selectedRecords) && !busy ? <p role="status" className="text-xs text-ink-soft">请重新检查当前范围，再确认删除。</p> : null}
          </div>

          {preview ? (
            <>
              <section aria-label="删除范围" className="rounded-xl border border-line p-4">
                <h3 className="text-sm font-bold text-ink">本次删除范围</h3>
                <p className="mt-2 rounded-lg bg-layer-2 px-3 py-2 font-mono text-sm font-semibold text-ink">
                  {record.recordNo}
                </p>
                {preview.selectableLinkedRecords.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-ink-soft">关联主记录需要逐项勾选，然后重新检查。</p>
                    {preview.selectableLinkedRecords.map((linked) => (
                      <label key={recordKey(linked)} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={selectedRecords.some((item) => recordKey(item) === recordKey(linked))}
                          onChange={() => toggleLinkedRecord(linked)}
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                        />
                        <span className="font-mono font-semibold">{linked.recordNo}</span>
                      </label>
                    ))}
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
                <section className="rounded-xl border border-state-danger-border bg-state-danger-subtle p-4">
                  <h3 className="text-sm font-bold text-state-danger-text">当前记录无法删除</h3>
                  <ul className="mt-2 space-y-2 text-sm text-state-danger-text">
                    {preview.blockers.map((blocker) => (
                      <li key={`${blocker.code}:${blocker.linkedRecord?.recordNo ?? "root"}`}>
                        {blocker.label}{blocker.linkedRecord ? ` · ${blocker.linkedRecord.recordNo}` : ""}
                      </li>
                    ))}
                  </ul>
                  {onReviewBlockers ? <button type="button" disabled={busy} onClick={() => { close(); onReviewBlockers(preview); }} className="mt-3 min-h-11 rounded-lg border border-line bg-card px-4 text-sm font-semibold text-ink disabled:opacity-50">查看相关记录</button> : null}
                </section>
              )}
            </>
          ) : null}
          </>}
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
        <div className="rounded-xl bg-layer-2 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">随主记录删除</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {dependentEntries.map(([name, count]) => (
              <span key={name} className="rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold">
                {dependentLabels[name] ?? name} {count}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {preview.releasedIdentityKinds.length > 0 ? (
        <p className="text-xs text-ink-soft">
          删除后将释放：{preview.releasedIdentityKinds.map((kind) => identityLabels[kind]).join("、")}
        </p>
      ) : null}
      <label className="block text-sm font-semibold text-ink">
        删除原因
        <select
          value={reasonCode}
          onChange={(event) => onReasonCode(event.target.value as DeletionReasonCode | "")}
          className="mt-2 min-h-11 w-full rounded-xl border border-line bg-layer-2 px-3 text-ink"
        >
          <option value="">请选择</option>
          {reasonOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {reasonCode === "other" ? (
        <label className="block text-sm font-semibold text-ink">
          原因说明
          <textarea
            value={reasonNote}
            maxLength={1000}
            onChange={(event) => onReasonNote(event.target.value)}
            className="mt-2 min-h-24 w-full rounded-xl border border-line bg-layer-2 p-3 text-ink"
          />
        </label>
      ) : null}
      <label className="block text-sm font-semibold text-ink">
        输入记录编号确认
        <span className="ml-2 font-mono text-xs text-ink-soft">{recordNo}</span>
        <input
          value={confirmationRecordNo}
          onChange={(event) => onConfirmationRecordNo(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 min-h-11 w-full rounded-xl border border-line bg-layer-2 px-3 font-mono text-ink"
        />
      </label>
      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl border border-line px-5 text-sm font-semibold disabled:opacity-50">取消</button>
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

function selectionKey(records: RecordLocator[]): string {
  return records.map(recordKey).sort().join("|");
}
