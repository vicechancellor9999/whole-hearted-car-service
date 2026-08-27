"use client";

import dynamic from "next/dynamic";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, Wand2 } from "lucide-react";
import { api, ApiError } from "@/lib/api/client";
import type { InspectionReportDetailResponse, UpdateQuotationLineInput } from "@/lib/api/mock-inspection-reports";
import {
  allocateOrderDiscount,
  calculateQuotedChargeTotals,
  type FixedTotalChargeLine,
  type QuotedChargeLine,
  type UnitPricedChargeLine,
} from "@/lib/billing/quoted-charges";
import { discountApprovalRequirement, type SignatureStrokePoint } from "@/lib/billing/discount-approval";
import { aiTranslateRepair } from "@/lib/ai/auto-repair";
import { cn, formatJMDFull } from "@/lib/utils";
import { loadChargeUnits } from "@/lib/billing/unit-dictionary";

const SignaturePad = dynamic(
  () => import("@/components/ui/signature-pad").then((module) => module.SignaturePad),
  { ssr: false },
);

type UnitCategory = "labor" | "parts";
type FixedCode = FixedTotalChargeLine["code"];

interface DraftUnitRow extends Omit<UnitPricedChargeLine, "id" | "sourceId"> {
  readonly key: string;
  readonly id?: string;
  readonly sourceId?: string;
}

interface DraftFixedRow extends Omit<FixedTotalChargeLine, "id" | "sourceId"> {
  readonly key: string;
  readonly id?: string;
  readonly sourceId?: string;
}

type DraftRow = DraftUnitRow | DraftFixedRow;
type NumericField = "quantity" | "unitPriceJmd" | "unitDiscountJmd" | "amountJmd";

interface SaveIntent {
  readonly key: string;
  readonly mutationId: string;
  readonly lines: ReadonlyArray<UpdateQuotationLineInput>;
  readonly noteZh: string;
  readonly noteEn: string;
}

interface CreateBoIntent {
  readonly key: string;
  readonly mutationId: string;
  readonly expectedRevision: number;
  readonly selectedLineIds: ReadonlyArray<string>;
  readonly selectedLines: ReadonlyArray<QuotedChargeLine>;
  readonly quotationMutationId?: string;
}

interface QuotationCommitResult {
  readonly revision: number;
  readonly contentRevision: number;
  readonly lineIds: ReadonlyArray<string>;
  readonly selectedLineIds: ReadonlyArray<string>;
  readonly selectedLines: ReadonlyArray<QuotedChargeLine>;
  readonly mutationId: string;
}

export interface QuotationGenerationPreparation {
  readonly revision: number;
  readonly contentRevision: number;
}

export interface QuotationPanelHandle {
  prepareForFormalFileGeneration(): Promise<QuotationGenerationPreparation | null>;
}

interface QuotationPanelProps {
  detail: InspectionReportDetailResponse;
  onUpdated: (next: InspectionReportDetailResponse) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const inputClass = "min-h-9 w-full rounded-md border border-line bg-white px-2.5 text-xs outline-none transition-colors focus:border-primary-300 focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const unitGridClass = "grid min-w-0 grid-cols-2 items-start gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(120px,1.1fr)_minmax(130px,1.2fr)_100px_85px_85px_95px_90px_85px_36px]";
const fixedGridClass = "grid min-w-0 grid-cols-2 items-start gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(140px,1.2fr)_minmax(150px,1.3fr)_120px_105px_70px_36px]";

function clientKey(prefix: string, sequence: number): string {
  return `${prefix}-${sequence}`;
}

function numericDraftKey(rowKey: string, field: NumericField): string {
  return `${rowKey}:${field}`;
}

function strictIntegerText(raw: string, minimum: 0 | 1, label: string): { value?: number; error?: string } {
  if (!/^\d+$/u.test(raw)) return { error: `${label}必须填写完整整数` };
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { error: `${label}超出安全整数范围` };
  if (value < minimum) return { error: `${label}必须${minimum === 1 ? "大于 0" : "为非负整数"}` };
  return { value };
}

function rowsFromDetail(lines: InspectionReportDetailResponse["quotation"]["lines"]): DraftRow[] {
  return lines.map((line, index) => ({ ...line, key: line.id || clientKey("loaded", index + 1) }));
}

function emptyUnitRow(key: string, category: UnitCategory): DraftUnitRow {
  return {
    key,
    category,
    pricingMode: "unit",
    descZh: "",
    descEn: "",
    remarkZh: "",
    remarkEn: "",
    unit: category === "labor" ? "工时" : "个",
    unitEn: category === "labor" ? "hours" : "pcs",
    quantity: 1,
    unitPriceJmd: 0,
    unitDiscountJmd: 0,
    pendingQuote: category === "parts",
  };
}

function emptyFixedRow(key: string): DraftFixedRow {
  return {
    key,
    category: "other_service",
    pricingMode: "fixed_total",
    code: "other",
    descZh: "",
    descEn: "",
    remarkZh: "",
    remarkEn: "",
    amountJmd: 0,
  };
}

function updateLine(row: DraftRow): UpdateQuotationLineInput {
  if (row.pricingMode === "fixed_total") {
    return {
      ...(row.id ? { id: row.id } : {}),
      category: "other_service",
      pricingMode: "fixed_total",
      code: row.code,
      descZh: row.descZh.trim(),
      descEn: row.descEn.trim(),
      remarkZh: row.remarkZh.trim(),
      remarkEn: row.remarkEn.trim(),
      amountJmd: row.amountJmd,
    };
  }
  return {
    ...(row.id ? { id: row.id } : {}),
    category: row.category,
    pricingMode: "unit",
    descZh: row.descZh.trim(),
    descEn: row.descEn.trim(),
    remarkZh: row.remarkZh.trim(),
    remarkEn: row.remarkEn.trim(),
    unit: row.unit.trim() || (row.category === "labor" ? "工时" : "个"),
    unitEn: row.unitEn.trim(),
    quantity: row.quantity,
    unitPriceJmd: row.unitPriceJmd,
    unitDiscountJmd: row.unitDiscountJmd,
    pendingQuote: row.pendingQuote,
  };
}

function calculationLines(rows: ReadonlyArray<DraftRow>): QuotedChargeLine[] {
  return rows.map((row) => {
    const line = updateLine(row);
    return { ...line, id: row.id ?? row.key, descZh: line.descZh || "待填写" } as QuotedChargeLine;
  });
}

function relevantDiscountMoneyChanged(previous: ReadonlyArray<QuotedChargeLine>, next: ReadonlyArray<QuotedChargeLine>): boolean {
  const before = calculateQuotedChargeTotals(previous);
  const after = calculateQuotedChargeTotals(next);
  return before.laborGrossJmd !== after.laborGrossJmd
    || before.laborDiscountJmd !== after.laborDiscountJmd
    || before.partsGrossJmd !== after.partsGrossJmd
    || before.partsDiscountJmd !== after.partsDiscountJmd;
}

function newMutationId(prefix = "quotation"): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function quotationContentKey(
  lines: ReadonlyArray<UpdateQuotationLineInput>,
  noteZh: string,
  noteEn: string,
): string {
  return JSON.stringify({ lines, noteZh: noteZh.trim(), noteEn: noteEn.trim() });
}

function saveIntentKey(
  revision: number,
  lines: ReadonlyArray<UpdateQuotationLineInput>,
  noteZh: string,
  noteEn: string,
): string {
  return JSON.stringify({ revision, lines, noteZh: noteZh.trim(), noteEn: noteEn.trim() });
}

function isGlobalRevisionConflict(error: unknown): error is ApiError {
  return error instanceof ApiError
    && error.status === 409
    && /版本已变化|revision/iu.test(error.message);
}

function savedQuotationContentKey(detail: InspectionReportDetailResponse): string {
  return quotationContentKey(
    rowsFromDetail(detail.quotation.lines).map(updateLine),
    detail.quotation.noteZh,
    detail.quotation.noteEn,
  );
}

export const QuotationPanel = forwardRef<QuotationPanelHandle, QuotationPanelProps>(function QuotationPanel({ detail, onUpdated, onDirtyChange }, ref) {
  const router = useRouter();
  const quotation = detail.quotation;
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromDetail(quotation.lines));
  const [noteZh, setNoteZh] = useState(quotation.noteZh);
  const [noteEn, setNoteEn] = useState(quotation.noteEn);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [blankEstablished, setBlankEstablished] = useState(quotation.lines.length > 0);
  const [selectedForBo, setSelectedForBo] = useState<Set<string>>(() => new Set());
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [allocationTarget, setAllocationTarget] = useState("0");
  const [allocationPreview, setAllocationPreview] = useState<ReturnType<typeof allocateOrderDiscount> | null>(null);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [allocationParticipantIds, setAllocationParticipantIds] = useState<Set<string>>(() => new Set());
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const [numericErrors, setNumericErrors] = useState<Record<string, string>>({});
  const [signatureIntent, setSignatureIntent] = useState<SaveIntent | null>(null);
  const [signaturePurpose, setSignaturePurpose] = useState<"save" | "create_bo" | "generate">("save");
  const [signatureStrokes, setSignatureStrokes] = useState<ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>>([]);
  const [boSignatureIntent, setBoSignatureIntent] = useState<CreateBoIntent | null>(null);
  const [boSignatureStrokes, setBoSignatureStrokes] = useState<ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>>([]);
  const [createdBo, setCreatedBo] = useState<{ id: string; businessOrderNo: string } | null>(null);
  const [workingRevision, setWorkingRevision] = useState(detail.revision);
  const [workingContentRevision, setWorkingContentRevision] = useState(quotation.contentRevision);
  const [savedContentKey, setSavedContentKey] = useState(() => savedQuotationContentKey(detail));
  const nextKeyRef = useRef(quotation.lines.length + 1);
  const intentRef = useRef<SaveIntent | null>(null);
  const lastCommitFailureRef = useRef<Error | null>(null);
  const contentConflictRef = useRef(false);
  const boIntentRef = useRef<CreateBoIntent | null>(null);
  const pendingGenerationRef = useRef<{
    resolve: (result: QuotationGenerationPreparation | null) => void;
    reject: (reason: Error) => void;
  } | null>(null);

  useEffect(() => {
    const incomingContentKey = savedQuotationContentKey(detail);
    const localContentKey = quotationContentKey(rows.map(updateLine), noteZh, noteEn);
    setWorkingRevision(detail.revision);
    setWorkingContentRevision(quotation.contentRevision);
    if (incomingContentKey === savedContentKey) return;
    // A successful save updates the local rows before the parent's detail
    // refresh is rendered. Treat that exact server echo as the acknowledgement
    // of this draft, not as an external content conflict.
    if (incomingContentKey === localContentKey) {
      setSavedContentKey(incomingContentKey);
      contentConflictRef.current = false;
      return;
    }
    if (localContentKey !== savedContentKey || Object.keys(numericErrors).length > 0) {
      contentConflictRef.current = true;
      setMessage("Quotation 已被其他窗口修改；本页未保存草稿仍保留，请重新载入后核对，系统不会自动覆盖。");
      return;
    }
    setRows(rowsFromDetail(quotation.lines));
    setNoteZh(quotation.noteZh);
    setNoteEn(quotation.noteEn);
    setBlankEstablished((current) => current || quotation.lines.length > 0);
    setNumericDrafts({});
    setNumericErrors({});
    setSavedContentKey(incomingContentKey);
    contentConflictRef.current = false;
    nextKeyRef.current = quotation.lines.length + 1;
  // Global revision may advance for communications/photos without changing
  // Quotation content. Rebase the submit token without erasing local drafts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.revision]);

  useEffect(() => {
    setSelectedForBo(new Set());
    setCreatedBo(null);
    boIntentRef.current = null;
    setBoSignatureIntent(null);
    setBoSignatureStrokes([]);
  }, [detail.id]);

  useEffect(() => () => {
    pendingGenerationRef.current?.resolve(null);
    pendingGenerationRef.current = null;
  }, []);

  const canonicalLines = useMemo(() => calculationLines(rows), [rows]);
  const quotationDirty = useMemo(
    () => quotationContentKey(rows.map(updateLine), noteZh, noteEn) !== savedContentKey
      || Object.keys(numericErrors).length > 0,
    [noteEn, noteZh, numericErrors, rows, savedContentKey],
  );
  useEffect(() => {
    onDirtyChange?.(quotationDirty);
  }, [onDirtyChange, quotationDirty]);
  const totals = useMemo(() => calculateQuotedChargeTotals(canonicalLines), [canonicalLines]);
  const eligibleAllocationRows = useMemo(
    () => canonicalLines.filter((line): line is UnitPricedChargeLine => line.pricingMode === "unit" && !line.pendingQuote),
    [canonicalLines],
  );

  const invalidateBoIntent = useCallback(() => {
    boIntentRef.current = null;
    setBoSignatureIntent(null);
    setBoSignatureStrokes([]);
  }, []);

  const invalidateIntent = useCallback(() => {
    intentRef.current = null;
    invalidateBoIntent();
  }, [invalidateBoIntent]);

  const patchRow = useCallback((key: string, patch: Partial<DraftRow>) => {
    invalidateIntent();
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } as DraftRow : row));
  }, [invalidateIntent]);

  const changeNumeric = useCallback((row: DraftRow, field: NumericField, raw: string) => {
    const key = numericDraftKey(row.key, field);
    setNumericDrafts((current) => ({ ...current, [key]: raw }));
    const minimum = field === "quantity" ? 1 : 0;
    const label = field === "quantity"
      ? "数量"
      : field === "unitPriceJmd"
        ? "单价"
        : field === "unitDiscountJmd"
          ? "每单位优惠"
          : "固定总额";
    const parsed = strictIntegerText(raw, minimum, label);
    let error = parsed.error;
    if (parsed.value !== undefined && row.pricingMode === "unit") {
      if (field === "unitPriceJmd" && parsed.value < row.unitDiscountJmd) error = "单价不能低于每单位优惠";
      if (field === "unitDiscountJmd" && parsed.value > row.unitPriceJmd) error = "每单位优惠不能超过单价";
    }
    setNumericErrors((current) => {
      const next = { ...current };
      if (error) next[key] = error;
      else delete next[key];
      return next;
    });
    if (error || parsed.value === undefined) return;
    if (row.pricingMode === "fixed_total" && field === "amountJmd") {
      patchRow(row.key, { amountJmd: parsed.value });
      return;
    }
    if (row.pricingMode !== "unit") return;
    if (field === "quantity") patchRow(row.key, { quantity: parsed.value });
    if (field === "unitPriceJmd") patchRow(row.key, { unitPriceJmd: parsed.value, pendingQuote: false });
    if (field === "unitDiscountJmd") patchRow(row.key, { unitDiscountJmd: parsed.value });
  }, [patchRow]);

  const clearNumericFields = useCallback((rowKey: string, fields: ReadonlyArray<NumericField>) => {
    setNumericDrafts((current) => {
      const next = { ...current };
      for (const field of fields) delete next[numericDraftKey(rowKey, field)];
      return next;
    });
    setNumericErrors((current) => {
      const next = { ...current };
      for (const field of fields) delete next[numericDraftKey(rowKey, field)];
      return next;
    });
  }, []);

  const removeRow = useCallback((key: string) => {
    invalidateIntent();
    clearNumericFields(key, ["quantity", "unitPriceJmd", "unitDiscountJmd", "amountJmd"]);
    setRows((current) => current.filter((row) => row.key !== key));
    setSelectedForBo((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, [clearNumericFields, invalidateIntent]);

  const addUnitRow = useCallback((category: UnitCategory) => {
    const key = clientKey("new-unit", nextKeyRef.current++);
    invalidateIntent();
    setRows((current) => [...current, emptyUnitRow(key, category)]);
  }, [invalidateIntent]);

  const addFixedRow = useCallback(() => {
    const key = clientKey("new-other", nextKeyRef.current++);
    invalidateIntent();
    setRows((current) => [...current, emptyFixedRow(key)]);
  }, [invalidateIntent]);

  const toggleBo = useCallback((key: string, checked: boolean) => {
    invalidateBoIntent();
    setSelectedForBo((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, [invalidateBoIntent]);

  const translateRow = useCallback(async (row: DraftRow) => {
    const [descEn, remarkEn, unitEn] = await Promise.all([
      row.descZh.trim() ? aiTranslateRepair(row.descZh) : Promise.resolve(null),
      row.remarkZh.trim() ? aiTranslateRepair(row.remarkZh) : Promise.resolve(null),
      row.pricingMode === "unit" ? aiTranslateRepair(row.unit) : Promise.resolve(null),
    ]);
    patchRow(row.key, {
      ...(descEn ? { descEn } : {}),
      ...(remarkEn ? { remarkEn } : {}),
      ...(unitEn && row.pricingMode === "unit" ? { unitEn } : {}),
    });
  }, [patchRow]);

  const currentIntent = useCallback((): SaveIntent | null => {
    if (contentConflictRef.current) {
      setMessage("Quotation 已被其他窗口修改；重新载入并核对后才能保存。");
      return null;
    }
    const numericError = Object.values(numericErrors)[0];
    if (numericError) {
      setMessage(numericError + "，修正后再保存");
      return null;
    }
    if (rows.some((row) => !row.descZh.trim())) {
      setMessage("每条报价项目名称不能为空");
      return null;
    }
    const lines = rows.map(updateLine);
    const key = saveIntentKey(workingRevision, lines, noteZh, noteEn);
    if (intentRef.current?.key === key) return intentRef.current;
    const intent = { key, mutationId: newMutationId(), lines, noteZh: noteZh.trim(), noteEn: noteEn.trim() };
    intentRef.current = intent;
    return intent;
  }, [noteEn, noteZh, numericErrors, rows, workingRevision]);

  const commitIntent = useCallback(async (
    intent: SaveIntent,
    rawStrokes?: ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>,
  ): Promise<QuotationCommitResult | null> => {
    setBusy(true);
    setMessage(null);
    lastCommitFailureRef.current = null;
    contentConflictRef.current = false;
    try {
      let attemptIntent = intent;
      let attemptRevision = workingRevision;
      let result: Awaited<ReturnType<typeof api.inspectionReports.updateQuotation>>;
      try {
        result = await api.inspectionReports.updateQuotation({
          reportId: detail.id,
          expectedRevision: attemptRevision,
          mutationId: attemptIntent.mutationId,
          lines: attemptIntent.lines,
          noteZh: attemptIntent.noteZh,
          noteEn: attemptIntent.noteEn,
          ...(rawStrokes ? { signature: { rawStrokes } } : {}),
        });
      } catch (caught) {
        if (!isGlobalRevisionConflict(caught)) throw caught;
        const latest = await api.inspectionReports.detail(detail.id);
        if (latest.quotation.contentRevision !== workingContentRevision) {
          const conflict = new ApiError(
            "Quotation 已被其他窗口修改，请核对；本页草稿、选择与未消费签名均未覆盖。",
            409,
          );
          contentConflictRef.current = true;
          throw conflict;
        }
        attemptRevision = latest.revision;
        attemptIntent = {
          ...intent,
          key: saveIntentKey(latest.revision, intent.lines, intent.noteZh, intent.noteEn),
        };
        setWorkingRevision(latest.revision);
        intentRef.current = attemptIntent;
        if (rawStrokes) setSignatureIntent(attemptIntent);
        result = await api.inspectionReports.updateQuotation({
          reportId: detail.id,
          expectedRevision: attemptRevision,
          mutationId: attemptIntent.mutationId,
          lines: attemptIntent.lines,
          noteZh: attemptIntent.noteZh,
          noteEn: attemptIntent.noteEn,
          ...(rawStrokes ? { signature: { rawStrokes } } : {}),
        });
      }
      const selectedIndexes = rows.flatMap((row, index) => selectedForBo.has(row.id ?? row.key) ? [index] : []);
      const selectedLineIds = selectedIndexes.flatMap((index) => result.lineIds[index] ? [result.lineIds[index]] : []);
      const selectedLines = selectedIndexes.flatMap((index) => {
        const line = canonicalLines[index];
        const id = result.lineIds[index];
        return line && id ? [{ ...line, id } as QuotedChargeLine] : [];
      });
      setRows((current) => current.map((row, index) => ({ ...row, id: result.lineIds[index] ?? row.id, key: result.lineIds[index] ?? row.key })));
      setSelectedForBo(new Set(selectedLineIds));
      setWorkingRevision(result.revision);
      setWorkingContentRevision(result.contentRevision);
      const savedLines = attemptIntent.lines.map((line, index) => ({ ...line, id: result.lineIds[index] ?? line.id }));
      setSavedContentKey(quotationContentKey(savedLines, attemptIntent.noteZh, attemptIntent.noteEn));
      intentRef.current = null;
      setSignatureIntent(null);
      setSignatureStrokes([]);
      setBlankEstablished(true);
      return {
        revision: result.revision,
        contentRevision: result.contentRevision,
        lineIds: result.lineIds,
        selectedLineIds,
        selectedLines,
        mutationId: attemptIntent.mutationId,
      };
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error("保存报价失败");
      lastCommitFailureRef.current = error;
      const failure = error.message;
      if (!rawStrokes && /签字|signature/iu.test(failure)) setSignatureIntent(intent);
      setMessage(failure);
      return null;
    } finally {
      setBusy(false);
    }
  }, [canonicalLines, detail.id, rows, selectedForBo, workingContentRevision, workingRevision]);

  const loadUpdatedDetail = useCallback(async (): Promise<InspectionReportDetailResponse | null> => {
    try {
      const next = await api.inspectionReports.detail(detail.id);
      onUpdated(next);
      return next;
    } catch {
      return null;
    }
  }, [detail.id, onUpdated]);

  const refreshDetail = useCallback(async (): Promise<boolean> => Boolean(await loadUpdatedDetail()), [loadUpdatedDetail]);

  const finishGenerationPreparation = useCallback((result: QuotationGenerationPreparation | null) => {
    const pending = pendingGenerationRef.current;
    pendingGenerationRef.current = null;
    pending?.resolve(result);
  }, []);

  const prepareForFormalFileGeneration = useCallback(async (): Promise<QuotationGenerationPreparation | null> => {
    const intent = currentIntent();
    if (!intent) return null;
    const currentKey = quotationContentKey(intent.lines, intent.noteZh, intent.noteEn);
    if (currentKey === savedContentKey) {
      return { revision: workingRevision, contentRevision: workingContentRevision };
    }

    const requirement = discountApprovalRequirement(canonicalLines);
    if (relevantDiscountMoneyChanged(quotation.lines, canonicalLines) && requirement.required) {
      pendingGenerationRef.current?.resolve(null);
      setSignaturePurpose("generate");
      setSignatureStrokes([]);
      setSignatureIntent(intent);
      setMessage("生成正式文件前需要签字并保存当前高优惠 Quotation");
      return new Promise((resolve, reject) => {
        pendingGenerationRef.current = { resolve, reject };
      });
    }

    const committed = await commitIntent(intent);
    if (!committed) {
      if (lastCommitFailureRef.current) throw lastCommitFailureRef.current;
      return null;
    }
    await loadUpdatedDetail();
    setMessage("报价已保存，正在生成正式文件");
    return { revision: committed.revision, contentRevision: committed.contentRevision };
  }, [
    canonicalLines,
    commitIntent,
    currentIntent,
    loadUpdatedDetail,
    quotation.lines,
    savedContentKey,
    workingContentRevision,
    workingRevision,
  ]);

  useImperativeHandle(ref, () => ({ prepareForFormalFileGeneration }), [prepareForFormalFileGeneration]);

  const continueCreateBo = useCallback(async (
    plan: Omit<CreateBoIntent, "key" | "mutationId">,
    rawStrokes?: ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>,
  ) => {
    const key = JSON.stringify({
      expectedRevision: plan.expectedRevision,
      selectedLineIds: plan.selectedLineIds,
      selectedLines: plan.selectedLines,
      quotationMutationId: plan.quotationMutationId ?? null,
    });
    const intent = boIntentRef.current?.key === key
      ? boIntentRef.current
      : {
          ...plan,
          key,
          mutationId: newMutationId("inspection-quick-order"),
        };
    boIntentRef.current = intent;
    const requirement = discountApprovalRequirement(intent.selectedLines);
    if (requirement.required && !rawStrokes) {
      setBoSignatureStrokes([]);
      setBoSignatureIntent(intent);
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const order = await api.inspectionReports.createQuickOrder({
        reportId: detail.id,
        expectedRevision: intent.expectedRevision,
        ...(intent.quotationMutationId ? { quotationMutationId: intent.quotationMutationId } : {}),
        quickOrderMutationId: intent.mutationId,
        selectedLineIds: intent.selectedLineIds,
        ...(rawStrokes ? { quickOrderSignature: { rawStrokes } } : {}),
      });
      setWorkingRevision(intent.expectedRevision + 1);
      setCreatedBo({ id: order.id, businessOrderNo: order.businessOrderNo });
      setSelectedForBo(new Set());
      boIntentRef.current = null;
      setBoSignatureIntent(null);
      setBoSignatureStrokes([]);
      const refreshed = await refreshDetail();
      setMessage(refreshed
        ? `已创建业务单 ${order.businessOrderNo}`
        : `已创建业务单 ${order.businessOrderNo}；详情刷新失败，请手动刷新`);
      router.push(`/orders/business/${order.id}`);
    } catch (caught) {
      const failure = caught instanceof Error ? caught.message : "创建业务单失败";
      if (/版本已变化|版本变化|revision/iu.test(failure)) {
        try {
          const selectedCanonicalIds = new Set(rows.flatMap((row) => row.id && selectedForBo.has(row.id) ? [row.id] : []));
          const next = await api.inspectionReports.detail(detail.id);
          const nextIds = new Set(next.quotation.lines.map((line) => line.id));
          setSelectedForBo(new Set([...selectedCanonicalIds].filter((id) => nextIds.has(id))));
          setRows(rowsFromDetail(next.quotation.lines));
          setNoteZh(next.quotation.noteZh);
          setNoteEn(next.quotation.noteEn);
          setNumericDrafts({});
          setNumericErrors({});
          setWorkingRevision(next.revision);
          setWorkingContentRevision(next.quotation.contentRevision);
          setSavedContentKey(savedQuotationContentKey(next));
          contentConflictRef.current = false;
          nextKeyRef.current = next.quotation.lines.length + 1;
          boIntentRef.current = null;
          setBoSignatureIntent(null);
          setBoSignatureStrokes([]);
          onUpdated(next);
          setMessage(`${failure}；已刷新，请核对勾选后重新创建`);
          return;
        } catch {
          setMessage(`${failure}；自动刷新失败，请手动刷新`);
          return;
        }
      }
      if (!rawStrokes && /签字|signature/iu.test(failure)) setBoSignatureIntent(intent);
      setMessage(failure);
    } finally {
      setBusy(false);
    }
  }, [detail.id, onUpdated, refreshDetail, router, rows, selectedForBo]);

  const save = useCallback(async () => {
    const intent = currentIntent();
    if (!intent) return;
    const requirement = discountApprovalRequirement(canonicalLines);
    if (relevantDiscountMoneyChanged(quotation.lines, canonicalLines) && requirement.required) {
      setSignaturePurpose("save");
      setSignatureStrokes([]);
      setSignatureIntent(intent);
      return;
    }
    const committed = await commitIntent(intent);
    if (committed) {
      setMessage(await refreshDetail()
        ? (rows.length === 0 ? "已建立报价（空白项目）" : "报价已保存；总备注已同步")
        : "报价已保存；详情刷新失败，请手动刷新");
    }
  }, [canonicalLines, commitIntent, currentIntent, quotation.lines, refreshDetail, rows.length]);

  const createBusinessOrder = useCallback(async () => {
    const intent = currentIntent();
    if (!intent) return;
    const selectedIndexes = rows.flatMap((row, index) => selectedForBo.has(row.id ?? row.key) ? [index] : []);
    if (selectedIndexes.length === 0) {
      setMessage("至少勾选一条收费项目后再创建业务单");
      return;
    }
    const currentKey = quotationContentKey(intent.lines, intent.noteZh, intent.noteEn);
    if (currentKey !== savedContentKey) {
      const requirement = discountApprovalRequirement(canonicalLines);
      if (relevantDiscountMoneyChanged(quotation.lines, canonicalLines) && requirement.required) {
        setSignaturePurpose("create_bo");
        setSignatureStrokes([]);
        setSignatureIntent(intent);
        return;
      }
      const committed = await commitIntent(intent);
      if (!committed) return;
      await continueCreateBo({
        expectedRevision: committed.revision,
        selectedLineIds: committed.selectedLineIds,
        selectedLines: committed.selectedLines,
        quotationMutationId: committed.mutationId,
      });
      return;
    }
    const selectedLineIds = selectedIndexes.flatMap((index) => rows[index]?.id ? [rows[index].id] : []);
    if (selectedLineIds.length !== selectedIndexes.length) {
      setMessage("所选新收费行需要先保存报价");
      return;
    }
    const selectedLines = selectedIndexes.flatMap((index) => canonicalLines[index] ? [canonicalLines[index]] : []);
    await continueCreateBo({ expectedRevision: workingRevision, selectedLineIds, selectedLines });
  }, [canonicalLines, commitIntent, continueCreateBo, currentIntent, quotation.lines, rows, savedContentKey, selectedForBo, workingRevision]);

  const confirmQuotationSignature = useCallback(async () => {
    if (!signatureIntent) return;
    const purpose = signaturePurpose;
    const committed = await commitIntent(signatureIntent, signatureStrokes);
    if (!committed) {
      if (purpose === "generate" && contentConflictRef.current && lastCommitFailureRef.current) {
        const pending = pendingGenerationRef.current;
        pendingGenerationRef.current = null;
        pending?.reject(lastCommitFailureRef.current);
      }
      return;
    }
    if (purpose === "create_bo") {
      await continueCreateBo({
        expectedRevision: committed.revision,
        selectedLineIds: committed.selectedLineIds,
        selectedLines: committed.selectedLines,
        quotationMutationId: committed.mutationId,
      });
      return;
    }
    if (purpose === "generate") {
      await loadUpdatedDetail();
      setMessage("报价已签字保存，正在生成正式文件");
      finishGenerationPreparation({ revision: committed.revision, contentRevision: committed.contentRevision });
      return;
    }
    setMessage(await refreshDetail()
      ? (rows.length === 0 ? "已建立报价（空白项目）" : "报价已保存；总备注已同步")
      : "报价已保存；详情刷新失败，请手动刷新");
  }, [commitIntent, continueCreateBo, finishGenerationPreparation, loadUpdatedDetail, refreshDetail, rows.length, signatureIntent, signaturePurpose, signatureStrokes]);

  const previewAllocation = useCallback(() => {
    try {
      const parsedTarget = strictIntegerText(allocationTarget, 0, "目标总优惠");
      if (parsedTarget.error || parsedTarget.value === undefined) {
        setAllocationPreview(null);
        setAllocationError(parsedTarget.error ?? "目标总优惠无效");
        return;
      }
      const participantIds = eligibleAllocationRows
        .filter((line) => allocationParticipantIds.has(line.id))
        .map((line) => line.id);
      const preview = allocateOrderDiscount(
        canonicalLines,
        parsedTarget.value,
        participantIds,
      );
      setAllocationPreview(preview);
      setAllocationError(null);
    } catch (caught) {
      setAllocationPreview(null);
      setAllocationError(caught instanceof Error ? caught.message : "优惠均摊预览失败");
    }
  }, [allocationParticipantIds, allocationTarget, canonicalLines, eligibleAllocationRows]);

  const applyAllocation = useCallback(() => {
    if (!allocationPreview) return;
    const discountById = new Map(allocationPreview.proposals.map((proposal) => [proposal.id, proposal.unitDiscountJmd]));
    invalidateIntent();
    setRows((current) => current.map((row) => {
      if (row.pricingMode !== "unit") return row;
      const discount = discountById.get(row.id ?? row.key);
      return discount === undefined ? row : { ...row, unitDiscountJmd: discount };
    }));
    setNumericDrafts((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (discountById.has(row.id ?? row.key)) delete next[numericDraftKey(row.key, "unitDiscountJmd")];
      }
      return next;
    });
    setAllocationOpen(false);
    setAllocationPreview(null);
  }, [allocationPreview, invalidateIntent, rows]);

  const openAllocation = useCallback(() => {
    setAllocationTarget("0");
    setAllocationPreview(null);
    setAllocationError(null);
    setAllocationParticipantIds(new Set(eligibleAllocationRows.map((line) => line.id)));
    setAllocationOpen(true);
  }, [eligibleAllocationRows]);

  const toggleAllocationParticipant = useCallback((id: string, checked: boolean) => {
    setAllocationParticipantIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setAllocationPreview(null);
    setAllocationError(null);
  }, []);

  const renderUnitGroup = (category: UnitCategory, title: string, subtitle: string) => {
    const grouped = rows.filter((row): row is DraftUnitRow => row.pricingMode === "unit" && row.category === category);
    const subtotal = category === "labor" ? totals.laborNetJmd : totals.partsNetJmd;
    return (
      <section data-testid={`quotation-group-${category}`} className="min-w-0 overflow-hidden rounded-xl border border-line bg-white dark:border-slate-600 dark:bg-slate-800/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900/40">
          <div><h4 className="text-sm font-bold text-ink dark:text-slate-100">{title}</h4><p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">{subtitle}</p></div>
          <div className="flex items-center gap-2"><span className="text-xs font-bold tabular-nums">{formatJMDFull(subtotal)}</span><button type="button" data-testid={category === "labor" ? "quotation-add-row" : "quotation-add-parts"} onClick={() => addUnitRow(category)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-[11px] font-semibold text-primary dark:border-slate-600 dark:bg-slate-800"><Plus size={12} /> 添加{title}</button></div>
        </div>
        <div data-testid={`quotation-group-scroll-${category}`} className="max-w-full overflow-hidden">
          <div className="min-w-0 p-2">
            <div className={cn(unitGridClass, "mb-1 rounded-md bg-slate-50 px-2 py-2 text-[10px] font-bold text-ink-faint dark:bg-slate-900/50")}><span>项目名称</span><span>English / translation</span><span>数量 / 单位</span><span className="text-right">单价</span><span className="text-right">每单位优惠</span><span className="text-right">优惠后单价</span><span>待报价 / Business Order</span><span className="text-right">小计</span><span /></div>
            {grouped.length === 0 ? <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-ink-faint">暂无{title}</p> : grouped.map((row) => (
              <div key={row.key} data-testid={`quotation-edit-row-${row.key}`}>
                <div data-testid={`quotation-unit-row-${row.key}`} className={cn(unitGridClass, "border-b border-line/70 px-2 py-2 dark:border-slate-700")}>
                  <div className="space-y-1"><input data-testid={`quotation-${row.key}-desc`} value={row.descZh} onChange={(event) => patchRow(row.key, { descZh: event.target.value })} placeholder="项目名称" className={inputClass} /><input data-testid={`quotation-${row.key}-remark`} value={row.remarkZh} onChange={(event) => patchRow(row.key, { remarkZh: event.target.value })} placeholder="中文备注（选填）" className={inputClass} /></div>
                  <div data-testid={`quotation-translation-${row.key}`} className="space-y-1"><input data-testid={`quotation-${row.key}-desc-en`} value={row.descEn} onChange={(event) => patchRow(row.key, { descEn: event.target.value })} placeholder="English description" className={inputClass} /><input data-testid={`quotation-${row.key}-remark-en`} value={row.remarkEn} onChange={(event) => patchRow(row.key, { remarkEn: event.target.value })} placeholder="English note" className={inputClass} /><button type="button" aria-label="翻译当前行" onClick={() => void translateRow(row)} className="inline-flex min-h-7 items-center gap-1 rounded-md border border-line px-2 text-[10px] font-semibold text-primary"><Wand2 size={11} /> 翻译当前行</button></div>
                  <div className="grid grid-cols-[52px_1fr] gap-1">
                    <input type="text" inputMode="numeric" aria-label="数量" value={numericDrafts[numericDraftKey(row.key, "quantity")] ?? String(row.quantity)} onChange={(event) => changeNumeric(row, "quantity", event.target.value)} className={inputClass} />
                    <select aria-label="单位" value={row.unit} onChange={(event) => { const selected = loadChargeUnits().find((unit) => unit.zh === event.target.value); patchRow(row.key, { unit: event.target.value, ...(selected ? { unitEn: selected.en } : {}) }); }} className={inputClass}>{!loadChargeUnits().some((unit) => unit.zh === row.unit) ? <option value={row.unit}>{row.unit}</option> : null}{loadChargeUnits().map((unit) => <option key={unit.id} value={unit.zh}>{unit.zh}</option>)}</select>
                    {numericErrors[numericDraftKey(row.key, "quantity")] ? <p role="alert" className="col-span-2 text-[10px] text-rose-600">{numericErrors[numericDraftKey(row.key, "quantity")]}</p> : <span />}
                    <input aria-label="单位英文" value={row.unitEn} onChange={(event) => patchRow(row.key, { unitEn: event.target.value })} className={inputClass} />
                  </div>
                  <div><input type="text" inputMode="numeric" aria-label="单价" data-testid={`quotation-${row.key}-unit-price`} value={numericDrafts[numericDraftKey(row.key, "unitPriceJmd")] ?? String(row.unitPriceJmd)} onChange={(event) => changeNumeric(row, "unitPriceJmd", event.target.value)} className={cn(inputClass, "text-right tabular-nums")} />{numericErrors[numericDraftKey(row.key, "unitPriceJmd")] ? <p role="alert" className="mt-1 text-[10px] text-rose-600">{numericErrors[numericDraftKey(row.key, "unitPriceJmd")]}</p> : null}</div>
                  <div><input type="text" inputMode="numeric" data-testid={`quotation-${row.key}-unit-discount`} value={numericDrafts[numericDraftKey(row.key, "unitDiscountJmd")] ?? String(row.unitDiscountJmd)} onChange={(event) => changeNumeric(row, "unitDiscountJmd", event.target.value)} className={cn(inputClass, "text-right tabular-nums")} />{numericErrors[numericDraftKey(row.key, "unitDiscountJmd")] ? <p role="alert" className="mt-1 text-[10px] text-rose-600">{numericErrors[numericDraftKey(row.key, "unitDiscountJmd")]}</p> : null}</div>
                  <span data-testid={`quotation-${row.key}-final-unit`} className="pt-2 text-right text-xs font-bold tabular-nums">{row.pendingQuote ? "—" : formatJMDFull(row.unitPriceJmd - row.unitDiscountJmd)}</span>
                  <div className="space-y-2 pt-1"><label className="flex items-center gap-1 text-[11px]"><input type="checkbox" data-testid={`quotation-${row.key}-pending`} checked={row.pendingQuote} disabled={row.category === "labor"} onChange={(event) => { if (event.target.checked) clearNumericFields(row.key, ["unitPriceJmd", "unitDiscountJmd"]); patchRow(row.key, { pendingQuote: event.target.checked, ...(event.target.checked ? { unitPriceJmd: 0, unitDiscountJmd: 0 } : {}) }); }} />待报价</label><label className="flex items-center gap-1 text-[11px]"><input type="checkbox" data-testid={`quotation-${row.key}-bo`} checked={selectedForBo.has(row.id ?? row.key)} onChange={(event) => toggleBo(row.id ?? row.key, event.target.checked)} />带入 Business Order</label></div>
                  <span className="pt-2 text-right text-xs font-bold tabular-nums">{row.pendingQuote ? "—" : formatJMDFull(row.quantity * (row.unitPriceJmd - row.unitDiscountJmd))}</span>
                  <button type="button" aria-label="删除行" data-testid={`quotation-${row.key}-delete`} onClick={() => removeRow(row.key)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft hover:text-rose-600"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  };

  const renderFixedGroup = () => {
    const grouped = rows.filter((row): row is DraftFixedRow => row.pricingMode === "fixed_total");
    return (
      <section data-testid="quotation-group-other_service" className="min-w-0 overflow-hidden rounded-xl border border-line bg-white dark:border-slate-600 dark:bg-slate-800/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900/40"><div><h4 className="text-sm font-bold">其他费用</h4><p className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">Fixed total</p></div><div className="flex items-center gap-2"><span data-testid="quotation-total-other" className="text-xs font-bold tabular-nums">{formatJMDFull(totals.otherFeeTotalJmd)}</span><button type="button" data-testid="quotation-add-other" onClick={addFixedRow} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-[11px] font-semibold text-primary dark:border-slate-600 dark:bg-slate-800"><Plus size={12} /> 添加其他费用</button></div></div>
        <div data-testid="quotation-group-scroll-other_service" className="max-w-full overflow-hidden">
          <div className="min-w-0 p-2">
            <div className={cn(fixedGridClass, "mb-1 rounded-md bg-slate-50 px-2 py-2 text-[10px] font-bold text-ink-faint dark:bg-slate-900/50")}><span>项目名称</span><span>English / translation</span><span>费用类型</span><span className="text-right">固定总额</span><span>Business Order</span><span /></div>
            {grouped.length === 0 ? <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-ink-faint">暂无其他费用</p> : grouped.map((row) => (
              <div key={row.key} data-testid={`quotation-other-row-${row.key}`} className={cn(fixedGridClass, "border-b border-line/70 px-2 py-2 dark:border-slate-700")}>
                <div className="space-y-1"><input data-testid={`quotation-${row.key}-desc`} value={row.descZh} onChange={(event) => patchRow(row.key, { descZh: event.target.value })} placeholder="项目名称" className={inputClass} /><input data-testid={`quotation-${row.key}-remark`} value={row.remarkZh} onChange={(event) => patchRow(row.key, { remarkZh: event.target.value })} placeholder="中文备注（选填）" className={inputClass} /></div>
                <div data-testid={`quotation-translation-${row.key}`} className="space-y-1"><input data-testid={`quotation-${row.key}-desc-en`} value={row.descEn} onChange={(event) => patchRow(row.key, { descEn: event.target.value })} placeholder="English description" className={inputClass} /><input data-testid={`quotation-${row.key}-remark-en`} value={row.remarkEn} onChange={(event) => patchRow(row.key, { remarkEn: event.target.value })} placeholder="English note" className={inputClass} /><button type="button" aria-label="翻译当前行" onClick={() => void translateRow(row)} className="inline-flex min-h-7 items-center gap-1 rounded-md border border-line px-2 text-[10px] font-semibold text-primary"><Wand2 size={11} /> 翻译当前行</button></div>
                <select data-testid={`quotation-${row.key}-code`} value={row.code} onChange={(event) => patchRow(row.key, { code: event.target.value as FixedCode })} className={inputClass}><option value="towing">拖车</option><option value="offsite_service">外派服务</option><option value="other">其他</option></select>
                <div><input type="text" inputMode="numeric" data-testid={`quotation-${row.key}-amount`} value={numericDrafts[numericDraftKey(row.key, "amountJmd")] ?? String(row.amountJmd)} onChange={(event) => changeNumeric(row, "amountJmd", event.target.value)} className={cn(inputClass, "text-right tabular-nums")} />{numericErrors[numericDraftKey(row.key, "amountJmd")] ? <p role="alert" className="mt-1 text-[10px] text-rose-600">{numericErrors[numericDraftKey(row.key, "amountJmd")]}</p> : null}</div>
                <label className="flex items-center gap-1 pt-2 text-[11px]"><input type="checkbox" data-testid={`quotation-${row.key}-bo`} checked={selectedForBo.has(row.id ?? row.key)} onChange={(event) => toggleBo(row.id ?? row.key, event.target.checked)} />带入 Business Order</label>
                <button type="button" aria-label="删除行" data-testid={`quotation-${row.key}-delete`} onClick={() => removeRow(row.key)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft hover:text-rose-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  };

  return (
    <section data-testid="inspection-quotation" className="max-w-full min-w-0 overflow-hidden rounded-2xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Charge items</p><h3 className="mt-1 text-lg font-bold text-ink dark:text-slate-100">Quotation {quotation.quotationNo}</h3><p className="mt-1 text-[11px] text-ink-soft dark:text-slate-400">工时、配件与固定其他费用持续编辑；优惠按每单位 JMD 录入。</p></div><span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold tabular-nums text-primary dark:bg-primary-500/10">报价合计 {formatJMDFull(totals.grandTotalJmd)}</span></div>
      {!blankEstablished && rows.length === 0 ? <button type="button" data-testid="quotation-create" disabled={busy} onClick={() => void save()} className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-50">{busy ? "建立中…" : "建立报价"}</button> : null}
      <div data-testid="quotation-edit" className="mt-4 min-w-0 space-y-3">{renderUnitGroup("labor", "工时项目", "Labor")}{renderUnitGroup("parts", "配件项目", "Parts")}{renderFixedGroup()}</div>
      <div className="mt-4 grid gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/20 dark:bg-amber-500/5 md:grid-cols-2"><label className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">总备注（中文）<textarea data-testid="quotation-note-zh" value={noteZh} onChange={(event) => { invalidateIntent(); setNoteZh(event.target.value); }} rows={3} className="mt-1 w-full rounded-lg border border-amber-200 bg-white p-2.5 text-xs font-normal leading-5 text-ink outline-none dark:bg-slate-800 dark:text-slate-100" /></label><label className="text-[11px] font-semibold text-amber-800 dark:text-amber-200">Overall note (English)<textarea data-testid="quotation-note-en" value={noteEn} onChange={(event) => { invalidateIntent(); setNoteEn(event.target.value); }} rows={3} className="mt-1 w-full rounded-lg border border-amber-200 bg-white p-2.5 text-xs font-normal leading-5 text-ink outline-none dark:bg-slate-800 dark:text-slate-100" /></label></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4"><div className="rounded-lg bg-surface px-3 py-2"><p className="text-[10px] text-ink-faint">工时净额</p><p className="text-sm font-bold tabular-nums">{formatJMDFull(totals.laborNetJmd)}</p></div><div className="rounded-lg bg-surface px-3 py-2"><p className="text-[10px] text-ink-faint">配件净额</p><p className="text-sm font-bold tabular-nums">{formatJMDFull(totals.partsNetJmd)}{totals.pendingPartsCount ? ` · ${totals.pendingPartsCount} 项待报价` : ""}</p></div><div className="rounded-lg bg-surface px-3 py-2"><p className="text-[10px] text-ink-faint">其他费用</p><p className="text-sm font-bold tabular-nums">{formatJMDFull(totals.otherFeeTotalJmd)}</p></div><div className="rounded-lg bg-primary-50 px-3 py-2"><p className="text-[10px] text-primary/70">合计 / 优惠</p><p className="text-sm font-bold tabular-nums text-primary">{formatJMDFull(totals.grandTotalJmd)} / {formatJMDFull(totals.totalDiscountJmd)}</p></div></div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {message ? <p role="status" className="mr-auto text-xs font-semibold text-primary">{message}</p> : null}
        {createdBo ? <p data-testid="quotation-bo-status" className="mr-auto text-xs font-semibold text-emerald-700">已创建业务单 <Link data-testid="quotation-bo-link" href={`/orders/business/${createdBo.id}`} className="underline underline-offset-2">{createdBo.businessOrderNo}</Link></p> : null}
        <button type="button" data-testid="quotation-create-bo" disabled={busy || selectedForBo.size === 0} onClick={() => void createBusinessOrder()} className="inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? "写入中…" : `创建业务单${selectedForBo.size > 0 ? `（${selectedForBo.size} 项）` : ""}`}</button>
        <button type="button" data-testid="quotation-allocation-open" onClick={openAllocation} className="inline-flex min-h-10 items-center rounded-lg border border-primary-200 px-4 text-xs font-semibold text-primary">优惠均摊</button>
        <button type="button" data-testid="quotation-save" disabled={busy} onClick={() => void save()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-50"><Save size={14} /> {busy ? "保存中…" : "保存报价与总备注"}</button>
      </div>

      {allocationOpen ? (
        <div data-testid="quotation-allocation-dialog" role="dialog" aria-modal="true" aria-label="优惠均摊" className="fixed inset-0 z-50 w-screen overflow-y-auto bg-black/45 p-0 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-5">
          <div className="min-h-full w-full bg-white p-4 dark:bg-slate-800 sm:min-h-0 sm:max-w-xl sm:rounded-2xl">
            <h4 className="text-base font-bold">优惠均摊预览</h4>
            <label className="mt-3 block text-xs font-semibold">目标总优惠（JMD）
              <input data-testid="quotation-allocation-target" type="text" inputMode="numeric" value={allocationTarget} onChange={(event) => {
                const raw = event.target.value;
                setAllocationTarget(raw);
                setAllocationPreview(null);
                setAllocationError(strictIntegerText(raw, 0, "目标总优惠").error ?? null);
              }} className={cn(inputClass, "mt-1")} />
            </label>
            <div className="mt-3 grid grid-cols-1 gap-2">
              {eligibleAllocationRows.map((line) => {
                const proposal = allocationPreview?.proposals.find((item) => item.id === line.id);
                const proposedDiscount = proposal?.unitDiscountJmd ?? line.unitDiscountJmd;
                const finalUnitPrice = proposal?.finalUnitPriceJmd ?? (line.unitPriceJmd - proposedDiscount);
                const finalLine = proposal?.finalLineJmd ?? (line.quantity * finalUnitPrice);
                return (
                  <div key={line.id} data-testid={`quotation-allocation-card-${line.id}`} className="rounded-lg border border-line p-3 text-xs">
                    <label className="flex items-start gap-2 font-semibold"><input type="checkbox" aria-label="参与均摊" checked={allocationParticipantIds.has(line.id)} onChange={(event) => toggleAllocationParticipant(line.id, event.target.checked)} /> <span>{line.descZh}</span></label>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-ink-soft">
                      <span>原价</span><span className="text-right tabular-nums">{line.quantity} × {formatJMDFull(line.unitPriceJmd)}</span>
                      <span>拟优惠</span><span className="text-right tabular-nums">{formatJMDFull(proposedDiscount)} / 单位</span>
                      <span>优惠后单价</span><span className="text-right tabular-nums">{formatJMDFull(finalUnitPrice)}</span>
                      <span>优惠后小计</span><span className="text-right font-semibold tabular-nums">{formatJMDFull(finalLine)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {allocationPreview ? <div className="mt-3 grid grid-cols-1 gap-2 text-xs"><p data-testid="quotation-allocation-target-result">目标：{formatJMDFull(allocationPreview.targetDiscountJmd)}</p><p data-testid="quotation-allocation-applied">实际：{formatJMDFull(allocationPreview.appliedDiscountJmd)}</p><p data-testid="quotation-allocation-remainder">尾差：{formatJMDFull(allocationPreview.unallocatedDiscountJmd)}</p><p data-testid="quotation-allocation-before">应用前总优惠：{formatJMDFull(allocationPreview.wholeOrderDiscountBeforeJmd)}</p><p data-testid="quotation-allocation-after">应用后总优惠：{formatJMDFull(allocationPreview.wholeOrderDiscountAfterJmd)}</p></div> : null}
            {allocationError ? <p role="alert" className="mt-2 text-xs text-rose-600">{allocationError}</p> : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" data-testid="quotation-allocation-cancel" onClick={() => { setAllocationOpen(false); setAllocationPreview(null); }} className="min-h-10 rounded-lg border border-line px-4 text-xs font-semibold">取消</button><button type="button" data-testid="quotation-allocation-preview" onClick={previewAllocation} className="min-h-10 rounded-lg border border-primary-200 px-4 text-xs font-semibold text-primary">预览</button><button type="button" data-testid="quotation-allocation-apply" disabled={!allocationPreview?.applicable || Boolean(allocationError) || Object.keys(numericErrors).length > 0} onClick={applyAllocation} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">应用</button></div>
          </div>
        </div>
      ) : null}

      {signatureIntent ? <div data-testid="quotation-signature-dialog" role="dialog" aria-modal="true" aria-label="高优惠签字" className="fixed inset-0 z-[60] w-screen overflow-y-auto bg-black/45 p-0 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-5"><div className="min-h-full w-full bg-white p-4 shadow-xl dark:bg-slate-800 sm:min-h-0 sm:max-w-lg sm:rounded-2xl"><h4 className="text-base font-bold">Quotation 高优惠操作签字</h4><p className="mt-1 text-xs text-ink-soft">工时优惠严格超过 20% 或配件优惠严格超过 12.5%，本次 Quotation 写入需要保留原始笔迹。</p><div className="mt-4"><SignaturePad label="操作账号本人签字" testId="quotation-discount-signature" onChange={(_signed, _dataUrl, rawStrokes) => setSignatureStrokes(rawStrokes)} /></div><div className="mt-4 flex justify-end gap-2"><button type="button" data-testid="quotation-signature-cancel" disabled={busy} onClick={() => { if (signaturePurpose === "generate") finishGenerationPreparation(null); setSignatureIntent(null); setSignatureStrokes([]); }} className="min-h-10 rounded-lg border border-line px-4 text-xs font-semibold">取消</button><button type="button" data-testid="quotation-signature-confirm" disabled={busy || signatureStrokes.length === 0} onClick={() => void confirmQuotationSignature()} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">{busy ? "写入中…" : "签字并保存"}</button></div></div></div> : null}

      {boSignatureIntent ? <div data-testid="quotation-bo-signature-dialog" role="dialog" aria-modal="true" aria-label="业务单高优惠签字" className="fixed inset-0 z-[61] w-screen overflow-y-auto bg-black/45 p-0 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-5"><div className="min-h-full w-full bg-white p-4 shadow-xl dark:bg-slate-800 sm:min-h-0 sm:max-w-lg sm:rounded-2xl"><h4 className="text-base font-bold">业务单高优惠操作签字</h4><p className="mt-1 text-xs text-ink-soft">这份签字只用于新业务单，不能复用 Quotation 的原始笔迹。</p><div className="mt-4"><SignaturePad label="操作账号本人签字" testId="quotation-bo-discount-signature" onChange={(_signed, _dataUrl, rawStrokes) => setBoSignatureStrokes(rawStrokes)} /></div><div className="mt-4 flex justify-end gap-2"><button type="button" data-testid="quotation-bo-signature-cancel" disabled={busy} onClick={() => { setBoSignatureIntent(null); setBoSignatureStrokes([]); }} className="min-h-10 rounded-lg border border-line px-4 text-xs font-semibold">取消</button><button type="button" data-testid="quotation-bo-signature-confirm" disabled={busy || boSignatureStrokes.length === 0} onClick={() => void continueCreateBo(boSignatureIntent, boSignatureStrokes)} className="min-h-10 rounded-lg bg-emerald-600 px-4 text-xs font-semibold text-white disabled:opacity-40">{busy ? "写入中…" : "签字并创建业务单"}</button></div></div></div> : null}
    </section>
  );
});
