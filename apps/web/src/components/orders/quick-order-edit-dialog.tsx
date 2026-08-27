"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Wand2, X } from "lucide-react";
import { parseQuickOrderInput, type ParsedQuickItem } from "@/lib/orders/nl-parse";
import { aiParseQuickOrder, aiTranslateRepair, type AiParsedQuickItem } from "@/lib/ai/auto-repair";
import { quickOrderTotals, type QuickItemCategory, type QuickOrder } from "@/lib/orders/quick-order-types";
import { cn, formatJMDFull } from "@/lib/utils";

interface DraftItem extends ParsedQuickItem {
  readonly key: number;
}

/**
 * 工单内容编辑（2026-08-18 老板反馈）：收费项目、自然语言原文、备注都可以改。
 * 已交单不能直接改（当月先取消交单）；保存后收费合计/绩效值同步。
 */
export function QuickOrderEditDialog({ order, pending, onCancel, onConfirm }: {
  order: QuickOrder;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: {
    rawInput: string;
    noteZh: string;
    noteEn: string;
    items: Array<Omit<DraftItem, "key">>;
    laborDiscountJmd?: number;
    partsDiscountJmd?: number;
  }) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const keySequence = useRef(1);
  const [rawInput, setRawInput] = useState(order.rawInput);
  const [noteZh, setNoteZh] = useState(order.noteZh ?? "");
  const [noteEn, setNoteEn] = useState(order.noteEn ?? "");
  const [laborDiscount, setLaborDiscount] = useState(order.laborDiscountJmd ?? 0);
  const [partsDiscount, setPartsDiscount] = useState(order.partsDiscountJmd ?? 0);
  const [items, setItems] = useState<DraftItem[]>(
    order.items.map((item) => ({
      key: keySequence.current++,
      descZh: item.descZh,
      descEn: item.descEn,
      category: item.category,
      unitPriceJmd: item.unitPriceJmd,
      quantity: item.quantity,
      pendingQuote: item.pendingQuote,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onCancel]);

  const totals = quickOrderTotals({ items });
  const inputClass = "min-h-9 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";

  const runParse = async () => {
    setParsing(true);
    setError(null);
    const toDraft = (list: ReadonlyArray<AiParsedQuickItem | ParsedQuickItem>): DraftItem[] =>
      list.map((item) => ({
        ...item,
        unit: item.unit ?? (item.category === "labor" ? "工时" : "个"),
        discountJmd: item.discountJmd ?? 0,
        key: keySequence.current++,
      }));
    let draft: DraftItem[] | null = null;
    const ai = await aiParseQuickOrder(rawInput);
    if (ai && ai.length > 0) draft = toDraft(ai);
    if (!draft) {
      const local = parseQuickOrderInput(rawInput);
      if (local.length > 0) draft = toDraft(local);
    }
    if (!draft) { setError("没识别出收费项目，换行逐条写"); setParsing(false); return; }
    setItems(draft);
    setParsing(false);
  };

  const translateLine = async (key: number, descZh: string) => {
    const en = await aiTranslateRepair(descZh);
    if (en) patchItem(key, { descEn: en });
  };

  const patchItem = (key: number, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const submit = () => {
    if (!rawInput.trim()) { setError("自然语言原文不能为空"); return; }
    if (items.length === 0) { setError("至少一条收费项目"); return; }
    if (items.some((item) => !item.descZh.trim() || !item.descEn.trim())) { setError("每行中文描述和英文翻译都要填"); return; }
    onConfirm({
      rawInput: rawInput.trim(),
      noteZh: noteZh.trim(),
      noteEn: noteEn.trim(),
      items: items.map(({ descZh, descEn, category, unitPriceJmd, quantity, pendingQuote, unit }) => ({
        descZh, descEn, category, unitPriceJmd, quantity, pendingQuote, unit,
      })),
      laborDiscountJmd: laborDiscount || undefined,
      partsDiscountJmd: partsDiscount || undefined,
    });
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="编辑工单内容" data-testid="quick-order-edit-dialog"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="my-auto w-full max-w-3xl overflow-hidden rounded-[22px] border border-line bg-white shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between border-b border-line p-4 dark:border-slate-700 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-ink dark:text-slate-100">编辑工单内容</h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">{order.businessOrderNo} · 收费项目、自然语言、备注都可以改；改动会留痕</p>
          </div>
          <button type="button" data-testid="quick-edit-close" onClick={onCancel} aria-label="关闭"
            className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm text-ink-soft hover:text-ink dark:border-slate-600 dark:text-slate-300">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4 sm:p-5">
          <div>
            <label className="text-xs font-semibold text-ink dark:text-slate-200">自然语言原文（可修改后再拆单）</label>
            <textarea value={rawInput} onChange={(e) => setRawInput(e.target.value)} data-testid="quick-edit-raw"
              rows={5} className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            <button type="button" data-testid="quick-edit-parse" onClick={() => void runParse()} disabled={!rawInput.trim() || pending || parsing}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
              <Wand2 size={14} />
              {parsing ? "AI 拆单中…" : "重新 AI 拆单"}
            </button>
          </div>

          <div data-testid="quick-edit-items">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-ink dark:text-slate-200">收费项目（每行都能改）</p>
              <button type="button" data-testid="quick-edit-add-item"
                onClick={() => setItems((current) => [...current, { key: keySequence.current++, descZh: "", descEn: "", category: "labor", unit: "工时", unitPriceJmd: 0, quantity: 1, pendingQuote: false, discountJmd: 0 }])}
                className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300">
                <Plus size={13} /> 加一行
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.key} data-testid={`quick-edit-item-${item.key}`} className="rounded-xl border border-line p-2.5 dark:border-slate-600">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input value={item.descZh} onChange={(e) => patchItem(item.key, { descZh: e.target.value })} placeholder="中文描述"
                      data-testid={`quick-edit-item-${item.key}-zh`} className={inputClass} />
                    <button type="button" aria-label="删除行" onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                      className="inline-flex min-h-9 items-center rounded-lg border border-line px-2.5 text-ink-soft hover:text-rose-600 dark:border-slate-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <input value={item.descEn} onChange={(e) => patchItem(item.key, { descEn: e.target.value })} placeholder="English description"
                      data-testid={`quick-edit-item-${item.key}-en`} className={cn(inputClass, "text-xs")} />
                    <button type="button" data-testid={`quick-edit-item-${item.key}-translate`} onClick={() => void translateLine(item.key, item.descZh)}
                      title="AI 翻译（牙买加汽修术语）"
                      className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-line px-2.5 text-xs font-semibold text-primary hover:border-primary-300 dark:border-slate-600">
                      译
                    </button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-6 gap-2">
                    <select value={item.category} onChange={(e) => patchItem(item.key, { category: e.target.value as QuickItemCategory })}
                      data-testid={`quick-edit-item-${item.key}-category`} className={inputClass}>
                      <option value="labor">工时</option>
                      <option value="parts">配件</option>
                    </select>
                    <input value={item.unit} onChange={(e) => patchItem(item.key, { unit: e.target.value })} placeholder="单位"
                      data-testid={"quick-edit-item-" + item.key + "-unit"} className={inputClass} aria-label="单位" />
                    <input type="number" min={1} value={item.quantity} onChange={(e) => patchItem(item.key, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      data-testid={`quick-edit-item-${item.key}-qty`} className={inputClass} aria-label="数量" />
                    <input type="number" min={0} value={item.unitPriceJmd} onChange={(e) => patchItem(item.key, { unitPriceJmd: Math.max(0, parseInt(e.target.value, 10) || 0), pendingQuote: false })}
                      data-testid={`quick-edit-item-${item.key}-price`} className={inputClass} aria-label="单价" />
                    <label className="flex items-center gap-1.5 text-xs text-ink-soft dark:text-slate-400">
                      <input type="checkbox" checked={item.pendingQuote} onChange={(e) => patchItem(item.key, { pendingQuote: e.target.checked })}
                        data-testid={`quick-edit-item-${item.key}-pending`} />
                      待报价
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1 rounded-xl bg-surface-warm/60 p-3 text-right dark:bg-slate-700/40">
              <p className="text-xs text-ink-soft dark:text-slate-400">工时合计 <b data-testid="quick-edit-labor-total" className="ml-2 text-ink dark:text-slate-100">{formatJMDFull(totals.laborJmd)}</b></p>
              <p className="text-xs text-ink-soft dark:text-slate-400">配件合计 <b data-testid="quick-edit-parts-total" className="ml-2 text-ink dark:text-slate-100">{formatJMDFull(totals.partsJmd)}</b></p>
              <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-rose-600">整单工时优惠（JMD）
                <input type="number" min={0} value={laborDiscount} onChange={(e) => setLaborDiscount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  data-testid="quick-edit-labor-discount" className={inputClass} />
              </label>
              <label className="text-xs font-semibold text-rose-600">整单配件优惠（JMD）
                <input type="number" min={0} value={partsDiscount} onChange={(e) => setPartsDiscount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  data-testid="quick-edit-parts-discount" className={inputClass} />
              </label>
            </div>
              <p className="text-sm font-bold text-ink dark:text-slate-100">总计（含 15% GCT）<span data-testid="quick-edit-grand-total" className="ml-2">{formatJMDFull(Math.max(0, totals.totalJmd - laborDiscount - partsDiscount))}</span></p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">备注（中文留档，选填）</label>
              <textarea value={noteZh} onChange={(e) => setNoteZh(e.target.value)} data-testid="quick-edit-note-zh" rows={2}
                placeholder="需要留档的补充说明" className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">English note（客户联，选填）
                <button type="button" data-testid="quick-edit-note-translate" onClick={() => void aiTranslateRepair(noteZh).then((en) => { if (en) setNoteEn(en); })}
                  disabled={!noteZh.trim()}
                  className="ml-2 rounded border border-line px-2 py-0.5 text-[10px] font-semibold text-primary hover:border-primary-300 disabled:opacity-50 dark:border-slate-600">
                  AI 翻译
                </button>
              </label>
              <textarea value={noteEn} onChange={(e) => setNoteEn(e.target.value)} data-testid="quick-edit-note-en" rows={2}
                placeholder="Note printed on the customer copy" className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            </div>
          </div>

          {error && <p data-testid="quick-edit-error" role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line p-4 dark:border-slate-700 sm:px-5">
          <button type="button" onClick={onCancel} className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink-soft dark:border-slate-600 dark:text-slate-300">取消</button>
          <button type="button" data-testid="quick-edit-save" onClick={submit} disabled={pending}
            className="inline-flex min-h-10 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
            {pending ? "保存中…" : "保存修改"}
          </button>
        </div>
      </div>
    </div>
  );
}
