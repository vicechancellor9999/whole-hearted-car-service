"use client";

import { useState } from "react";
import { Plus, Save, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { parseQuickOrderInput } from "@/lib/orders/nl-parse";
import { aiParseQuickOrder, aiTranslateRepair } from "@/lib/ai/auto-repair";
import { cn, formatJMDFull } from "@/lib/utils";
import { quickOrderTotals, type QuickItemCategory, type QuickOrder } from "@/lib/orders/quick-order-types";
import { QuoteImportDialog } from "./quote-import-dialog";
import { loadChargeUnits } from "@/lib/billing/unit-dictionary";

interface DraftRow {
  id: string;
  descZh: string;
  descEn: string;
  category: QuickItemCategory;
  unit: string;
  unitPriceJmd: number;
  quantity: number;
  pendingQuote: boolean;
  remarkZh: string;
  remarkEn: string;
  unitEn: string;
}

/**
 * 收费项目内联编辑（8/18 老板：直接改，不点按钮开弹窗）。
 * 已交单（跨月锁单）时只读——由调用方决定挂只读视图。
 */
export function QuickOrderItemsInlineEdit({ order, onSaved }: {
  order: QuickOrder;
  onSaved: (updated: QuickOrder) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>(order.items.map((item) => ({ ...item, remarkZh: item.remarkZh ?? "", remarkEn: item.remarkEn ?? "", unitEn: item.unitEn ?? "" })));
  const [noteZh, setNoteZh] = useState(order.noteZh ?? "");
  const [noteEn, setNoteEn] = useState(order.noteEn ?? "");
  const [laborDiscount, setLaborDiscount] = useState(order.laborDiscountJmd ?? 0);
  const [partsDiscount, setPartsDiscount] = useState(order.partsDiscountJmd ?? 0);
  const [nl, setNl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [translatingAll, setTranslatingAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const inputClass = "min-h-10 w-full rounded-lg border border-line bg-white px-2.5 text-[13px] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";
  const totals = quickOrderTotals({ items: rows });
  const chargeUnits = loadChargeUnits();
  const patch = (id: string, value: Partial<DraftRow>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...value } : row)));
  const remove = (id: string) => setRows((current) => current.filter((row) => row.id !== id));
  const add = (category: QuickItemCategory) => setRows((current) => [...current, {
    id: `new-${Date.now()}-${current.length}`,
    descZh: "", descEn: "", category, unit: category === "labor" ? "工时" : "个", unitPriceJmd: 0, quantity: 1, pendingQuote: category === "parts", remarkZh: "", remarkEn: "", unitEn: "",
  }]);

  const appendParsed = async () => {
    if (!nl.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const ai = await aiParseQuickOrder(nl);
      const list = (ai && ai.length > 0 ? ai : parseQuickOrderInput(nl)) as ReadonlyArray<{ descZh: string; descEn: string; category: QuickItemCategory; unit?: string; unitPriceJmd: number; quantity: number; pendingQuote: boolean; remarkZh?: string; remarkEn?: string; unitEn?: string }>;
      if (list.length === 0) { setError("没识别出收费项目，换行逐条写"); return; }
      setRows((current) => [...current, ...list.map((item, index) => ({
        id: `new-${Date.now()}-${index}`,
        descZh: item.descZh,
        descEn: item.descEn,
        category: item.category,
        unit: item.unit ?? (item.category === "labor" ? "工时" : "个"),
        unitPriceJmd: item.unitPriceJmd,
        quantity: item.quantity,
        pendingQuote: item.pendingQuote,
        remarkZh: item.remarkZh ?? "",
        remarkEn: item.remarkEn ?? "",
        unitEn: item.unitEn ?? "",
      }))]);
      setNl("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "解析失败");
    } finally {
      setParsing(false);
    }
  };

  // 全部翻译：整单所有项目（名称+备注）与整单备注一键翻英文（8/18 老板：不能只翻译项目，全都要翻译）
  const translateAll = async () => {
    setTranslatingAll(true);
    try {
      if (noteZh.trim()) {
        const en = await aiTranslateRepair(noteZh);
        if (en) setNoteEn(en);
      }
      for (const row of rows) {
        if (row.descZh.trim()) {
          const en = await aiTranslateRepair(row.descZh);
          if (en) patch(row.id, { descEn: en });
        }
        if (row.remarkZh.trim()) {
          const ren = await aiTranslateRepair(row.remarkZh);
          if (ren) patch(row.id, { remarkEn: ren });
        }
        const uen = await aiTranslateRepair(row.unit.trim() || (row.category === "labor" ? "工时" : "个"));
        if (uen) patch(row.id, { unitEn: uen });
      }
    } finally {
      setTranslatingAll(false);
    }
  };

  const save = async () => {
    if (rows.some((row) => !row.descZh.trim() || !row.descEn.trim())) { setError("每行中文描述和英文翻译都要填"); return; }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.quickOrders.update(order.id, {
        rawInput: order.rawInput,
        noteZh: noteZh.trim() || undefined,
        noteEn: noteEn.trim() || undefined,
        laborDiscountJmd: laborDiscount || undefined,
        partsDiscountJmd: partsDiscount || undefined,
        items: rows.map((row) => ({
          descZh: row.descZh.trim(),
          descEn: row.descEn.trim(),
          category: row.category,
          unit: row.unit.trim() || (row.category === "labor" ? "工时" : "个"),
          unitEn: row.unitEn.trim() || undefined,
          unitPriceJmd: row.unitPriceJmd,
          quantity: row.quantity,
          pendingQuote: row.pendingQuote,
          remarkZh: row.remarkZh.trim() || undefined,
          remarkEn: row.remarkEn.trim() || undefined,
        })),
      });
      onSaved(updated);
      setBusy(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      setBusy(false);
    }
  };

  return (
    <div data-testid="quick-inline-editor" className="space-y-3">
      <div className="rounded-xl border border-line bg-surface-warm/60 p-3 dark:border-slate-600 dark:bg-slate-700/40">
        <label className="text-[13px] font-semibold text-ink dark:text-slate-200">自然语言追加收费项目（可选）
          <div className="mt-1 flex gap-2">
            <input value={nl} onChange={(e) => setNl(e.target.value)} placeholder="例如：更换水泵 工时25,000"
              data-testid="quick-inline-nl" className={inputClass} />
            <button type="button" data-testid="quick-inline-parse" disabled={parsing || !nl.trim()} onClick={() => void appendParsed()}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white disabled:opacity-50">
              <Wand2 size={13} /> {parsing ? "解析中…" : "AI 拆单追加"}
            </button>
            <button type="button" data-testid="quick-inline-import-quote" onClick={() => setShowImport(true)}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-violet-300 px-3 text-[13px] font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-500/40 dark:text-violet-300 dark:hover:bg-violet-500/10">
              从报价单导入
            </button>
          </div>
        </label>
      </div>
      {showImport && <QuoteImportDialog vehicleId={order.vehicleId} onClose={() => setShowImport(false)} onImport={(items) => {
        // 报价项目照搬进收费项草稿（2026-08-20 老板：报价→勾选→带进工单）
        setRows((current) => [...current, ...items.map((item, index) => {
          const category: QuickItemCategory = item.category === "parts" ? "parts" : "labor";
          return {
            id: "new-" + Date.now() + "-" + index,
            descZh: item.descZh,
            descEn: item.descEn,
            category,
            unit: item.unit,
            unitPriceJmd: item.unitPriceJmd,
            quantity: item.quantity,
            pendingQuote: item.pendingQuote,
            remarkZh: item.remarkZh ?? "",
            remarkEn: item.remarkEn ?? "",
            unitEn: item.unitEn ?? "",
          };
        })]);
        setShowImport(false);
      }} />}


      {(["labor", "parts"] as const).map((category) => {
        const categoryRows = rows.filter((row) => row.category === category);
        return (
          <div key={category}>
            <div className="mb-1 flex items-center justify-between">
              <p className={cn("text-[13px] font-bold", category === "labor" ? "text-primary" : "text-amber-600")}>
                {category === "labor" ? "工时项目" : "配件项目"}
              </p>
              <button type="button" data-testid={`quick-inline-add-${category}`} onClick={() => add(category)}
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300">
                <Plus size={12} /> {category === "labor" ? "添加工时项目" : "添加配件项目"}
              </button>
            </div>
            <div className="overflow-hidden">
              <div className="min-w-0 space-y-1.5">
                {categoryRows.map((row) => (
                  <div key={row.id} data-testid={`quick-inline-row-${row.id}`} className="rounded-xl border border-line bg-white p-1.5 dark:border-slate-600 dark:bg-slate-700/30">
                  <div className="grid grid-cols-[minmax(210px,1.6fr)_minmax(130px,1fr)_72px_72px_130px_140px_40px_40px_40px] items-center gap-1.5">
                    <input value={row.descZh} onChange={(e) => patch(row.id, { descZh: e.target.value })} placeholder="中文项目名称"
                      onBlur={() => { void (async () => { if (row.descZh.trim() && !row.descEn.trim()) { const en = await aiTranslateRepair(row.descZh); if (en) patch(row.id, { descEn: en }); } })(); }}
                      data-testid={`quick-inline-${row.id}-zh`} className={inputClass} />
                    <input value={row.remarkZh} onChange={(e) => patch(row.id, { remarkZh: e.target.value })} placeholder="项目备注（选填）"
                      onBlur={() => { void (async () => { if (row.remarkZh.trim() && !row.remarkEn.trim()) { const en = await aiTranslateRepair(row.remarkZh); if (en) patch(row.id, { remarkEn: en }); } })(); }}
                      data-testid={`quick-inline-${row.id}-remark`} className={inputClass} />
                    <select value={row.unit} onChange={(e) => { const selected = chargeUnits.find((unit) => unit.zh === e.target.value); patch(row.id, { unit: e.target.value, ...(selected ? { unitEn: selected.en } : {}) }); }}
                      data-testid={`quick-inline-${row.id}-unit`} className={inputClass} aria-label="单位">
                      {!chargeUnits.some((unit) => unit.zh === row.unit) ? <option value={row.unit}>{row.unit}</option> : null}
                      {chargeUnits.map((unit) => <option key={unit.id} value={unit.zh}>{unit.zh}</option>)}
                    </select>
                    <input type="number" min={1} value={row.quantity} onChange={(e) => patch(row.id, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      data-testid={`quick-inline-${row.id}-qty`} className={inputClass} aria-label="数量" />
                    <input type="number" min={0} value={row.unitPriceJmd} onChange={(e) => patch(row.id, { unitPriceJmd: Math.max(0, parseInt(e.target.value, 10) || 0), pendingQuote: false })}
                      data-testid={`quick-inline-${row.id}-price`} className={inputClass} aria-label="单价" />
                    <span className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-ink dark:text-slate-100" data-testid={`quick-inline-${row.id}-amount`}>
                      {row.pendingQuote ? "待报价" : formatJMDFull(row.unitPriceJmd * row.quantity)}
                    </span>
                    <label title="待报价" className="flex items-center justify-center">
                      <input type="checkbox" checked={row.pendingQuote} onChange={(e) => patch(row.id, { pendingQuote: e.target.checked })}
                        data-testid={`quick-inline-${row.id}-pending`} className="h-4 w-4" />
                    </label>
                    <button type="button" title="AI 翻译（牙买加汽修术语）" data-testid={"quick-inline-" + row.id + "-translate"}
                      onClick={() => { void (async () => { const en = await aiTranslateRepair(row.descZh); if (en) patch(row.id, { descEn: en }); if (row.remarkZh.trim()) { const ren = await aiTranslateRepair(row.remarkZh); if (ren) patch(row.id, { remarkEn: ren }); } const uen = await aiTranslateRepair(row.unit.trim() || (row.category === "labor" ? "工时" : "个")); if (uen) patch(row.id, { unitEn: uen }); })(); }}
                      className="inline-flex h-10 w-9 items-center justify-center rounded-lg border border-line text-[13px] font-semibold text-primary hover:border-primary-300 dark:border-slate-600">
                      译
                    </button>
                    <button type="button" data-testid={"quick-inline-" + row.id + "-remove"} onClick={() => remove(row.id)} title="删除该行"
                      className="inline-flex h-10 w-9 items-center justify-center rounded-lg border border-line text-rose-500 hover:bg-rose-50 dark:border-slate-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-1 grid grid-cols-[minmax(210px,1.6fr)_minmax(130px,1fr)_72px_72px_130px_140px_40px_40px_40px] gap-1.5 border-t border-dashed border-line px-1 pt-1 dark:border-slate-600" data-testid={`quick-inline-${row.id}-translations`}>
                  <input value={row.descEn} onChange={(e) => patch(row.id, { descEn: e.target.value })} placeholder="英文翻译（可改）"
                    data-testid={`quick-inline-${row.id}-en`}
                    className="w-full border-0 bg-transparent px-1 text-[11px] italic text-ink-soft outline-none placeholder:text-ink-faint dark:text-slate-400 dark:placeholder:text-slate-500" />
                  <input value={row.remarkEn} onChange={(e) => patch(row.id, { remarkEn: e.target.value })} placeholder="备注英文翻译（可改）"
                    data-testid={`quick-inline-${row.id}-remark-en`}
                    className="w-full border-0 bg-transparent px-1 text-[11px] italic text-ink-soft outline-none placeholder:text-ink-faint dark:text-slate-400 dark:placeholder:text-slate-500" />
                  <input value={row.unitEn} onChange={(e) => patch(row.id, { unitEn: e.target.value })} placeholder="单位英文（可改）"
                    data-testid={`quick-inline-${row.id}-unit-en`}
                    className="w-full border-0 bg-transparent px-1 text-[11px] italic text-ink-soft outline-none placeholder:text-ink-faint dark:text-slate-400 dark:placeholder:text-slate-500" />
                  <div className="col-span-6" />
                </div></div>
                ))}
                {categoryRows.length === 0 && <p className="py-1 text-[11px] text-ink-faint">该类别暂无项目，点上方按钮添加。</p>}
              </div>
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-2 border-t border-line pt-3 dark:border-slate-600">
        <label className="text-[13px] font-semibold text-rose-600">整单工时优惠（JMD）
          <input type="number" min={0} value={laborDiscount} onChange={(e) => setLaborDiscount(Math.max(0, parseInt(e.target.value, 10) || 0))}
            data-testid="quick-inline-labor-discount" className={cn(inputClass, "mt-1")} />
        </label>
        <label className="text-[13px] font-semibold text-rose-600">整单配件优惠（JMD）
          <input type="number" min={0} value={partsDiscount} onChange={(e) => setPartsDiscount(Math.max(0, parseInt(e.target.value, 10) || 0))}
            data-testid="quick-inline-parts-discount" className={cn(inputClass, "mt-1")} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[13px] font-semibold text-ink dark:text-slate-200">中文备注
          <input value={noteZh} onChange={(e) => setNoteZh(e.target.value)} data-testid="quick-inline-note-zh" className={cn(inputClass, "mt-1")} />
        </label>
        <label className="text-[13px] font-semibold text-ink dark:text-slate-200">English note（客户联）
          <button type="button" data-testid="quick-inline-note-translate" onClick={() => void aiTranslateRepair(noteZh).then((en) => { if (en) setNoteEn(en); })}
            disabled={!noteZh.trim()}
            className="ml-2 rounded border border-line px-2 py-0.5 text-[11px] font-semibold text-primary hover:border-primary-300 disabled:opacity-50 dark:border-slate-600">
            AI 翻译
          </button>
          <input value={noteEn} onChange={(e) => setNoteEn(e.target.value)} data-testid="quick-inline-note-en" className={cn(inputClass, "mt-1")} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="quick-inline-summary">
        <div className="rounded-lg bg-surface-warm/70 p-2.5 dark:bg-slate-700/40">
          <p className="text-[11px] text-ink-soft dark:text-slate-400">工时合计</p>
          <p data-testid="quick-inline-labor-total" className="mt-0.5 text-base font-bold tabular-nums text-ink dark:text-slate-100">{formatJMDFull(totals.laborJmd)}</p>
        </div>
        <div className="rounded-lg bg-rose-50/70 p-2.5 dark:bg-rose-500/10">
          <p className="text-[11px] text-rose-500">工时优惠</p>
          <p data-testid="quick-inline-labor-discount-summary" className="mt-0.5 text-base font-bold tabular-nums text-rose-600">−{formatJMDFull(laborDiscount)}</p>
        </div>
        <div className="rounded-lg bg-surface-warm/70 p-2.5 dark:bg-slate-700/40">
          <p className="text-[11px] text-ink-soft dark:text-slate-400">配件合计</p>
          <p data-testid="quick-inline-parts-total" className="mt-0.5 text-base font-bold tabular-nums text-ink dark:text-slate-100">{formatJMDFull(totals.partsJmd)}</p>
        </div>
        <div className="rounded-lg bg-rose-50/70 p-2.5 dark:bg-rose-500/10">
          <p className="text-[11px] text-rose-500">配件优惠</p>
          <p data-testid="quick-inline-parts-discount-summary" className="mt-0.5 text-base font-bold tabular-nums text-rose-600">−{formatJMDFull(partsDiscount)}</p>
        </div>
        <div className="col-span-2 rounded-lg bg-blue-50/80 p-2.5 dark:bg-blue-500/10 sm:col-span-1">
          <p className="text-[11px] text-blue-600">总计（含 15% GCT）</p>
          <p data-testid="quick-inline-grand-total" className="mt-0.5 text-base font-bold tabular-nums text-blue-700">{formatJMDFull(Math.max(0, totals.totalJmd - laborDiscount - partsDiscount))}</p>
        </div>
      </div>

      {error && <p role="alert" data-testid="quick-inline-error" className="text-[13px] font-semibold text-rose-600">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" data-testid="quick-inline-translate-all" disabled={translatingAll} onClick={() => void translateAll()}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-primary-300 px-4 text-sm font-semibold text-primary hover:bg-primary-50 disabled:opacity-50 dark:border-slate-600">
          {translatingAll ? "全部翻译中…" : "全部翻译（AI）"}
        </button>
        <button type="button" data-testid="quick-inline-save" disabled={busy} onClick={() => void save()}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
          <Save size={14} /> {busy ? "保存中…" : "保存修改"}
        </button>
      </div>
    </div>
  );
}
