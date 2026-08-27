"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { aiTranslateRepair } from "@/lib/ai/auto-repair";
import type {
  UpdateSharedQuickOrderChargeLineInput,
  UpdateSharedQuickOrderChargesInput,
} from "@/lib/api/mock-quick-orders";
import { discountApprovalRequirement, type SignatureStrokePoint } from "@/lib/billing/discount-approval";
import { calculateQuotedChargeTotals } from "@/lib/billing/quoted-charges";
import { loadChargeUnits } from "@/lib/billing/unit-dictionary";
import {
  isSharedChargeQuickOrder,
  type QuickOrder,
  type QuickOrderChargeLine,
} from "@/lib/orders/quick-order-types";
import { formatJMDFull } from "@/lib/utils";

const SignaturePad = dynamic(
  () => import("@/components/ui/signature-pad").then((module) => module.SignaturePad),
  { ssr: false },
);

type DraftLine = UpdateSharedQuickOrderChargeLineInput & { readonly key: string };
type UnitDraft = Extract<DraftLine, { pricingMode: "unit" }>;
type FixedDraft = Extract<DraftLine, { pricingMode: "fixed_total" }>;
type NumericField = "quantity" | "unitPriceJmd" | "unitDiscountJmd" | "amountJmd";

interface SaveIntent {
  readonly mutationId: string;
  readonly expectedEditCount: number;
  readonly lines: ReadonlyArray<UpdateSharedQuickOrderChargeLineInput>;
}

const inputClass = "min-h-9 w-full rounded-md border border-line bg-white px-2 text-xs outline-none focus:border-primary-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

function draftRows(lines: ReadonlyArray<QuickOrderChargeLine>): DraftLine[] {
  return lines.map((line) => ({ ...line, key: line.id }));
}

function newKey(kind: string): string {
  return `new-${kind}-${crypto.randomUUID()}`;
}

function emptyUnit(category: "labor" | "parts"): UnitDraft {
  return {
    key: newKey(category),
    category,
    pricingMode: "unit",
    descZh: "",
    descEn: "",
    remarkZh: "",
    remarkEn: "",
    unit: category === "labor" ? "工时" : "个",
    unitEn: "",
    quantity: 1,
    unitPriceJmd: 0,
    unitDiscountJmd: 0,
    pendingQuote: category === "parts",
  };
}

function emptyFixed(): FixedDraft {
  return {
    key: newKey("fixed"),
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

function numericKey(key: string, field: NumericField): string {
  return `${key}:${field}`;
}

function numericTexts(rows: ReadonlyArray<DraftLine>): Record<string, string> {
  return Object.fromEntries(rows.flatMap((row) => row.pricingMode === "fixed_total"
    ? [[numericKey(row.key, "amountJmd"), String(row.amountJmd)]]
    : [
        [numericKey(row.key, "quantity"), String(row.quantity)],
        [numericKey(row.key, "unitPriceJmd"), String(row.unitPriceJmd)],
        [numericKey(row.key, "unitDiscountJmd"), String(row.unitDiscountJmd)],
      ]));
}

function parseInteger(raw: string | undefined, label: string, positive = false): { value?: number; error?: string } {
  if (!raw?.trim()) return { error: `${label}不能为空` };
  if (!/^\d+$/u.test(raw.trim())) return { error: `${label}必须是${positive ? "大于 0 的" : "非负"}整数` };
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || (positive ? value < 1 : value < 0)) {
    return { error: `${label}必须是${positive ? "大于 0 的" : "非负"}安全整数` };
  }
  return { value };
}

function canonicalLines(
  rows: ReadonlyArray<DraftLine>,
  drafts: Readonly<Record<string, string>>,
): { lines: UpdateSharedQuickOrderChargeLineInput[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const lines = rows.map((row): UpdateSharedQuickOrderChargeLineInput => {
    if (row.pricingMode === "fixed_total") {
      const amount = parseInteger(drafts[numericKey(row.key, "amountJmd")], "其他费用");
      if (amount.error) errors[numericKey(row.key, "amountJmd")] = amount.error;
      return {
        ...(row.id ? { id: row.id } : {}),
        category: "other_service",
        pricingMode: "fixed_total",
        code: row.code,
        descZh: row.descZh.trim(),
        descEn: row.descEn.trim(),
        remarkZh: row.remarkZh.trim(),
        remarkEn: row.remarkEn.trim(),
        amountJmd: amount.value ?? 0,
      };
    }
    const quantity = parseInteger(drafts[numericKey(row.key, "quantity")], "数量", true);
    const unitPrice = row.pendingQuote ? { value: 0 } : parseInteger(drafts[numericKey(row.key, "unitPriceJmd")], "单价");
    const unitDiscount = row.pendingQuote ? { value: 0 } : parseInteger(drafts[numericKey(row.key, "unitDiscountJmd")], "每单位优惠");
    if (quantity.error) errors[numericKey(row.key, "quantity")] = quantity.error;
    if (unitPrice.error) errors[numericKey(row.key, "unitPriceJmd")] = unitPrice.error;
    if (unitDiscount.error) errors[numericKey(row.key, "unitDiscountJmd")] = unitDiscount.error;
    if (unitPrice.value !== undefined && unitDiscount.value !== undefined && unitDiscount.value > unitPrice.value) {
      errors[numericKey(row.key, "unitDiscountJmd")] = "每单位优惠不能超过单价";
    }
    return {
      ...(row.id ? { id: row.id } : {}),
      category: row.category,
      pricingMode: "unit",
      descZh: row.descZh.trim(),
      descEn: row.descEn.trim(),
      remarkZh: row.remarkZh.trim(),
      remarkEn: row.remarkEn.trim(),
      unit: row.unit.trim(),
      unitEn: row.unitEn.trim(),
      quantity: quantity.value ?? 0,
      unitPriceJmd: unitPrice.value ?? 0,
      unitDiscountJmd: unitDiscount.value ?? 0,
      pendingQuote: row.pendingQuote,
    };
  });
  return { lines, errors };
}

function linesForFinance(lines: ReadonlyArray<UpdateSharedQuickOrderChargeLineInput>): QuickOrderChargeLine[] {
  return lines.map((line, index) => ({ ...line, id: line.id ?? `preview-${index + 1}` }) as QuickOrderChargeLine);
}

function thresholdMoneyChanged(before: ReadonlyArray<QuickOrderChargeLine>, after: ReadonlyArray<QuickOrderChargeLine>): boolean {
  const previous = calculateQuotedChargeTotals(before);
  const next = calculateQuotedChargeTotals(after);
  return previous.laborGrossJmd !== next.laborGrossJmd
    || previous.laborDiscountJmd !== next.laborDiscountJmd
    || previous.partsGrossJmd !== next.partsGrossJmd
    || previous.partsDiscountJmd !== next.partsDiscountJmd;
}

export function QuickOrderSharedChargeEdit({ order, onSaved }: { order: QuickOrder; onSaved: (updated: QuickOrder) => void }) {
  if (!isSharedChargeQuickOrder(order)) throw new Error("shared charge editor requires a shared Quick Business Order");
  const [rows, setRows] = useState<DraftLine[]>(() => draftRows(order.chargeLines));
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>(() => numericTexts(draftRows(order.chargeLines)));
  const [intent, setIntent] = useState<SaveIntent | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [strokes, setStrokes] = useState<ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>>([]);
  const [busy, setBusy] = useState(false);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setRows(draftRows(order.chargeLines));
    setNumericDrafts(numericTexts(draftRows(order.chargeLines)));
    setIntent(null);
    setSignatureOpen(false);
    setStrokes([]);
    setError(null);
  }, [order.id, order.editHistory.length, order.chargeLines]);

  useEffect(() => {
    if (!signatureOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      setSignatureOpen(false);
      setStrokes([]);
      saveButtonRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, signatureOpen]);

  const patch = (key: string, values: Partial<DraftLine>) => {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...values } as DraftLine : row));
    setIntent(null);
    setSignatureOpen(false);
    setStrokes([]);
    setError(null);
  };
  const patchNumeric = (key: string, field: NumericField, value: string) => {
    setNumericDrafts((current) => ({ ...current, [numericKey(key, field)]: value }));
    setIntent(null);
    setSignatureOpen(false);
    setStrokes([]);
    setError(null);
  };
  const remove = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
    setIntent(null);
    setSignatureOpen(false);
    setStrokes([]);
    setError(null);
  };
  const add = (line: DraftLine) => {
    setRows((current) => [...current, line]);
    setNumericDrafts((current) => ({ ...current, ...numericTexts([line]) }));
    setIntent(null);
    setError(null);
  };

  const translate = async (row: DraftLine) => {
    setTranslatingKey(row.key);
    setError(null);
    try {
      const [descEn, remarkEn] = await Promise.all([
        row.descZh.trim() ? aiTranslateRepair(row.descZh.trim()) : Promise.resolve(""),
        row.remarkZh.trim() ? aiTranslateRepair(row.remarkZh.trim()) : Promise.resolve(""),
      ]);
      patch(row.key, { descEn: descEn || row.descEn, remarkEn: remarkEn || row.remarkEn });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "翻译失败");
    } finally {
      setTranslatingKey(null);
    }
  };

  const parsed = useMemo(() => canonicalLines(rows, numericDrafts), [numericDrafts, rows]);
  const normalized = parsed.lines;
  const totals = useMemo(() => {
    try {
      return calculateQuotedChargeTotals(linesForFinance(normalized));
    } catch {
      return null;
    }
  }, [normalized]);

  const validate = (): string | null => {
    const numericError = Object.values(parsed.errors)[0];
    if (numericError) return numericError;
    if (rows.length === 0) return "至少保留一条收费项目";
    for (const row of rows) {
      if (!row.descZh.trim()) return "每条收费项目都要填中文名称";
      if (row.pricingMode === "fixed_total") continue;
      if (!row.unit.trim()) return "工时/配件单位不能为空";
    }
    return null;
  };

  const run = async (saveIntent: SaveIntent, rawStrokes?: ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>) => {
    setBusy(true);
    setError(null);
    try {
      const input: UpdateSharedQuickOrderChargesInput = {
        orderId: order.id,
        expectedEditCount: saveIntent.expectedEditCount,
        mutationId: saveIntent.mutationId,
        lines: saveIntent.lines,
        ...(rawStrokes ? { signature: { rawStrokes } } : {}),
      };
      const updated = await api.quickOrders.updateSharedCharges(input);
      setIntent(null);
      setSignatureOpen(false);
      setStrokes([]);
      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "收费项目保存失败");
    } finally {
      setBusy(false);
    }
  };

  const requestSave = () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    const nextIntent = intent ?? {
      mutationId: crypto.randomUUID(),
      expectedEditCount: order.editHistory.length,
      lines: normalized,
    };
    setIntent(nextIntent);
    const nextLines = linesForFinance(nextIntent.lines);
    if (thresholdMoneyChanged(order.chargeLines, nextLines) && discountApprovalRequirement(nextLines).required) {
      setStrokes([]);
      setSignatureOpen(true);
      return;
    }
    void run(nextIntent);
  };

  const fieldError = (key: string, field: NumericField) => {
    const message = parsed.errors[numericKey(key, field)];
    return message ? <p role="alert" data-testid={`quick-shared-edit-${key}-${field}-error`} className="mt-1 text-[10px] font-semibold text-rose-600">{message}</p> : null;
  };

  const renderUnit = (row: UnitDraft) => (
    <div key={row.key} data-testid={`quick-shared-edit-row-${row.key}`} className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5 rounded-lg border border-line bg-surface/50 p-2 sm:grid-cols-4 lg:grid-cols-[minmax(130px,1.35fr)_minmax(120px,1.2fr)_68px_54px_92px_80px_94px_72px] dark:border-slate-700 dark:bg-slate-900/20">
      <span className="sr-only">{row.descZh} {row.descEn} {row.remarkZh} {row.remarkEn}</span>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">项目名称</span><input aria-label="项目名称" data-testid={`quick-shared-edit-${row.key}-desc`} value={row.descZh} onChange={(event) => patch(row.key, { descZh: event.target.value })} className={inputClass} />{row.descEn ? <span data-testid={`quick-shared-edit-${row.key}-translation`} className="mt-1 block truncate text-[10px] font-medium text-primary" title={row.descEn}>{row.descEn}</span> : null}</label>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">描述</span><input aria-label="描述" value={row.remarkZh} onChange={(event) => patch(row.key, { remarkZh: event.target.value })} className={inputClass} />{row.remarkEn ? <span className="mt-1 block truncate text-[10px] text-primary/80" title={row.remarkEn}>{row.remarkEn}</span> : null}</label>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">单位</span><select aria-label="单位" value={row.unit} onChange={(event) => { const selected = loadChargeUnits().find((unit) => unit.zh === event.target.value); patch(row.key, { unit: event.target.value, ...(selected ? { unitEn: selected.en } : {}) }); }} className={inputClass}>{!loadChargeUnits().some((unit) => unit.zh === row.unit) ? <option value={row.unit}>{row.unit}</option> : null}{loadChargeUnits().map((unit) => <option key={unit.id} value={unit.zh}>{unit.zh}</option>)}</select></label>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">数量</span><input aria-label="数量" data-testid={`quick-shared-edit-${row.key}-quantity`} type="text" inputMode="numeric" value={numericDrafts[numericKey(row.key, "quantity")] ?? ""} onChange={(event) => patchNumeric(row.key, "quantity", event.target.value)} className={inputClass} />{fieldError(row.key, "quantity")}</label>
      <div className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">含税单价</span><input aria-label="含税单价" data-testid={`quick-shared-edit-${row.key}-price`} type="text" inputMode="numeric" disabled={row.pendingQuote} value={numericDrafts[numericKey(row.key, "unitPriceJmd")] ?? ""} onChange={(event) => patchNumeric(row.key, "unitPriceJmd", event.target.value)} className={inputClass} />{fieldError(row.key, "unitPriceJmd")}{row.category === "parts" ? <label className="mt-1 flex items-center gap-1 text-[9px] text-ink-soft"><input type="checkbox" aria-label="待报价" checked={row.pendingQuote} onChange={(event) => {
        patch(row.key, { pendingQuote: event.target.checked, ...(event.target.checked ? { unitPriceJmd: 0, unitDiscountJmd: 0 } : {}) });
        if (event.target.checked) setNumericDrafts((current) => ({ ...current, [numericKey(row.key, "unitPriceJmd")]: "0", [numericKey(row.key, "unitDiscountJmd")]: "0" }));
      }} />待报价</label> : null}</div>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">折扣</span><input aria-label="折扣" data-testid={`quick-shared-edit-${row.key}-discount`} type="text" inputMode="numeric" disabled={row.pendingQuote} value={numericDrafts[numericKey(row.key, "unitDiscountJmd")] ?? ""} onChange={(event) => patchNumeric(row.key, "unitDiscountJmd", event.target.value)} className={inputClass} />{fieldError(row.key, "unitDiscountJmd")}</label>
      <div className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">小计</span><div className="flex min-h-9 items-center rounded-md bg-white px-2 text-xs font-bold tabular-nums dark:bg-slate-800">{row.pendingQuote ? "待报价" : (() => { const quantity = Number(numericDrafts[numericKey(row.key, "quantity")] ?? 0); const price = Number(numericDrafts[numericKey(row.key, "unitPriceJmd")] ?? 0); const discount = Number(numericDrafts[numericKey(row.key, "unitDiscountJmd")] ?? 0); return formatJMDFull(Math.max(0, quantity * (price - discount))); })()}</div></div>
      <div className="flex min-w-0 items-start gap-1">
        <button type="button" aria-label="翻译当前行" disabled={translatingKey === row.key} onClick={() => void translate(row)} className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-primary-200 text-xs font-semibold text-primary hover:bg-primary-50 disabled:opacity-50">{translatingKey === row.key ? "…" : "译"}</button>
        <button type="button" aria-label="删除收费行" data-testid={`quick-shared-edit-${row.key}-delete`} onClick={() => remove(row.key)} className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-rose-100 text-xs font-semibold text-rose-500 hover:bg-rose-50"><Trash2 size={13} /><span className="sr-only">删</span></button>
      </div>
    </div>
  );

  const renderFixed = (row: FixedDraft) => (
    <div key={row.key} data-testid={`quick-shared-edit-row-${row.key}`} className="mt-1.5 grid min-w-0 grid-cols-2 gap-1.5 rounded-lg border border-line bg-surface/50 p-2 sm:grid-cols-4 lg:grid-cols-[minmax(130px,1.35fr)_minmax(120px,1.2fr)_68px_54px_92px_80px_94px_72px] dark:border-slate-700 dark:bg-slate-900/20">
      <span className="sr-only">{row.descZh} {row.descEn} {row.remarkZh} {row.remarkEn}</span>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">项目名称</span><input aria-label="项目名称" data-testid={`quick-shared-edit-${row.key}-desc`} value={row.descZh} onChange={(event) => patch(row.key, { descZh: event.target.value })} className={inputClass} />{row.descEn ? <span data-testid={`quick-shared-edit-${row.key}-translation`} className="mt-1 block truncate text-[10px] font-medium text-primary" title={row.descEn}>{row.descEn}</span> : null}</label>
      <label className="min-w-0"><span className="mb-1 block text-[10px] font-semibold text-ink-soft lg:sr-only">描述</span><input aria-label="描述" value={row.remarkZh} onChange={(event) => patch(row.key, { remarkZh: event.target.value })} className={inputClass} />{row.remarkEn ? <span className="mt-1 block truncate text-[10px] text-primary/80" title={row.remarkEn}>{row.remarkEn}</span> : null}</label>
      <select aria-label="单位" value={row.code} onChange={(event) => patch(row.key, { code: event.target.value as FixedDraft["code"] })} className={inputClass}><option value="towing">拖车</option><option value="offsite_service">外出</option><option value="other">固定费</option></select>
      <div className="flex min-h-9 items-center rounded-md bg-white px-2 text-xs dark:bg-slate-800">1</div>
      <label className="min-w-0"><input aria-label="含税单价" data-testid={`quick-shared-edit-${row.key}-amount`} type="text" inputMode="numeric" value={numericDrafts[numericKey(row.key, "amountJmd")] ?? ""} onChange={(event) => patchNumeric(row.key, "amountJmd", event.target.value)} className={inputClass} />{fieldError(row.key, "amountJmd")}</label>
      <div className="flex min-h-9 items-center rounded-md bg-white px-2 text-xs dark:bg-slate-800">0</div>
      <div className="flex min-h-9 items-center rounded-md bg-white px-2 text-xs font-bold tabular-nums dark:bg-slate-800">{formatJMDFull(Number(numericDrafts[numericKey(row.key, "amountJmd")] ?? 0))}</div>
      <div className="flex min-w-0 items-start gap-1"><button type="button" aria-label="翻译当前行" disabled={translatingKey === row.key} onClick={() => void translate(row)} className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-primary-200 text-xs font-semibold text-primary hover:bg-primary-50 disabled:opacity-50">{translatingKey === row.key ? "…" : "译"}</button><button type="button" aria-label="删除收费行" data-testid={`quick-shared-edit-${row.key}-delete`} onClick={() => remove(row.key)} className="inline-flex h-9 flex-1 items-center justify-center rounded-md border border-rose-100 text-xs font-semibold text-rose-500 hover:bg-rose-50"><Trash2 size={13} /><span className="sr-only">删</span></button></div>
    </div>
  );

  return (
    <div data-testid="quick-shared-charge-editor" className="space-y-3">
      {(["labor", "parts"] as const).map((category) => (
        <section key={category} data-testid={`quick-shared-edit-group-${category}`}>
          <div className="flex items-center justify-between"><p className="text-xs font-bold">{category === "labor" ? "工时" : "配件"}</p><button type="button" onClick={() => add(emptyUnit(category))} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-line px-2 text-xs"><Plus size={13} />新增</button></div>
          <div className="mt-2 hidden grid-cols-[minmax(130px,1.35fr)_minmax(120px,1.2fr)_68px_54px_92px_80px_94px_72px] gap-1.5 px-2 text-[10px] font-semibold text-ink-soft lg:grid"><span>项目名称</span><span>描述</span><span>单位</span><span>数量</span><span>含税单价</span><span>折扣</span><span>小计</span><span>译 / 删</span></div>
          <div className="min-w-0">{rows.filter((row): row is UnitDraft => row.pricingMode === "unit" && row.category === category).map(renderUnit)}</div>
        </section>
      ))}
      <section data-testid="quick-shared-edit-group-other_service">
        <div className="flex items-center justify-between"><p className="text-xs font-bold">其他费用</p><button type="button" onClick={() => add(emptyFixed())} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-line px-2 text-xs"><Plus size={13} />新增</button></div>
        <div className="mt-2 hidden grid-cols-[minmax(130px,1.35fr)_minmax(120px,1.2fr)_68px_54px_92px_80px_94px_72px] gap-1.5 px-2 text-[10px] font-semibold text-ink-soft lg:grid"><span>项目名称</span><span>描述</span><span>单位</span><span>数量</span><span>含税单价</span><span>折扣</span><span>小计</span><span>译 / 删</span></div>
        <div className="min-w-0">{rows.filter((row): row is FixedDraft => row.pricingMode === "fixed_total").map(renderFixed)}</div>
      </section>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs">
        <span>{totals ? `收费合计 ${formatJMDFull(totals.grandTotalJmd)}` : "请检查收费数值"}</span>
        {totals?.totalDiscountJmd ? <span>行优惠 {formatJMDFull(totals.totalDiscountJmd)}</span> : null}
        {error ? <span role="alert" data-testid="quick-shared-edit-error" className="font-semibold text-rose-600">{error}</span> : null}
        <button ref={saveButtonRef} type="button" data-testid="quick-shared-save" disabled={busy} onClick={requestSave} className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-4 font-semibold text-white disabled:opacity-50"><Save size={14} />{busy ? "保存中…" : "保存收费项目"}</button>
      </div>

      {signatureOpen && intent ? (
        <div data-testid="quick-shared-signature-dialog" role="dialog" aria-modal="true" aria-label="业务单收费修改高优惠签字" className="fixed inset-0 z-[65] w-screen overflow-y-auto bg-black/45 p-0 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:p-5">
          <div className="min-h-full w-full bg-white p-4 shadow-xl dark:bg-slate-800 sm:min-h-0 sm:max-w-lg sm:rounded-2xl">
            <h4 className="text-base font-bold">业务单收费修改高优惠签字</h4>
            <p className="mt-1 text-xs text-ink-soft">修改后仍严格超过工时 20% 或配件 12.5%，本次写入需要新的原始笔迹。</p>
            <div className="mt-4"><SignaturePad label="操作账号本人签字" testId="quick-shared-discount-signature" onChange={(_signed, _dataUrl, rawStrokes) => setStrokes(rawStrokes)} /></div>
            {error ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => { setSignatureOpen(false); setStrokes([]); saveButtonRef.current?.focus(); }} className="min-h-10 rounded-lg border border-line px-4 text-xs font-semibold">取消</button><button type="button" data-testid="quick-shared-signature-confirm" disabled={busy || strokes.length === 0} onClick={() => void run(intent, strokes)} className="min-h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">{busy ? "写入中…" : "签字并保存"}</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
