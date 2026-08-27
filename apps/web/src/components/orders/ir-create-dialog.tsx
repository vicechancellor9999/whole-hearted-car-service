"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { loadWorkspace } from "@/components/customers/detail-shared";
import type { CustomerVehicleWorkspaceResponse } from "@/lib/customers/types";
import { parseInspectionNaturalLanguage, quotationLinesFromParsed, type ParsedInspectionResult } from "@/lib/orders/ir-nl-parse";
import { aiParseInspectionNaturalLanguage } from "@/lib/ai/auto-repair";
import { calculateQuotedChargeTotals, type QuotedChargeLine } from "@/lib/billing/quoted-charges";
import { cn, formatJMDFull } from "@/lib/utils";

export function IrCreateDialog({
  onClose,
  initialVehiclePlate,
  sourceBusinessOrderId,
  onCreated,
}: {
  onClose: () => void;
  initialVehiclePlate?: string;
  sourceBusinessOrderId?: string;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [rawText, setRawText] = useState("");
  const [result, setResult] = useState<ParsedInspectionResult | null>(null);
  const [pending, setPending] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadWorkspace().then(setWorkspace).catch(() => setWorkspace(null));
  }, []);

  useEffect(() => {
    if (!workspace || vehicleId || !initialVehiclePlate) return;
    const normalizePlate = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();
    const matched = workspace.vehicles.find((vehicle) =>
      normalizePlate(vehicle.plate) === normalizePlate(initialVehiclePlate),
    );
    if (matched) setVehicleId(matched.id);
  }, [initialVehiclePlate, vehicleId, workspace]);

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
  const matchedVehicles = useMemo(() => {
    const all = workspace?.vehicles ?? [];
    const query = vehicleQuery.trim().toLowerCase();
    const ownerName = (id: string) => {
      const rel = activeRelationships.find((r) => r.vehicleId === id);
      const customer = workspace?.customers.find((c) => c.id === rel?.customerId);
      return customer ? (customer.nameZh ?? customer.nameEn ?? customer.organizationName ?? "") : "";
    };
    const rows = all.map((v) => ({ vehicle: v, owner: ownerName(v.id) }));
    if (!query) return rows.slice(0, 10);
    return rows.filter(({ vehicle, owner }) =>
      [vehicle.plate, vehicle.makeZh, vehicle.make, vehicle.modelZh, vehicle.model, vehicle.vin, owner]
        .filter(Boolean).join(" ").toLowerCase().includes(query),
    ).slice(0, 10);
  }, [activeRelationships, vehicleQuery, workspace]);

  const selectedVehicle = workspace?.vehicles.find((v) => v.id === vehicleId) ?? null;
  const owner = useMemo(() => {
    if (!vehicleId) return null;
    const rel = activeRelationships.find((r) => r.vehicleId === vehicleId);
    const customer = workspace?.customers.find((c) => c.id === rel?.customerId);
    return customer ?? null;
  }, [activeRelationships, vehicleId, workspace]);

  const previewTotals = useMemo(() => calculateQuotedChargeTotals(
    quotationLinesFromParsed(result?.items ?? []).map((line, index) => ({ ...line, id: `preview-${index + 1}` } as QuotedChargeLine)),
  ), [result]);
  const partCount = (result?.items ?? []).filter((item) => item.category === "parts").length;
  const otherCount = (result?.items ?? []).filter((item) => item.pricingMode === "fixed_total").length;

  const runParse = async () => {
    setParsing(true);
    setError(null);
    let parsed: ParsedInspectionResult | null = null;
    const ai = await aiParseInspectionNaturalLanguage(rawText);
    if (ai && ai.length > 0) {
      parsed = {
        aiDraft: ai.map((item, index) => `${index + 1}. ${item.findingZh}（${item.pricingMode === "fixed_total" ? `其他费用 JMD ${item.amountJmd.toLocaleString("en-US")}` : item.category === "labor" ? item.amountJmd > 0 ? `工时报价 JMD ${item.amountJmd.toLocaleString("en-US")}` : "工时（金额待定）" : item.pendingQuote ? "配件清单，另行报价" : `配件报价 JMD ${item.amountJmd.toLocaleString("en-US")}`}）`).join("\n"),
        items: ai,
      };
    }
    if (!parsed) {
      const local = parseInspectionNaturalLanguage(rawText);
      if (local.items.length > 0) parsed = local;
    }
    if (!parsed) { setError("没整理出检查项目，换行逐条写"); setParsing(false); return; }
    setResult(parsed);
    setParsing(false);
  };

  const submit = async () => {
    if (!vehicleId) { setError("先选择车辆"); return; }
    if (!result || result.items.length === 0) { setError("先 AI 整理检查结果"); return; }
    setPending(true);
    setError(null);
    try {
      const created = await api.inspectionReports.create({
        vehicleId,
        ...(sourceBusinessOrderId ? { sourceBusinessOrderId } : {}),
        rawText,
        aiDraft: result.aiDraft,
        items: result.items.map((item) => ({ findingZh: item.findingZh, recommendationZh: item.recommendationZh })),
        quotationLines: quotationLinesFromParsed(result.items),
      });
      if (onCreated) {
        onCreated();
      } else {
        router.push(`/orders/inspections/${created.id}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败，请重试");
      setPending(false);
    }
  };

  const inputClass = "min-h-9 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="新建检查结果" data-testid="ir-create-dialog"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="my-auto w-full max-w-3xl overflow-hidden rounded-[22px] border border-line bg-white shadow-card-hover dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-start justify-between border-b border-line p-4 dark:border-slate-700 sm:px-5">
          <div>
            <h2 className="text-base font-bold text-ink dark:text-slate-100">新建检查结果</h2>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">选车辆 → 大白话回交检查结果 → AI 整理检查项目与报价（工时报价、配件清单另报）→ 生成详情后人工发客户</p>
            {sourceBusinessOrderId ? <p className="mt-1 text-[11px] font-semibold text-primary">来源 Business Order：{sourceBusinessOrderId}</p> : null}
          </div>
          <button type="button" data-testid="ir-create-close" onClick={onClose} aria-label="关闭"
            className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-sm text-ink-soft hover:text-ink dark:border-slate-600 dark:text-slate-300">
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto p-4 sm:p-5">
          <div>
            <label className="text-xs font-semibold text-ink dark:text-slate-200">车辆（先选车，客户自动带出）</label>
            {selectedVehicle ? (
              <div className="mt-1.5 rounded-xl border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-500/40 dark:bg-violet-500/5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span data-testid="ir-create-vehicle" className="text-sm font-bold text-ink dark:text-slate-100">
                      {selectedVehicle.plate} · {selectedVehicle.makeZh ?? selectedVehicle.make} {selectedVehicle.modelZh ?? selectedVehicle.model}
                    </span>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-soft dark:text-slate-400">VIN / 车架号：{selectedVehicle.vin || "未登记"}</p>
                  </div>
                  <button type="button" onClick={() => setVehicleId("")} className="text-xs text-violet-700 hover:underline dark:text-violet-300">换车</button>
                </div>
                <p className="mt-2 text-xs text-ink-soft dark:text-slate-400">
                  客户：<span className="font-semibold text-ink dark:text-slate-100">{owner ? (owner.nameZh ?? owner.nameEn ?? owner.organizationName) : "未挂客户，先登记"}</span>
                </p>
              </div>
            ) : (
              <>
                <input value={vehicleQuery} onChange={(e) => setVehicleQuery(e.target.value)} data-testid="ir-create-vehicle-search"
                  placeholder="搜车牌 / 车型 / 车架号 / 车主" className={cn(inputClass, "mt-1.5")} />
                {matchedVehicles.length > 0 && (
                  <ul className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-line dark:border-slate-600">
                    {matchedVehicles.map(({ vehicle: v, owner: name }) => (
                      <li key={v.id}>
                        <button type="button" data-testid={`ir-create-vehicle-option-${v.id}`} onClick={() => setVehicleId(v.id)}
                          className="block w-full px-3 py-2 text-left text-xs hover:bg-violet-50 dark:hover:bg-slate-700">
                          <span className="font-semibold text-ink dark:text-slate-100">{v.plate} · {v.makeZh ?? v.make} {v.modelZh ?? v.model}</span>
                          <span className="ml-2 text-ink-soft dark:text-slate-400">{name || "未挂客户"}</span>
                          <span className="ml-2 font-mono text-[10px] text-ink-faint dark:text-slate-500">VIN {v.vin || "—"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-ink dark:text-slate-200">维修工回交（大白话，一行一条；工时写金额，配件只列清单）</label>
            <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} data-testid="ir-create-raw"
              rows={6} placeholder={"例：\n发动机异响 需要检查 工时15000\n前刹车片磨损到极限 配件待报价\n冷却液泄漏 需要更换水管 工时8000"}
              className="mt-1.5 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
            <button type="button" data-testid="ir-create-parse" onClick={() => void runParse()} disabled={!rawText.trim() || parsing}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
              <Wand2 size={14} />
              {parsing ? "AI 整理中…" : "AI 整理检查结果"}
            </button>
          </div>

          {result && (
            <div data-testid="ir-create-items" className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-500/20 dark:bg-violet-500/5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-bold text-ink dark:text-slate-100">AI 整理结果（检查项目 + 报价草稿）</p>
                <p className="text-[11px] text-ink-soft dark:text-slate-400">工时合计 <b data-testid="ir-create-labor-total" className="ml-1 text-ink dark:text-slate-100">{formatJMDFull(previewTotals.laborGrossJmd)}</b>{partCount > 0 ? ` · ${partCount} 项配件` : ""}{otherCount > 0 ? ` · ${otherCount} 项其他费用` : ""}</p>
              </div>
              <div className="space-y-2">
                {result.items.map((item, index) => (
                  <div key={index} className="rounded-lg bg-white/80 p-2.5 dark:bg-slate-800/70">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-ink dark:text-slate-100">{index + 1}. {item.findingZh}</p>
                        <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">{item.recommendationZh}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        {item.pricingMode === "fixed_total" ? (
                          <p className="text-[11px] font-bold tabular-nums text-ink dark:text-slate-100">其他费用 · {formatJMDFull(item.amountJmd)}</p>
                        ) : item.category === "labor" ? (
                          <p className="text-[11px] font-bold tabular-nums text-ink dark:text-slate-100">{item.amountJmd > 0 ? formatJMDFull(item.amountJmd) : "金额待定"}</p>
                        ) : item.pendingQuote ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">配件清单 · 另报</span>
                        ) : (
                          <p className="text-[11px] font-bold tabular-nums text-ink dark:text-slate-100">配件 · {formatJMDFull(item.amountJmd)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-ink-soft dark:text-slate-400">发给客户的是 A4 / PDF（三语可切换）；生成详情后由前台人工发送。</p>
            </div>
          )}

          {error && <p data-testid="ir-create-error" role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line p-4 dark:border-slate-700 sm:px-5">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink-soft dark:border-slate-600 dark:text-slate-300">取消</button>
          <button type="button" data-testid="ir-create-submit" onClick={submit} disabled={pending || !result}
            className="inline-flex min-h-10 items-center rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {pending ? "创建中…" : "生成检查结果详情"}
          </button>
        </div>
      </div>
    </div>
  );
}
