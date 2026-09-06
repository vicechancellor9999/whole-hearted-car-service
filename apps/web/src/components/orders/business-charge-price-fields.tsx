/** Pricing status is explicit; temporarily selecting pending retains typed amounts until saved. */
export function BusinessChargePriceFields({ name, unitPrice, itemDiscount, pendingQuote, english, onChange }: {
  name: string; unitPrice: string; itemDiscount: string; pendingQuote: boolean; english: boolean;
  onChange(field: "unitPrice" | "itemDiscount" | "pendingQuote", value: string | boolean): void;
}) {
  return <>
    <div className="min-w-0 lg:self-start">
      <label>{english ? "Tax-inclusive price" : "含税单价"}
        <input aria-label={english ? "Tax-inclusive price" : "含税单价"} required={!pendingQuote} disabled={pendingQuote} inputMode="decimal" value={pendingQuote ? "" : unitPrice} placeholder={pendingQuote ? (english ? "Pending quote" : "待报价") : (english ? "0 = free" : "0 表示免费")} onChange={event => onChange("unitPrice", event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line px-2 disabled:bg-layer-2" />
      </label>
      <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" aria-label={`${english ? "Pending quote" : "待报价"} ${name || (english ? "Unnamed item" : "未命名项目")}`} checked={pendingQuote} onChange={event => onChange("pendingQuote", event.target.checked)} />
        {english ? "Pending quote" : "待报价"}
      </label>
    </div>
    <label className="lg:self-start">{english ? "Item discount" : "本项折扣"}
      <input aria-label={english ? "Item discount" : "本项折扣"} required={!pendingQuote} disabled={pendingQuote} inputMode="decimal" value={pendingQuote ? "" : itemDiscount} placeholder={pendingQuote ? "—" : "0"} onFocus={event => event.currentTarget.select()} onChange={event => onChange("itemDiscount", event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-line px-2 disabled:bg-layer-2" />
      {pendingQuote ? <span className="mt-1 block text-xs leading-5 text-ink-soft">{english ? "Price can be added later. Not included in the quoted amount." : "可先保存，之后补价；暂不计入已报价金额。"}</span> : null}
    </label>
  </>;
}
