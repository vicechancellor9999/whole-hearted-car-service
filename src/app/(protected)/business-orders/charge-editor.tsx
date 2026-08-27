"use client";

import { useMemo, useState } from "react";
import type {
  BusinessOrderChargeSnapshot,
} from "@/modules/business-order/business-order-service";

type FormAction = (formData: FormData) => void | Promise<void>;

type ChargeUnitOption = {
  id: number;
  labelZh: string;
  labelEn: string | null;
};

type EditableItem = {
  key: string;
  kind: "labor" | "part" | "other";
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  unitItemId: string;
  quantity: string;
  unitPrice: string;
  itemDiscount: string;
};

const categoryLabels = {
  labor: "工时",
  part: "配件",
  other: "其他费用",
} as const;

const noteLabels = {
  customer_concern: "客户诉求",
  work_instruction: "施工说明",
  liability_notice: "责任与提前告知备注",
  internal: "内部备注",
} as const;

function moneyFromMinor(value: number) {
  return (value / 100).toFixed(2).replace(/\.00$/, "");
}

function newItem(kind: EditableItem["kind"], index: number): EditableItem {
  return {
    key: `new-${kind}-${index}`,
    kind,
    nameZh: "",
    nameEn: "",
    descriptionZh: "",
    descriptionEn: "",
    unitItemId: "",
    quantity: "1",
    unitPrice: "0",
    itemDiscount: "0",
  };
}

export function ChargeEditor({
  action,
  businessOrderId,
  businessOrderVersion,
  canWrite,
  chargeUnits,
  charges,
}: {
  action: FormAction;
  businessOrderId: number;
  businessOrderVersion: number;
  canWrite: boolean;
  chargeUnits: ChargeUnitOption[];
  charges: BusinessOrderChargeSnapshot;
}) {
  const [items, setItems] = useState<EditableItem[]>(() => charges.items.map((item) => ({
    key: `existing-${item.id}`,
    kind: item.kind,
    nameZh: item.nameZh,
    nameEn: item.nameEn ?? "",
    descriptionZh: item.descriptionZh ?? "",
    descriptionEn: item.descriptionEn ?? "",
    unitItemId: String(item.unitItemId),
    quantity: item.quantity.replace(/\.0+$/, ""),
    unitPrice: moneyFromMinor(item.unitPriceMinor),
    itemDiscount: moneyFromMinor(item.itemDiscountMinor),
  })));
  const [translationKey, setTranslationKey] = useState<string | null>(null);
  const [noteValues, setNoteValues] = useState(() => Object.fromEntries(
    Object.keys(noteLabels).map((kind) => {
      const note = charges.notes.find((candidate) => candidate.kind === kind);
      return [kind, { zh: note?.contentZh ?? "", en: note?.contentEn ?? "" }];
    }),
  ) as Record<keyof typeof noteLabels, { zh: string; en: string }>);

  const serializedItems = useMemo(() => JSON.stringify(items
    .filter((item) => item.nameZh.trim())
    .map((item) => ({
      kind: item.kind,
      nameZh: item.nameZh,
      nameEn: item.nameEn,
      descriptionZh: item.descriptionZh,
      descriptionEn: item.descriptionEn,
      unitItemId: item.unitItemId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      itemDiscount: item.itemDiscount,
    }))), [items]);
  const serializedNotes = useMemo(() => JSON.stringify(
    Object.entries(noteValues)
      .filter(([, value]) => value.zh.trim() || value.en.trim())
      .map(([kind, value]) => ({
        kind,
        contentZh: value.zh,
        contentEn: value.en,
      })),
  ), [noteValues]);

  const updateItem = (key: string, field: keyof EditableItem, value: string) => {
    setItems((current) => current.map((item) => item.key === key
      ? { ...item, [field]: value }
      : item));
  };
  const addItem = (kind: EditableItem["kind"]) => {
    setItems((current) => [...current, newItem(kind, current.length + 1)]);
  };

  return (
    <section aria-label="收费项目" className="bo-panel bo-charge-section">
      <header className="bo-panel-heading">
        <div><h2>收费项目</h2><p>工时、配件、其他费用分区；所有金额均为含税价。</p></div>
        <strong>当前应收 JMD {moneyFromMinor(charges.totals.totalDueMinor)}</strong>
      </header>
      {canWrite ? (
        <form action={action} className="bo-charge-form">
          <input name="operation" type="hidden" value="replace_charges" />
          <input name="businessOrderId" type="hidden" value={businessOrderId} />
          <input name="expectedBusinessOrderVersion" type="hidden" value={businessOrderVersion} />
          <input name="itemsJson" type="hidden" value={serializedItems} />
          <input name="notesJson" type="hidden" value={serializedNotes} />
          <div className="bo-charge-grid bo-charge-head">
            <span>项目名称</span><span>描述</span><span>单位</span><span>数量</span>
            <span>含税单价</span><span>本项折扣</span><span>含税小计</span><span>译</span><span>删</span>
          </div>
          {(Object.keys(categoryLabels) as Array<keyof typeof categoryLabels>).map((kind) => (
            <section className="bo-charge-category" key={kind}>
              <header><h3>{categoryLabels[kind]}</h3><button onClick={() => addItem(kind)} type="button">新增{categoryLabels[kind]}</button></header>
              {items.filter((item) => item.kind === kind).map((item) => {
                const subtotal = Math.max(
                  0,
                  (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) -
                    (Number(item.itemDiscount) || 0),
                );
                return (
                  <div className={`bo-charge-grid bo-charge-row${translationKey === item.key ? " translation-active" : ""}`} key={item.key}>
                    <label><span className="sr-only">中文项目名称</span><input aria-label="中文项目名称" onChange={(event) => updateItem(item.key, "nameZh", event.target.value)} placeholder="中文名称" required value={item.nameZh} /><input aria-label="英文项目名称" onChange={(event) => updateItem(item.key, "nameEn", event.target.value)} placeholder="English name" value={item.nameEn} /></label>
                    <label><span className="sr-only">中文描述</span><input aria-label="中文描述" onChange={(event) => updateItem(item.key, "descriptionZh", event.target.value)} placeholder="中文描述" value={item.descriptionZh} /><input aria-label="英文描述" onChange={(event) => updateItem(item.key, "descriptionEn", event.target.value)} placeholder="English description" value={item.descriptionEn} /></label>
                    <label><span className="sr-only">收费单位</span><select aria-label="收费单位" onChange={(event) => updateItem(item.key, "unitItemId", event.target.value)} required value={item.unitItemId}><option value="">选择</option>{chargeUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.labelZh}{unit.labelEn ? ` / ${unit.labelEn}` : ""}</option>)}</select></label>
                    <label><span className="sr-only">数量</span><input aria-label="数量" inputMode="decimal" onChange={(event) => updateItem(item.key, "quantity", event.target.value)} required value={item.quantity} /></label>
                    <label><span className="sr-only">含税单价</span><input aria-label="含税单价" inputMode="decimal" onChange={(event) => updateItem(item.key, "unitPrice", event.target.value)} required value={item.unitPrice} /></label>
                    <label><span className="sr-only">本项折扣</span><input aria-label="本项折扣" inputMode="decimal" onChange={(event) => updateItem(item.key, "itemDiscount", event.target.value)} required value={item.itemDiscount} /></label>
                    <output>JMD {subtotal.toLocaleString("en-JM", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</output>
                    <button aria-pressed={translationKey === item.key} onClick={() => setTranslationKey((current) => current === item.key ? null : item.key)} title="中英文内容均始终显示" type="button">译</button>
                    <button aria-label={`删除${item.nameZh || categoryLabels[kind]}项目`} className="danger-link" onClick={() => setItems((current) => current.filter((candidate) => candidate.key !== item.key))} type="button">删</button>
                  </div>
                );
              })}
              {items.every((item) => item.kind !== kind) ? <p className="bo-empty-line">尚无{categoryLabels[kind]}项目。</p> : null}
            </section>
          ))}
          <section className="bo-discount-grid">
            <label>工时折扣<input defaultValue={moneyFromMinor(charges.totals.laborDiscountMinor)} inputMode="decimal" name="laborDiscount" required /></label>
            <label>配件折扣<input defaultValue={moneyFromMinor(charges.totals.partDiscountMinor)} inputMode="decimal" name="partDiscount" required /></label>
            <label>其他费用折扣<input defaultValue={moneyFromMinor(charges.totals.otherDiscountMinor)} inputMode="decimal" name="otherDiscount" required /></label>
          </section>
          <section className="bo-notes-editor" aria-label="Business Order 备注">
            {(Object.keys(noteLabels) as Array<keyof typeof noteLabels>).map((kind) => (
              <label key={kind}>{noteLabels[kind]}<textarea onChange={(event) => setNoteValues((current) => ({ ...current, [kind]: { ...current[kind], zh: event.target.value } }))} placeholder="中文备注" value={noteValues[kind].zh} /><textarea onChange={(event) => setNoteValues((current) => ({ ...current, [kind]: { ...current[kind], en: event.target.value } }))} placeholder="English note" value={noteValues[kind].en} /></label>
            ))}
          </section>
          <footer className="bo-form-footer"><label>本次修改原因<input defaultValue="收费项目更新" name="reason" required /></label><button type="submit">保存收费项目</button></footer>
        </form>
      ) : (
        <div className="bo-readonly-charges">
          <div className="bo-charge-grid bo-charge-head"><span>项目名称</span><span>描述</span><span>单位</span><span>数量</span><span>含税单价</span><span>本项折扣</span><span>含税小计</span><span>译</span><span>删</span></div>
          {(Object.keys(categoryLabels) as Array<keyof typeof categoryLabels>).map((kind) => (
            <section className="bo-charge-category" key={kind}>
              <header><h3>{categoryLabels[kind]}</h3></header>
              {charges.items.filter((item) => item.kind === kind).map((item) => <div className="bo-charge-grid bo-charge-row" key={item.id}><span>{item.nameZh}<small>{item.nameEn}</small></span><span>{item.descriptionZh ?? "—"}<small>{item.descriptionEn}</small></span><span>#{item.unitItemId}</span><span>{item.quantity}</span><span>JMD {moneyFromMinor(item.unitPriceMinor)}</span><span>JMD {moneyFromMinor(item.itemDiscountMinor)}</span><span>JMD {moneyFromMinor(item.subtotalMinor)}</span><span>—</span><span>—</span></div>)}
              {charges.items.every((item) => item.kind !== kind) ? <p className="bo-empty-line">尚无{categoryLabels[kind]}项目。</p> : null}
            </section>
          ))}
          <section className="bo-discount-grid" aria-label="收费折扣">
            <span>工时折扣<strong>JMD {moneyFromMinor(charges.totals.laborDiscountMinor)}</strong></span>
            <span>配件折扣<strong>JMD {moneyFromMinor(charges.totals.partDiscountMinor)}</strong></span>
            <span>其他费用折扣<strong>JMD {moneyFromMinor(charges.totals.otherDiscountMinor)}</strong></span>
          </section>
          <section className="bo-readonly-notes" aria-label="Business Order 备注">
            {(Object.keys(noteLabels) as Array<keyof typeof noteLabels>).map((kind) => {
              const note = charges.notes.find((candidate) => candidate.kind === kind);
              return <article key={kind}><strong>{noteLabels[kind]}</strong><p>{note?.contentZh || "—"}</p>{note?.contentEn ? <small>{note.contentEn}</small> : null}</article>;
            })}
          </section>
        </div>
      )}
    </section>
  );
}
