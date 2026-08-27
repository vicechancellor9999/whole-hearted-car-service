"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Wand2, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { loadWorkspace } from "@/components/customers/detail-shared";
import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import { parseQuickOrderInput, type ParsedQuickItem } from "@/lib/orders/nl-parse";
import { aiParseQuickOrder, aiTranslateRepair, type AiParsedQuickItem } from "@/lib/ai/auto-repair";
import { quickOrderTotals, type QuickItemCategory } from "@/lib/orders/quick-order-types";
import { QuoteImportDialog } from "./quote-import-dialog";
import { cn, formatJMDFull } from "@/lib/utils";
import { loadChargeUnits } from "@/lib/billing/unit-dictionary";

interface DraftItem extends ParsedQuickItem {
  readonly key: number;
}

/**
 * 新建工单（2026-08-18 老板定）：先选车，客户自然带出；
 * 车辆搜索按车牌/车型/车架号/车主，选中后显示车主与 VIN；
 * 大白话可反复输入再拆单；备注中文留档 + 英文客户联。
 */
export function QuickOrderCreateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [noteZh, setNoteZh] = useState("");
  const [noteEn, setNoteEn] = useState("");
  const [laborDiscount, setLaborDiscount] = useState(0);
  const [partsDiscount, setPartsDiscount] = useState(0);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [parsed, setParsed] = useState(false);
  const [pending, setPending] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const keySequence = useRef(1);

  useEffect(() => {
    void loadWorkspace().then(setWorkspace).catch(() => setWorkspace(null));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const activeRelationships = useMemo(
    () => (workspace?.relationships ?? []).filter((rel) => rel.endedAt === null),
    [workspace],
  );
  const vehicleOwner = useMemo(() => {
    if (!vehicleId) return null;
    const rel = activeRelationships.find((r) => r.vehicleId === vehicleId);
    const customerId = rel?.customerId ?? null;
    if (!customerId) return null;
    return workspace?.customers.find((c) => c.id === customerId) ?? null;
  }, [activeRelationships, vehicleId, workspace]);

  const matchedVehicles = useMemo(() => {
    const all = workspace?.vehicles ?? [];
    const query = vehicleQuery.trim().toLowerCase();
    const ownerName = (id: string) => {
      const rel = activeRelationships.find((r) => r.vehicleId === id);
      const customer = workspace?.customers.find((c) => c.id === rel?.customerId);
      return customer ? (customer.nameZh ?? customer.nameEn ?? customer.organizationName ?? "") : "";
    };
    const withOwner = all.map((v) => ({ vehicle: v, owner: ownerName(v.id) }));
    if (!query) return withOwner.slice(0, 10);
    return withOwner.filter(({ vehicle, owner }) =>
      [vehicle.plate, vehicle.makeZh, vehicle.make, vehicle.modelZh, vehicle.model, vehicle.vin, owner]
        .filter(Boolean).join(" ").toLowerCase().includes(query),
    ).slice(0, 10);
  }, [activeRelationships, vehicleQuery, workspace]);

  const selectedVehicle = workspace?.vehicles.find((v) => v.id === vehicleId) ?? null;
  const totals = quickOrderTotals({ items });

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
    const ai = await aiParseQuickOrder(rawInput); // 真模型失败自动回退本地规则
    if (ai && ai.length > 0) draft = toDraft(ai);
    if (!draft) {
      const local = parseQuickOrderInput(rawInput);
      if (local.length > 0) draft = toDraft(local);
    }
    if (!draft) { setError("没识别出收费项目，换行逐条写"); setParsing(false); return; }
    setItems(draft);
    setParsed(true);
    setParsing(false);
  };

  const translateLine = async (key: number, descZh: string) => {
    const en = await aiTranslateRepair(descZh);
    if (en) patchItem(key, { descEn: en });
  };

  const patchItem = (key: number, patch: Partial<DraftItem>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const submit = async () => {
    if (!vehicleId) { setError("先选车辆"); return; }
    if (!vehicleOwner) { setError("该车辆名下没有客户，请先到客户档案登记后再开单"); return; }
    if (items.length === 0) { setError("先解析或直接添加收费项目"); return; }
    if (items.some((item) => !item.descZh.trim() || !item.descEn.trim())) { setError("每行中文描述和英文翻译都要填"); return; }
    setPending(true);
    setError(null);
    try {
      const created = await api.quickOrders.create({
        customerId: vehicleOwner.id,
        vehicleId,
        rawInput,
        noteZh,
        noteEn,
        items: items.map(({ descZh, descEn, category, unitPriceJmd, quantity, pendingQuote, unit, remarkZh, remarkEn }) => ({
          descZh, descEn, category, unitPriceJmd, quantity, pendingQuote, unit, remarkZh, remarkEn,
        })),
        laborDiscountJmd: laborDiscount || undefined,
        partsDiscountJmd: partsDiscount || undefined,
      });
      router.push(`/orders/business/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败，请重试");
      setPending(false);
    }
  };

  const inputClass = "min-h-9 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="新建工单" data-testid="quick-order-create-dialog"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="my-auto w-full max-w-3xl overflow-hidden rounded-[22px] border border-line bg-white shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between border-b border-line p-4 dark:border-slate-700 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-ink dark:text-slate-100">新建工单</h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">先选车（客户自动带出）→ 大白话写项目 → AI 拆单 → 改完确认生成</p>
          </div>
          <button type="button" data-testid="quick-create-close" onClick={onClose} aria-label="关闭"
            className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm text-ink-soft hover:text-ink dark:border-slate-600 dark:text-slate-300">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto p-4 sm:p-5">
          {/* 车辆优先 */}
          <div>
            <label className="text-xs font-semibold text-ink dark:text-slate-200">车辆（先选车，客户自动带出）</label>
            {selectedVehicle ? (
              <div className="mt-1.5 rounded-xl border border-primary-200 bg-primary-50/50 p-3 dark:border-primary-500/40 dark:bg-primary-500/5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span data-testid="quick-create-vehicle" className="text-sm font-bold text-ink dark:text-slate-100">
                      {selectedVehicle.plate} · {selectedVehicle.makeZh ?? selectedVehicle.make} {selectedVehicle.modelZh ?? selectedVehicle.model}
                    </span>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-soft dark:text-slate-400">VIN / 车架号：{selectedVehicle.vin || "未登记"}</p>
                  </div>
                  <button type="button" onClick={() => setVehicleId("")} className="text-xs text-primary hover:underline">换车</button>
                </div>
                <p className="mt-2 text-xs text-ink-soft dark:text-slate-400">
                  客户：<span data-testid="quick-create-customer" className="font-semibold text-ink dark:text-slate-100">
                    {vehicleOwner ? `${vehicleOwner.nameZh ?? vehicleOwner.nameEn ?? vehicleOwner.organizationName}${vehicleOwner.nameEn && vehicleOwner.nameZh && vehicleOwner.nameEn !== vehicleOwner.nameZh ? ` / ${vehicleOwner.nameEn}` : ""} · ${vehicleOwner.phone}` : "该车辆名下没有客户，请先到客户档案登记"}
                  </span>
                </p>
              </div>
            ) : (
              <>
                <input value={vehicleQuery} onChange={(e) => setVehicleQuery(e.target.value)} data-testid="quick-create-vehicle-search"
                  placeholder="搜车牌 / 车型 / 车架号 / 车主" className={cn(inputClass, "mt-1.5")} />
                {matchedVehicles.length > 0 && (
                  <ul className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-line dark:border-slate-600">
                    {matchedVehicles.map(({ vehicle: v, owner }) => (
                      <li key={v.id}>
                        <button type="button" data-testid={`quick-create-vehicle-option-${v.id}`} onClick={() => setVehicleId(v.id)}
                          className="block w-full px-3 py-2 text-left text-xs hover:bg-primary-50 dark:hover:bg-slate-700">
                          <span className="font-semibold text-ink dark:text-slate-100">{v.plate} · {v.makeZh ?? v.make} {v.modelZh ?? v.model}</span>
                          <span className="ml-2 text-ink-soft dark:text-slate-400">{owner || "未挂客户"}</span>
                          <span className="ml-2 font-mono text-[10px] text-ink-faint dark:text-slate-500">VIN {v.vin || "—"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* 大白话输入（可反复输入再拆单） */}
          <div>
            <label className="text-xs font-semibold text-ink dark:text-slate-200">现场描述（大白话，一行一条，可反复输入再拆单）</label>
            <textarea value={rawInput} onChange={(e) => setRawInput(e.target.value)} data-testid="quick-create-raw"
              rows={6} placeholder={"例：\n水泵漏防冻液 需要更换水泵，再加防冻液工时25,000\n更换刹车油 工时10000\n需要清洗剂八瓶 工时免费。"}
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" data-testid="quick-create-parse" onClick={() => void runParse()} disabled={!rawInput.trim() || parsing}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
                <Wand2 size={14} />
                {parsing ? "AI 拆单中…" : "AI 拆单"}
              </button>
              <button type="button" data-testid="quick-create-import-quote" disabled={!vehicleId} onClick={() => setShowImport(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-300 px-4 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-500/40 dark:text-violet-300 dark:hover:bg-violet-500/10">
                从报价单导入
              </button>
            </div>
          </div>

          {/* 拆单结果（可编辑） */}
          {parsed && (
            <div data-testid="quick-create-items">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-ink dark:text-slate-200">收费项目（每行都能改）</p>
                <button type="button" data-testid="quick-create-add-item"
                  onClick={() => setItems((current) => [...current, { key: keySequence.current++, descZh: "", descEn: "", category: "labor", unit: "工时", unitPriceJmd: 0, quantity: 1, pendingQuote: false, discountJmd: 0 }])}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink-soft hover:text-primary dark:border-slate-600 dark:text-slate-300">
                  <Plus size={13} /> 加一行
                </button>
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.key} data-testid={`quick-create-item-${item.key}`} className="rounded-xl border border-line p-2.5 dark:border-slate-600">
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input value={item.descZh} onChange={(e) => patchItem(item.key, { descZh: e.target.value })} placeholder="中文描述"
                        data-testid={`quick-create-item-${item.key}-zh`} className={inputClass} />
                      <button type="button" aria-label="删除行" onClick={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                        className="inline-flex min-h-9 items-center rounded-lg border border-line px-2.5 text-ink-soft hover:text-rose-600 dark:border-slate-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      <input value={item.descEn} onChange={(e) => patchItem(item.key, { descEn: e.target.value })} placeholder="English description"
                        data-testid={`quick-create-item-${item.key}-en`} className={cn(inputClass, "text-xs")} />
                      <button type="button" data-testid={`quick-create-item-${item.key}-translate`} onClick={() => void translateLine(item.key, item.descZh)}
                        title="AI 翻译（牙买加汽修术语）"
                        className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-line px-2.5 text-xs font-semibold text-primary hover:border-primary-300 dark:border-slate-600">
                        译
                      </button>
                    </div>
                    <div className="mt-1.5 grid grid-cols-6 gap-2">
                      <select value={item.category} onChange={(e) => patchItem(item.key, { category: e.target.value as QuickItemCategory })}
                        data-testid={`quick-create-item-${item.key}-category`} className={inputClass}>
                        <option value="labor">工时</option>
                        <option value="parts">配件</option>
                      </select>
                      <select value={item.unit} onChange={(e) => { const selected = loadChargeUnits().find((unit) => unit.zh === e.target.value); patchItem(item.key, { unit: e.target.value, ...(selected ? { unitEn: selected.en } : {}) }); }}
                        data-testid={"quick-create-item-" + item.key + "-unit"} className={inputClass} aria-label="单位">
                        {!loadChargeUnits().some((unit) => unit.zh === item.unit) ? <option value={item.unit}>{item.unit}</option> : null}
                        {loadChargeUnits().map((unit) => <option key={unit.id} value={unit.zh}>{unit.zh}</option>)}
                      </select>
                      <input type="number" min={1} value={item.quantity} onChange={(e) => patchItem(item.key, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                        data-testid={`quick-create-item-${item.key}-qty`} className={inputClass} aria-label="数量" />
                      <input type="number" min={0} value={item.unitPriceJmd} onChange={(e) => patchItem(item.key, { unitPriceJmd: Math.max(0, parseInt(e.target.value, 10) || 0), pendingQuote: false })}
                        data-testid={`quick-create-item-${item.key}-price`} className={inputClass} aria-label="单价" />
                      <label className="flex items-center gap-1.5 text-xs text-ink-soft dark:text-slate-400">
                        <input type="checkbox" checked={item.pendingQuote} onChange={(e) => patchItem(item.key, { pendingQuote: e.target.checked })}
                          data-testid={`quick-create-item-${item.key}-pending`} />
                        待报价
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 rounded-xl bg-surface-warm/60 p-3 text-right dark:bg-slate-700/40">
                <p className="text-xs text-ink-soft dark:text-slate-400">工时合计 <b data-testid="quick-create-labor-total" className="ml-2 text-ink dark:text-slate-100">{formatJMDFull(totals.laborJmd)}</b></p>
                <p className="text-xs text-ink-soft dark:text-slate-400">配件合计 <b data-testid="quick-create-parts-total" className="ml-2 text-ink dark:text-slate-100">{formatJMDFull(totals.partsJmd)}</b></p>
                 <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs font-semibold text-rose-600">整单工时优惠（JMD）
                    <input type="number" min={0} value={laborDiscount} onChange={(e) => setLaborDiscount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      data-testid="quick-create-labor-discount" className={inputClass} />
                  </label>
                  <label className="text-xs font-semibold text-rose-600">整单配件优惠（JMD）
                    <input type="number" min={0} value={partsDiscount} onChange={(e) => setPartsDiscount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      data-testid="quick-create-parts-discount" className={inputClass} />
                  </label>
                </div>
                <p className="text-sm font-bold text-ink dark:text-slate-100">总计（含 15% GCT）<span data-testid="quick-create-grand-total" className="ml-2">{formatJMDFull(Math.max(0, totals.totalJmd - laborDiscount - partsDiscount))}</span></p>
              </div>
            </div>
          )}

          {/* 备注（中文留档 + 英文客户联） */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">备注（中文留档，选填）</label>
              <textarea value={noteZh} onChange={(e) => setNoteZh(e.target.value)} data-testid="quick-create-note-zh" rows={2}
                placeholder="需要留档的补充说明" className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">English note（客户联，选填）
                <button type="button" data-testid="quick-create-note-translate" onClick={() => void aiTranslateRepair(noteZh).then((en) => { if (en) setNoteEn(en); })}
                  disabled={!noteZh.trim()}
                  className="ml-2 rounded border border-line px-2 py-0.5 text-[10px] font-semibold text-primary hover:border-primary-300 disabled:opacity-50 dark:border-slate-600">
                  AI 翻译
                </button>
              </label>
              <textarea value={noteEn} onChange={(e) => setNoteEn(e.target.value)} data-testid="quick-create-note-en" rows={2}
                placeholder="Note printed on the customer copy" className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            </div>
          </div>

          {error && <p data-testid="quick-create-error" role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line p-4 dark:border-slate-700 sm:px-5">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink-soft dark:border-slate-600 dark:text-slate-300">取消</button>
          <button type="button" data-testid="quick-create-submit" onClick={submit} disabled={pending || items.length === 0}
            className="inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {pending ? "生成中…" : "确认生成工单"}
          </button>
        </div>
      </div>
      {showImport && <QuoteImportDialog vehicleId={vehicleId || null} onClose={() => setShowImport(false)} onImport={(items) => {
        // 报价项目照搬进收费项草稿（2026-08-20 老板：报价→勾选→带进工单）
        setItems((current) => [...current, ...items.map((item) => {
          const category: QuickItemCategory = item.category === "parts" ? "parts" : "labor";
          return {
            key: keySequence.current++,
            descZh: item.descZh,
            descEn: item.descEn,
            category,
            unit: item.unit,
            unitPriceJmd: item.unitPriceJmd,
            quantity: item.quantity,
            pendingQuote: item.pendingQuote,
            remarkZh: item.remarkZh,
            remarkEn: item.remarkEn,
            unitEn: item.unitEn,
          };
        })]);
        setParsed(true);
        setShowImport(false);
      }} />}
    </div>
  );
}
