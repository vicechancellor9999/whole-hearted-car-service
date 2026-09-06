"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { fetchFormalBusinessOrder, formatFormalMoney, type FormalBusinessOrderDetail, type FormalChargeSnapshot } from "@/lib/api/formal-business-orders";

type ReviewItem = {
  kind: "labor" | "part" | "other";
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  unitItemId: number;
  quantity: string;
  unitPrice: string;
  pendingQuote?: boolean;
  itemDiscount: string;
};
type ReviewNote = { kind: string; contentZh: string; contentEn: string };
const kinds = { labor: ["工时", "Labor"], part: ["配件", "Parts"], other: ["其他费用", "Other charges"] };
const noteKinds: Record<string, string[]> = { customer_concern: ["客户反馈", "Customer concern"], work_instruction: ["施工说明", "Work instruction"], liability_notice: ["责任说明 / 提前告知", "Liability / advance notice"], internal: ["内部备注", "Internal note"] };
const discounts = [
  ["laborDiscountMinor", "工时分类优惠", "Labor category discount"],
  ["partDiscountMinor", "配件分类优惠", "Parts category discount"],
  ["otherDiscountMinor", "其他费用优惠", "Other category discount"],
  ["wholeOrderDiscountMinor", "整单优惠", "Whole-order discount"],
] as const;

function Review({ title, version, items, notes, totals, units, english }: {
  title: string; version: number; items: ReviewItem[]; notes: ReviewNote[];
  totals: FormalChargeSnapshot["totals"]; units: FormalBusinessOrderDetail["chargeUnits"]; english: boolean;
}) {
  return <section className="min-w-0 rounded-xl border border-line p-4">
    <h3 className="text-sm font-bold">{title}</h3>
    <p className="mt-1 text-xs text-ink-soft">{english ? "Order revision" : "业务单版本"} {version}</p>
    <div className="mt-4 space-y-3">{items.map((item, index) => <article key={index} className="break-words rounded-lg bg-layer-2 p-3 text-sm">
      <p className="text-xs font-semibold text-primary">{kinds[item.kind][english ? 1 : 0]}</p>
      <h4 className="mt-1 font-bold">{item.nameZh || "—"}</h4><p>{item.nameEn || "—"}</p>
      <p className="mt-2 whitespace-pre-wrap text-xs text-ink-soft">{item.descriptionZh || "—"}<br />{item.descriptionEn || "—"}</p>
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><dt>{english ? "Qty / unit" : "数量 / 单位"}</dt><dd>{item.quantity.replace(/\.0+$/, "")} · {item.kind === "labor" ? "JOB" : units.find(unit => unit.id === item.unitItemId)?.[english ? "labelEn" : "labelZh"] || `#${item.unitItemId}`}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt>{english ? "Tax-inclusive price" : "含税单价"}</dt><dd className="whitespace-nowrap tabular-nums">{item.pendingQuote ? (english ? "Pending quote" : "待报价") : `JMD ${item.unitPrice || "—"}`}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt>{english ? "Item discount" : "本项折扣"}</dt><dd className="whitespace-nowrap tabular-nums">{item.pendingQuote ? "—" : `JMD ${item.itemDiscount || "—"}`}</dd></div>
      </dl>
    </article>)}</div>
    <dl className="mt-4 space-y-2 border-t border-line pt-3 text-xs">{discounts.map(([key, zh, en]) => <div key={key} className="flex flex-wrap justify-between gap-2"><dt>{english ? en : zh}</dt><dd className="whitespace-nowrap font-semibold tabular-nums">{formatFormalMoney(totals[key])}</dd></div>)}</dl>
    {notes.map((note, index) => <div key={index} className="mt-3 break-words rounded-lg border border-line p-3 text-xs"><strong>{noteKinds[note.kind]?.[english ? 1 : 0] ?? note.kind}</strong><p className="mt-1 whitespace-pre-wrap">{note.contentZh || "—"}<br />{note.contentEn || "—"}</p></div>)}
  </section>;
}

/** Read-only comparison. Choosing a side stages a draft; it never writes charges. */
export function BusinessChargeComparison({ businessOrderId, version, items, notes, totals, units, english, onClose, onChoose }: {
  businessOrderId: number; version: number; items: ReviewItem[]; notes: ReviewNote[];
  totals: FormalChargeSnapshot["totals"]; units: FormalBusinessOrderDetail["chargeUnits"]; english: boolean;
  onClose(): void; onChoose(latest: FormalBusinessOrderDetail, keepMine: boolean): void;
}) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ attempt: number; latest?: FormalBusinessOrderDetail; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    void fetchFormalBusinessOrder(businessOrderId).then(latest => {
      if (active) setResult({ attempt: retry, latest });
    }).catch(error => {
      if (active) setResult({ attempt: retry, error: error instanceof Error ? error.message : "Could not read latest charges" });
    });
    return () => { active = false; };
  }, [businessOrderId, retry]);
  const current = result?.attempt === retry ? result : null;
  const latest = current?.latest;
  const available = latest?.capabilities.canWrite && !latest.order.voided;
  return <Dialog open title={english ? "Compare charge versions" : "核对收费版本"} closeLabel={english ? "Close charge comparison" : "关闭核对收费版本"} onClose={onClose} mobileFullscreen>
    <div className="p-4 sm:p-5">
      <p className="text-sm leading-6 text-ink-soft">{english ? "Review items, notes and every discount. Your choice only loads an unsaved draft. Save explicitly after checking; any further concurrent update will still be checked." : "核对项目、备注和全部优惠。选择后只载入未保存草稿，确认无误后再保存；期间有新修改时，系统仍会检查版本。"}</p>
      {!current ? <p role="status" className="py-8 text-center">{english ? "Reading latest charges…" : "正在读取最新收费…"}</p> : null}
      {current?.error ? <div role="alert" className="mt-4 rounded-xl border border-state-danger-border p-4"><p>{current.error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-3 min-h-11 rounded-lg border border-line px-4 text-sm">{english ? "Retry latest charges" : "重新读取最新收费"}</button></div> : null}
      {latest ? <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Review title={english ? "My unsaved draft" : "我的未保存草稿"} version={version} items={items} notes={notes} totals={totals} units={units} english={english} />
        <Review title={english ? "Latest saved charges" : "系统最新收费"} version={latest.order.version} totals={latest.charges.totals} units={latest.chargeUnits} english={english}
          items={latest.charges.items.map(item => ({ ...item, nameEn: item.nameEn ?? "", descriptionZh: item.descriptionZh ?? "", descriptionEn: item.descriptionEn ?? "", unitPrice: String(item.unitPriceMinor / 100), itemDiscount: String(item.itemDiscountMinor / 100) }))}
          notes={latest.charges.notes.map(note => ({ ...note, contentZh: note.contentZh ?? "", contentEn: note.contentEn ?? "" }))} />
      </div> : null}
      {latest && !available ? <p role="alert" className="mt-4 text-sm text-state-danger-text">{english ? "This order is now read-only or voided. Close this comparison to keep your draft; review the order status or ask an administrator to restore access." : "该业务单目前只读或已作废。关闭可保留草稿，请核查业务单状态或由管理员恢复操作权限。"}</p> : null}
    </div>
    {latest && available ? <div className="sticky bottom-0 z-10 grid gap-2 border-t border-line bg-card p-4 sm:grid-cols-2">
      <button type="button" onClick={() => onChoose(latest, false)} className="min-h-11 rounded-lg border border-line px-3 py-2 text-sm font-semibold">{english ? "Use latest charges and discounts as draft" : "使用最新收费与优惠作为草稿"}</button>
      <button type="button" onClick={() => onChoose(latest, true)} className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white">{english ? "Keep my charges and discounts after review" : "核对后保留我的收费与优惠"}</button>
    </div> : null}
  </Dialog>;
}
