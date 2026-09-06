import { formalGroupedChargeNetTotals, formatFormalMoney, type FormalChargeSnapshot } from "@/lib/api/formal-business-orders";
import type { UiLanguage } from "@/lib/i18n/language";
import styles from "./business-charge-section.module.css";

const labels = { labor: ["工时", "Labor"], part: ["配件", "Parts"], other: ["其他费用", "Other charges"] } as const;

export function BusinessChargeSection({ charges, kind, unitLabels, language }: {
  charges: FormalChargeSnapshot;
  kind: keyof typeof labels;
  unitLabels: Map<number, string>;
  language: UiLanguage;
}) {
  const english = language === "en";
  const items = charges.items.filter((item) => item.kind === kind);
  const pendingCount = items.filter(item => item.pendingQuote).length;
  if (!items.length) return null;
  const totals = formalGroupedChargeNetTotals(charges);
  const total = { labor: totals.laborTotalMinor, part: totals.partTotalMinor, other: totals.otherTotalMinor }[kind];
  const categoryDiscount = { labor: charges.totals.laborDiscountMinor, part: charges.totals.partDiscountMinor, other: charges.totals.otherDiscountMinor }[kind];
  return <section className={styles.section} aria-label={labels[kind][english ? 1 : 0]}>
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-bold text-ink">{labels[kind][english ? 1 : 0]} <span className="ml-1 text-xs font-normal text-ink-soft">{english ? `${items.length} items` : `${items.length} 项`}</span></h3>
      <div className="text-xs text-ink-soft">{pendingCount ? (english ? "Quoted net total" : "已报价折后合计") : (english ? "Net total" : "折后合计")} <strong data-testid="charge-category-total" className="ml-2 whitespace-nowrap text-sm text-ink tabular-nums">{formatFormalMoney(total)}</strong></div>
    </div>
    <div className="overflow-hidden rounded-xl border border-line">
      {items.map((item) => <article key={item.id} data-testid={`charge-item-${item.id}`} className={`${styles.row} formal-charge-row`}>
        <div className={styles.identity}>
          <h4 className="text-sm font-semibold leading-5 text-ink">{english ? item.nameEn || "Translation required" : item.nameZh}</h4>
          {(english ? item.nameZh : item.nameEn) ? <p className="mt-0.5 text-xs leading-5 text-ink-soft">{english ? item.nameZh : item.nameEn}</p> : null}
          {(item.descriptionZh || item.descriptionEn) ? <div className="mt-2 border-l-2 border-line pl-2 text-xs leading-5 text-ink-soft"><span className="mr-1.5 font-medium">{english ? "Description" : "描述"}</span><span>{english ? item.descriptionEn || "Translation required" : item.descriptionZh || "—"}</span>{!english && item.descriptionEn ? <p>{item.descriptionEn}</p> : null}</div> : null}
        </div>
        <dl className={styles.metrics}>
          <div><dt>{english ? "Qty / unit" : "数量 / 单位"}</dt><dd>{item.quantity.replace(/\.0+$/, "")}<span className="block text-xs font-normal text-ink-soft">{item.kind === "labor" ? "JOB" : unitLabels.get(item.unitItemId) ?? "—"}</span></dd></div>
          <div><dt>{english ? "Tax-inclusive price" : "含税单价"}</dt><dd>{item.pendingQuote ? (english ? "Pending quote" : "待报价") : formatFormalMoney(item.unitPriceMinor)}</dd></div>
          <div><dt>{english ? "Discount" : "本项折扣"}</dt><dd className={item.itemDiscountMinor ? "text-state-danger-text" : "text-ink-soft"}>{item.pendingQuote ? "—" : item.itemDiscountMinor > 0 ? `−${formatFormalMoney(item.itemDiscountMinor)}` : formatFormalMoney(0)}</dd></div>
          <div><dt>{english ? "Subtotal" : "小计"}</dt><dd className="font-bold">{item.pendingQuote ? "—" : formatFormalMoney(item.subtotalMinor)}</dd></div>
        </dl>
      </article>)}
    </div>
    {categoryDiscount > 0 ? <p className="mt-2 text-right text-xs text-ink-soft">{english ? "Category discount included in net total" : "分类折扣已计入折后合计"} <span className="ml-2 tabular-nums text-state-danger-text">−{formatFormalMoney(categoryDiscount)}</span></p> : null}
  </section>;
}
