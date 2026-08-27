"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  fetchFormalDocument,
  fetchFormalReceipt,
  formalOfficeArchiveUsesEnglishPrimary,
  formalGroupedChargeDiscounts,
  formatFormalMoney,
  type FormalBusinessOrderDocument,
  type FormalMechanicWorkSnapshot,
  type FormalOfficeArchiveSnapshot,
  type FormalPrintableCharges,
  type FormalPrintableTransaction,
  type FormalReceipt,
} from "@/lib/api/formal-business-orders";
import { WHOLE_HEARTED_COMPANY_IDENTITY } from "@/lib/company-identity";

const CATEGORY_LABELS = {
  labor: ["工时", "Labor"],
  part: ["配件", "Parts"],
  other: ["其他费用", "Other charges"],
} as const;

const NOTE_LABELS = {
  customer_concern: ["客户诉求", "Customer concern"],
  work_instruction: ["工作说明", "Work instruction"],
  liability_notice: ["责任义务与提前告知", "Liability and advance notice"],
  internal: ["办公室内部备注", "Office internal note"],
} as const;

function businessTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function localizedPartyName(value: string, language: "zh" | "en") {
  const parts = value.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return value;
  return language === "zh" ? parts[0] : parts[parts.length - 1];
}

function PrintPage({
  backLabel = "← 返回 Business Order",
  backHref,
  children,
  documentNo,
  orderLabel = "Business Order",
  orderNo,
  printLabel = "打印 / 存 PDF",
  title,
  titleAnnotation,
}: {
  backLabel?: string;
  backHref: string;
  children: ReactNode;
  documentNo: string;
  orderLabel?: string;
  orderNo: string;
  printLabel?: string;
  title: string;
  titleAnnotation?: string;
}) {
  return (
    <main className="formal-print-page mx-auto min-h-screen max-w-[210mm] bg-white px-[10mm] py-[9mm] text-[11px] leading-[1.45] text-slate-900 print:min-h-0 print:max-w-none print:p-0">
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          body { background: #fff !important; }
          .formal-print-toolbar { display: none !important; }
          .formal-print-section, .formal-print-row, .formal-print-signature { break-inside: avoid; }
          .formal-print-page { width: 100%; }
        }
      `}</style>
      <nav className="formal-print-toolbar mb-5 flex items-center justify-between gap-3">
        <Link href={backHref} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">{backLabel}</Link>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white">{printLabel}</button>
      </nav>
      <header className="flex items-start justify-between gap-6 border-b-[3px] border-blue-800 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={WHOLE_HEARTED_COMPANY_IDENTITY.logoUrl} alt="Whole Hearted" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
          <div className="min-w-0"><h1 className="text-lg font-black tracking-tight text-blue-950">{WHOLE_HEARTED_COMPANY_IDENTITY.legalName}</h1><p className="text-[10px] text-slate-500">{WHOLE_HEARTED_COMPANY_IDENTITY.address} · {WHOLE_HEARTED_COMPANY_IDENTITY.contactLine} · TRN {WHOLE_HEARTED_COMPANY_IDENTITY.trn}</p></div>
        </div>
        <div className="shrink-0 text-right"><p className="text-base font-black text-blue-900">{title}</p>{titleAnnotation ? <p className="text-[10px] font-semibold text-slate-500">{titleAnnotation}</p> : null}<p className="font-mono text-xs font-bold">{documentNo}</p><p className="mt-0.5 text-[10px] text-slate-500">{orderLabel}：{orderNo}</p></div>
      </header>
      {children}
      <footer className="mt-6 flex justify-between border-t border-slate-300 pt-2 text-[9px] text-slate-500"><span>Whole Hearted Car Service Limited · Kingston, Jamaica</span><span>{documentNo}</span></footer>
    </main>
  );
}

function FactGrid({ children }: { children: ReactNode }) {
  return <section className="formal-print-section mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-300 bg-slate-300 sm:grid-cols-3">{children}</section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="bg-slate-50 px-3 py-2"><span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</span><strong className="mt-0.5 block text-[11px]">{value || "—"}</strong></div>;
}

function ChargesTable({ charges, bilingual }: { charges: FormalPrintableCharges; bilingual: boolean }) {
  return (
    <section className="formal-print-section mt-4">
      <h2 className="border-b-2 border-slate-800 pb-1 text-sm font-black">收费项目{bilingual ? " / Charges" : ""}</h2>
      {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((kind) => {
        const items = charges.items.filter((item) => item.kind === kind);
        if (items.length === 0) return null;
        return <section key={kind} className="formal-print-section mt-2"><h3 className="bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-900">{CATEGORY_LABELS[kind][0]}{bilingual ? ` / ${CATEGORY_LABELS[kind][1]}` : ""}</h3><div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_55px_48px_85px_80px_90px] border-b border-slate-300 px-2 py-1 text-[9px] font-semibold text-slate-500"><span>项目名称</span><span>描述</span><span>单位</span><span>数量</span><span className="text-right">含税单价</span><span className="text-right">本项折扣</span><span className="text-right">含税小计</span></div>{items.map((item, index) => <div key={`${kind}-${index}`} className="formal-print-row grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_55px_48px_85px_80px_90px] items-start border-b border-slate-200 px-2 py-2"><span><strong className="block">{item.nameZh}</strong>{bilingual && item.nameEn ? <small className="block text-[9px] text-blue-700">{item.nameEn}</small> : null}</span><span>{item.descriptionZh || "—"}{bilingual && item.descriptionEn ? <small className="block text-[9px] text-slate-500">{item.descriptionEn}</small> : null}</span><span>{item.unitLabelZh}{bilingual && item.unitLabelEn ? <small className="block text-[9px] text-slate-500">{item.unitLabelEn}</small> : null}</span><span>{item.quantity}</span><span className="text-right tabular-nums">{formatFormalMoney(item.unitPriceMinor)}</span><span className="text-right tabular-nums text-rose-700">−{formatFormalMoney(item.itemDiscountMinor)}</span><strong className="text-right tabular-nums">{formatFormalMoney(item.subtotalMinor)}</strong></div>)}</section>;
      })}
      <ChargeTotals charges={charges} bilingual={bilingual} />
    </section>
  );
}

function ChargeTotals({ charges, bilingual }: { charges: FormalPrintableCharges; bilingual: boolean }) {
  const totals = charges.totals;
  const groupedDiscounts = formalGroupedChargeDiscounts(charges);
  const rows = [
    ["原价合计", "Gross total", totals.grossMinor],
    ["工时折扣合计", "Total labor discount", groupedDiscounts.laborDiscountMinor],
    ["配件折扣合计", "Total parts discount", groupedDiscounts.partDiscountMinor],
    ["其他费用折扣合计", "Total other discount", groupedDiscounts.otherDiscountMinor],
  ] as const;
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-slate-300 text-[10px]">
      <div className="grid grid-cols-3">
        {rows.map(([zh, en, value], index) => {
          const isDiscount = zh.includes("折扣");
          return (
            <div
              key={zh}
              className={`flex min-w-0 items-center justify-between gap-3 px-3 py-2 ${index < 3 ? "border-b" : ""} ${index % 3 !== 2 ? "border-r" : ""} border-slate-200`}
            >
              <span className="min-w-0">{zh}{bilingual ? ` / ${en}` : ""}</span>
              <strong className={`shrink-0 tabular-nums ${isDiscount ? "text-rose-700" : ""}`}>{isDiscount ? "−" : ""}{formatFormalMoney(value)}</strong>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 bg-blue-950 px-3 py-2 text-xs font-black text-white">
        <span>折后应收（含税）{bilingual ? " / Total due" : ""}</span>
        <strong className="tabular-nums">{formatFormalMoney(totals.totalDueMinor)}</strong>
      </div>
      <div className="flex items-center justify-between gap-6 bg-slate-50 px-3 py-1.5 text-[9px] text-slate-600">
        <span>其中含 15% GCT{bilingual ? " / Included 15% GCT" : ""}</span>
        <strong className="tabular-nums">{formatFormalMoney(totals.includedGctMinor)}</strong>
      </div>
    </div>
  );
}

function Ledger({ transactions, bilingual }: { transactions: FormalPrintableTransaction[]; bilingual: boolean }) {
  return <section className="formal-print-section mt-4"><h2 className="border-b-2 border-slate-800 pb-1 text-sm font-black">收付款历史{bilingual ? " / Payment and refund history" : ""}</h2>{transactions.length === 0 ? <p className="py-3 text-slate-500">尚无收付款记录</p> : <div><div className="grid grid-cols-[115px_145px_100px_minmax(0,1fr)_90px] border-b border-slate-300 py-1 text-[9px] font-semibold text-slate-500"><span>时间</span><span>编号</span><span>方式</span><span>备注</span><span className="text-right">金额</span></div>{transactions.map((item) => <div key={`${item.type}-${item.referenceNo}`} className="formal-print-row grid grid-cols-[115px_145px_100px_minmax(0,1fr)_90px] border-b border-slate-200 py-1.5"><span>{businessTime(item.occurredAt)}</span><strong>{item.referenceNo}</strong><span>{item.methodLabelZh}{bilingual && item.methodLabelEn ? ` / ${item.methodLabelEn}` : ""}</span><span>{item.note || "—"}</span><strong className={`text-right ${item.type === "refund" ? "text-rose-700" : "text-emerald-700"}`}>{item.type === "refund" ? "−" : "+"}{formatFormalMoney(item.amountMinor)}</strong></div>)}</div>}</section>;
}

function Notes({ charges, includeInternal, bilingual = true }: { charges: FormalPrintableCharges; includeInternal: boolean; bilingual?: boolean }) {
  const notes = charges.notes.filter((note) => includeInternal || note.kind !== "internal");
  if (notes.length === 0) return null;
  return <section className="formal-print-section mt-4"><h2 className="border-b-2 border-slate-800 pb-1 text-sm font-black">备注、责任义务与提前告知{bilingual ? " / Notes and notices" : ""}</h2>{notes.map((note, index) => <article key={`${note.kind}-${index}`} className="formal-print-row grid grid-cols-[160px_minmax(0,1fr)] border-b border-slate-200 py-2"><strong>{NOTE_LABELS[note.kind][0]}{bilingual ? ` / ${NOTE_LABELS[note.kind][1]}` : ""}</strong><p className="whitespace-pre-wrap">{note.contentZh || "—"}{bilingual && note.contentEn ? `\n${note.contentEn}` : ""}</p></article>)}</section>;
}

function EnglishPrimaryLabel({ en, zh, showChinese = true }: { en: string; zh: string; showChinese?: boolean }) {
  return <span className="min-w-0"><span className="block font-semibold">{en}</span>{showChinese ? <small className="block text-[8px] font-normal text-slate-500">{zh}</small> : null}</span>;
}

function EnglishPrimaryFact({ labelEn, labelZh, value, showChinese = true }: { labelEn: string; labelZh: string; value: string; showChinese?: boolean }) {
  return <div className="bg-slate-50 px-3 py-2"><EnglishPrimaryLabel en={labelEn} zh={labelZh} showChinese={showChinese} /><strong className="mt-0.5 block text-[11px]">{value}</strong></div>;
}

function EnglishPrimaryChargesTable({ charges, showChinese = true }: { charges: FormalPrintableCharges; showChinese?: boolean }) {
  const totals = charges.totals;
  const groupedDiscounts = formalGroupedChargeDiscounts(charges);
  const summaryRows = [
    ["Gross total", "原价合计", totals.grossMinor, false],
    ["Total labor discount", "工时折扣合计", groupedDiscounts.laborDiscountMinor, true],
    ["Total parts discount", "配件折扣合计", groupedDiscounts.partDiscountMinor, true],
    ["Total other discount", "其他费用折扣合计", groupedDiscounts.otherDiscountMinor, true],
  ] as const;
  return (
    <section className="formal-print-section mt-4">
      <h2 className="border-b-2 border-slate-800 pb-1 text-sm font-black">Charges {showChinese ? <small className="ml-1 text-[9px] font-semibold text-slate-500">收费项目</small> : null}</h2>
      {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((kind) => {
        const items = charges.items.filter((item) => item.kind === kind);
        if (items.length === 0) return null;
        return <section key={kind} className="formal-print-section mt-2"><h3 className="bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-900">{CATEGORY_LABELS[kind][1]} {showChinese ? <small className="font-semibold text-slate-500">{CATEGORY_LABELS[kind][0]}</small> : null}</h3><div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_55px_48px_85px_80px_90px] border-b border-slate-300 px-2 py-1 text-[9px] text-slate-600"><EnglishPrimaryLabel en="Item" zh="项目名称" showChinese={showChinese} /><EnglishPrimaryLabel en="Description" zh="描述" showChinese={showChinese} /><EnglishPrimaryLabel en="Unit" zh="单位" showChinese={showChinese} /><EnglishPrimaryLabel en="Qty" zh="数量" showChinese={showChinese} /><EnglishPrimaryLabel en="Tax-incl. price" zh="含税单价" showChinese={showChinese} /><EnglishPrimaryLabel en="Item discount" zh="本项折扣" showChinese={showChinese} /><EnglishPrimaryLabel en="Tax-incl. subtotal" zh="含税小计" showChinese={showChinese} /></div>{items.map((item, index) => {
          const nameEn = item.nameEn?.trim();
          const descriptionEn = item.descriptionEn?.trim();
          const unitEn = item.unitLabelEn?.trim();
          return <div key={`${kind}-${index}`} className="formal-print-row grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_55px_48px_85px_80px_90px] items-start border-b border-slate-200 px-2 py-2"><span><strong className="block">{nameEn || (showChinese ? item.nameZh : "—")}</strong>{showChinese && nameEn ? <small className="block text-[9px] text-slate-500">{item.nameZh}</small> : null}</span><span>{descriptionEn || (showChinese ? item.descriptionZh : "") || "—"}{showChinese && descriptionEn && item.descriptionZh ? <small className="block text-[9px] text-slate-500">{item.descriptionZh}</small> : null}</span><span>{unitEn || (showChinese ? item.unitLabelZh : "—")}{showChinese && unitEn ? <small className="block text-[9px] text-slate-500">{item.unitLabelZh}</small> : null}</span><span>{item.quantity}</span><span className="text-right tabular-nums">{formatFormalMoney(item.unitPriceMinor)}</span><span className="text-right tabular-nums text-rose-700">−{formatFormalMoney(item.itemDiscountMinor)}</span><strong className="text-right tabular-nums">{formatFormalMoney(item.subtotalMinor)}</strong></div>;
        })}</section>;
      })}
      <div className="mt-2 overflow-hidden rounded-lg border border-slate-300 text-[10px]"><div className="grid grid-cols-3">{summaryRows.map(([en, zh, value, isDiscount], index) => <div key={en} className={`flex min-w-0 items-center justify-between gap-3 px-3 py-2 ${index < 3 ? "border-b" : ""} ${index % 3 !== 2 ? "border-r" : ""} border-slate-200`}><EnglishPrimaryLabel en={en} zh={zh} showChinese={showChinese} /><strong className={`shrink-0 tabular-nums ${isDiscount ? "text-rose-700" : ""}`}>{isDiscount ? "−" : ""}{formatFormalMoney(value)}</strong></div>)}</div><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 bg-blue-950 px-3 py-2 text-xs font-black text-white"><EnglishPrimaryLabel en="Total due (tax included)" zh="折后应收（含税）" showChinese={showChinese} /><strong className="tabular-nums">{formatFormalMoney(totals.totalDueMinor)}</strong></div><div className="flex items-center justify-between gap-6 bg-slate-50 px-3 py-1.5 text-[9px] text-slate-600"><EnglishPrimaryLabel en="Included 15% GCT" zh="其中含 15% GCT" showChinese={showChinese} /><strong className="tabular-nums">{formatFormalMoney(totals.includedGctMinor)}</strong></div></div>
    </section>
  );
}

function EnglishPrimaryLedger({ transactions, showChinese = true }: { transactions: FormalPrintableTransaction[]; showChinese?: boolean }) {
  return <section className="formal-print-section mt-4"><h2 className="border-b-2 border-slate-800 pb-1 text-sm font-black">Payment and refund history {showChinese ? <small className="ml-1 text-[9px] font-semibold text-slate-500">收付款历史</small> : null}</h2>{transactions.length === 0 ? <p className="py-3 text-slate-500">No payment or refund records {showChinese ? <small>尚无收付款记录</small> : null}</p> : <div><div className="grid grid-cols-[115px_145px_100px_minmax(0,1fr)_90px] border-b border-slate-300 py-1 text-[9px] text-slate-600"><EnglishPrimaryLabel en="Time" zh="时间" showChinese={showChinese} /><EnglishPrimaryLabel en="Reference" zh="编号" showChinese={showChinese} /><EnglishPrimaryLabel en="Method" zh="方式" showChinese={showChinese} /><EnglishPrimaryLabel en="Note" zh="备注" showChinese={showChinese} /><EnglishPrimaryLabel en="Amount" zh="金额" showChinese={showChinese} /></div>{transactions.map((item) => <div key={`${item.type}-${item.referenceNo}`} className="formal-print-row grid grid-cols-[115px_145px_100px_minmax(0,1fr)_90px] border-b border-slate-200 py-1.5"><span>{businessTime(item.occurredAt)}</span><strong>{item.referenceNo}</strong><span>{item.methodLabelEn || (showChinese ? item.methodLabelZh : "—")}{showChinese && item.methodLabelEn ? <small className="block text-[9px] text-slate-500">{item.methodLabelZh}</small> : null}</span><span>{item.note || ""}</span><strong className={`text-right ${item.type === "refund" ? "text-rose-700" : "text-emerald-700"}`}>{item.type === "refund" ? "−" : "+"}{formatFormalMoney(item.amountMinor)}</strong></div>)}</div>}</section>;
}

function EnglishPrimaryNotes({ charges, includeInternal = true, showChinese = true }: { charges: FormalPrintableCharges; includeInternal?: boolean; showChinese?: boolean }) {
  const notes = charges.notes.filter((note) => includeInternal || note.kind !== "internal");
  if (notes.length === 0) return null;
  return <section className="formal-print-section mt-4"><h2 className="border-b-2 border-slate-800 pb-1 text-sm font-black">Notes and notices {showChinese ? <small className="ml-1 text-[9px] font-semibold text-slate-500">备注、责任义务与提前告知</small> : null}</h2>{notes.map((note, index) => <article key={`${note.kind}-${index}`} className="formal-print-row grid grid-cols-[160px_minmax(0,1fr)] border-b border-slate-200 py-2"><EnglishPrimaryLabel en={NOTE_LABELS[note.kind][1]} zh={NOTE_LABELS[note.kind][0]} showChinese={showChinese} /><p className="whitespace-pre-wrap">{note.contentEn || (showChinese ? note.contentZh : "") || "—"}{showChinese && note.contentEn && note.contentZh ? <small className="mt-0.5 block text-[9px] text-slate-500">{note.contentZh}</small> : null}</p></article>)}</section>;
}

function ReceiptView({ receipt }: { receipt: FormalReceipt }) {
  const snapshot = receipt.snapshot;
  return <PrintPage backLabel="← 返回业务单" backHref={`/orders/business/${receipt.businessOrderId}`} documentNo={receipt.receiptNo} orderLabel="业务单" orderNo={snapshot.businessOrder.orderNo} printLabel="打印 / 保存 PDF" title="收款收据"><FactGrid><Fact label="费用承担方" value={localizedPartyName(snapshot.businessOrder.payerName, "zh")} /><Fact label="车辆" value={`${snapshot.businessOrder.plate} · ${snapshot.businessOrder.vehicleDescription}`} /><Fact label="车架号" value={snapshot.businessOrder.vin ?? "未记录"} /><Fact label="本次收款时间" value={businessTime(snapshot.currentPayment.paidAt)} /><Fact label="本次收款方式" value={snapshot.currentPayment.methodLabelZh} /><Fact label="收款编号" value={snapshot.currentPayment.paymentNo} /></FactGrid><ChargesTable charges={snapshot.charges} bilingual={false} /><section className="formal-print-section mt-4 rounded-xl border-2 border-blue-900 bg-blue-50 p-3"><div className="grid grid-cols-4 gap-3 text-center"><Fact label="本次收款" value={formatFormalMoney(snapshot.currentPayment.amountMinor)} /><Fact label="累计收款" value={formatFormalMoney(snapshot.totals.totalPaidMinor)} /><Fact label="累计退款" value={formatFormalMoney(snapshot.totals.totalRefundedMinor)} /><Fact label="未结余额" value={formatFormalMoney(snapshot.totals.balanceAfterMinor)} /></div>{snapshot.currentPayment.note ? <p className="mt-2 border-t border-blue-200 pt-2"><strong>本次收款备注：</strong>{snapshot.currentPayment.note}</p> : null}</section><Ledger transactions={snapshot.transactions} bilingual={false} /><Notes charges={snapshot.charges} includeInternal={false} bilingual={false} /><p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-[10px]">本收据只确认本次实际收款；收费、收付款历史和余额均冻结于出具时，补打沿用同一编号和内容。</p></PrintPage>;
}

function EnglishReceiptView({ receipt }: { receipt: FormalReceipt }) {
  const snapshot = receipt.snapshot;
  return <PrintPage backLabel="← Back to Business Order" backHref={`/orders/business/${receipt.businessOrderId}`} documentNo={receipt.receiptNo} orderNo={snapshot.businessOrder.orderNo} printLabel="Print / Save PDF" title="Receipt"><FactGrid><EnglishPrimaryFact labelEn="Payer" labelZh="费用承担方" value={localizedPartyName(snapshot.businessOrder.payerName, "en")} showChinese={false} /><EnglishPrimaryFact labelEn="Vehicle" labelZh="车辆" value={`${snapshot.businessOrder.plate} · ${snapshot.businessOrder.vehicleDescription}`} showChinese={false} />{snapshot.businessOrder.vin ? <EnglishPrimaryFact labelEn="Chassis No." labelZh="车架号" value={snapshot.businessOrder.vin} showChinese={false} /> : null}<EnglishPrimaryFact labelEn="Paid at" labelZh="本次收款时间" value={businessTime(snapshot.currentPayment.paidAt)} showChinese={false} /><EnglishPrimaryFact labelEn="Method" labelZh="本次收款方式" value={snapshot.currentPayment.methodLabelEn || "—"} showChinese={false} /><EnglishPrimaryFact labelEn="Payment No." labelZh="收款编号" value={snapshot.currentPayment.paymentNo} showChinese={false} /></FactGrid><EnglishPrimaryChargesTable charges={snapshot.charges} showChinese={false} /><section className="formal-print-section mt-4 rounded-xl border-2 border-blue-900 bg-blue-50 p-3"><div className="grid grid-cols-4 gap-3 text-center"><EnglishPrimaryFact labelEn="This payment" labelZh="本次收款" value={formatFormalMoney(snapshot.currentPayment.amountMinor)} showChinese={false} /><EnglishPrimaryFact labelEn="Total paid" labelZh="累计收款" value={formatFormalMoney(snapshot.totals.totalPaidMinor)} showChinese={false} /><EnglishPrimaryFact labelEn="Total refunded" labelZh="累计退款" value={formatFormalMoney(snapshot.totals.totalRefundedMinor)} showChinese={false} /><EnglishPrimaryFact labelEn="Outstanding" labelZh="未结余额" value={formatFormalMoney(snapshot.totals.balanceAfterMinor)} showChinese={false} /></div>{snapshot.currentPayment.note ? <p className="mt-2 border-t border-blue-200 pt-2"><strong>Payment note:</strong> {snapshot.currentPayment.note}</p> : null}</section><EnglishPrimaryLedger transactions={snapshot.transactions} showChinese={false} /><EnglishPrimaryNotes charges={snapshot.charges} includeInternal={false} showChinese={false} /><p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-[10px]">This receipt confirms only the payment shown above. Charges, payment and refund history, and the outstanding balance are frozen at the time of issue. Reprints retain the same number and content.</p></PrintPage>;
}

function LegacyOfficeView({ document, snapshot }: { document: FormalBusinessOrderDocument; snapshot: FormalOfficeArchiveSnapshot }) {
  return <PrintPage backHref={`/orders/business/${document.businessOrderId}`} documentNo={document.documentNo} orderNo={snapshot.businessOrder.orderNo} title="办公室签字留底联 / Office Signature Copy"><FactGrid><Fact label="费用承担方 / Payer" value={snapshot.businessOrder.payerName} /><Fact label="联系人 / Contact" value={snapshot.businessOrder.payerContactName ?? snapshot.businessOrder.payerPhone ?? "未记录"} /><Fact label="TRN" value={snapshot.businessOrder.payerTrn ?? "未记录"} /><Fact label="车辆 / Vehicle" value={`${snapshot.businessOrder.plate} · ${snapshot.businessOrder.vehicleDescription}`} /><Fact label="VIN" value={snapshot.businessOrder.vin ?? "未记录"} /><Fact label="生成时间 / Generated" value={businessTime(document.generatedAt)} /></FactGrid><ChargesTable charges={snapshot.charges} bilingual /><Ledger transactions={snapshot.transactions} bilingual /><div className="formal-print-section mt-3 grid grid-cols-3 gap-2"><Fact label="累计收款 / Total paid" value={formatFormalMoney(snapshot.totals.totalPaidMinor)} /><Fact label="累计退款 / Total refunded" value={formatFormalMoney(snapshot.totals.totalRefundedMinor)} /><Fact label="未结余额 / Outstanding" value={formatFormalMoney(snapshot.totals.balanceMinor)} /></div><Notes charges={snapshot.charges} includeInternal /><section className="formal-print-signature mt-5 rounded-lg border-2 border-slate-500 p-4"><p className="font-semibold">{snapshot.approval.statementZh}</p><p className="mt-1 text-slate-600">{snapshot.approval.statementEn}</p><div className="mt-8 grid grid-cols-2 gap-10"><span>客户签字 / Customer signature：________________________</span><span>日期 / Date：________________________</span></div></section></PrintPage>;
}

function EnglishPrimaryOfficeView({ document, snapshot }: { document: FormalBusinessOrderDocument; snapshot: FormalOfficeArchiveSnapshot }) {
  const contact = [snapshot.businessOrder.payerContactName, snapshot.businessOrder.payerPhone].filter(Boolean).join(" · ");
  return <PrintPage backHref={`/orders/business/${document.businessOrderId}`} documentNo={document.documentNo} orderNo={snapshot.businessOrder.orderNo} title="Office Signature Copy" titleAnnotation="办公室签字留底联"><FactGrid><EnglishPrimaryFact labelEn="Payer" labelZh="费用承担方" value={snapshot.businessOrder.payerName} />{contact ? <EnglishPrimaryFact labelEn="Contact" labelZh="联系人 / 电话" value={contact} /> : null}{snapshot.businessOrder.payerTrn ? <EnglishPrimaryFact labelEn="TRN" labelZh="纳税人登记号" value={snapshot.businessOrder.payerTrn} /> : null}<EnglishPrimaryFact labelEn="Vehicle" labelZh="车辆" value={`${snapshot.businessOrder.plate} · ${snapshot.businessOrder.vehicleDescription}`} />{snapshot.businessOrder.vin ? <EnglishPrimaryFact labelEn="Chassis No." labelZh="车架号" value={snapshot.businessOrder.vin} /> : null}<EnglishPrimaryFact labelEn="Generated" labelZh="生成时间" value={businessTime(document.generatedAt)} /></FactGrid><EnglishPrimaryChargesTable charges={snapshot.charges} /><EnglishPrimaryLedger transactions={snapshot.transactions} /><div className="formal-print-section mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-slate-300 bg-slate-300"><EnglishPrimaryFact labelEn="Total paid" labelZh="累计收款" value={formatFormalMoney(snapshot.totals.totalPaidMinor)} /><EnglishPrimaryFact labelEn="Total refunded" labelZh="累计退款" value={formatFormalMoney(snapshot.totals.totalRefundedMinor)} /><EnglishPrimaryFact labelEn="Outstanding" labelZh="未结余额" value={formatFormalMoney(snapshot.totals.balanceMinor)} /></div><EnglishPrimaryNotes charges={snapshot.charges} /><section className="formal-print-signature mt-5 rounded-lg border-2 border-slate-500 p-4"><p className="font-semibold">{snapshot.approval.statementEn}</p><p className="mt-1 text-[9px] text-slate-600">{snapshot.approval.statementZh}</p><div className="mt-8 grid grid-cols-2 gap-10"><span><strong>Customer signature:</strong> ________________________<small className="block text-[9px] text-slate-500">客户签字</small></span><span><strong>Date:</strong> ________________________<small className="block text-[9px] text-slate-500">日期</small></span></div></section></PrintPage>;
}

function MechanicView({ document, snapshot }: { document: FormalBusinessOrderDocument; snapshot: FormalMechanicWorkSnapshot }) {
  // 维修工联不得显示客户与金额；这里只消费经过正式后端脱敏的 mechanic_work 快照。
  return <PrintPage backHref={`/orders/business/${document.businessOrderId}`} documentNo={document.documentNo} orderNo={snapshot.businessOrder.orderNo} title="维修工联"><FactGrid><Fact label="车辆" value={`${snapshot.vehicle.plate} · ${snapshot.vehicle.description}`} /><Fact label="VIN" value={snapshot.vehicle.vin ?? "未记录"} /><Fact label="维修轮次" value={`第 ${snapshot.repairRound.roundNo} 轮维修`} /><Fact label="维修班组" value={snapshot.repairRound.teamName ?? "尚未派单"} /><Fact label="打印时间" value={businessTime(document.generatedAt)} /></FactGrid><section className="formal-print-section mt-4"><h2 className="border-b-2 border-slate-800 pb-1 text-sm font-black">施工项目</h2><div className="grid grid-cols-[28px_65px_minmax(150px,.9fr)_minmax(0,1.4fr)_85px] border-b border-slate-300 py-1 text-[9px] font-semibold text-slate-500"><span>完成</span><span>类别</span><span>项目名称</span><span>工作说明</span><span>数量</span></div>{snapshot.workItems.map((item, index) => <div key={`${item.kind}-${index}`} className="formal-print-row grid grid-cols-[28px_65px_minmax(150px,.9fr)_minmax(0,1.4fr)_85px] items-center border-b border-slate-200 py-2"><span className="h-4 w-4 border border-slate-700" /><span>{CATEGORY_LABELS[item.kind][0]}</span><strong>{item.nameZh}</strong><span>{item.descriptionZh || "—"}</span><span>{item.quantity} {item.unitLabelZh}</span></div>)}</section>{snapshot.notes.length > 0 ? <section className="formal-print-section mt-4"><h2 className="border-b-2 border-slate-800 pb-1 text-sm font-black">施工备注、责任义务与提前告知</h2>{snapshot.notes.map((note, index) => <div key={`${note.kind}-${index}`} className="formal-print-row grid grid-cols-[150px_minmax(0,1fr)] border-b border-slate-200 py-2"><strong>{NOTE_LABELS[note.kind][0]}</strong><span>{note.contentZh}</span></div>)}</section> : null}<section className="formal-print-signature mt-5 rounded-lg border-2 border-slate-500 p-4"><h2 className="text-sm font-black">完成情况与回单填写</h2><p className="mt-3">实际完成内容：</p><div className="h-24 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_23px,#cbd5e1_24px)]" /><div className="mt-5 grid grid-cols-2 gap-10"><span>实际维修人员：________________________</span><span>完成时间：________________________</span><span>维修工签字：________________________</span><span>前台代录人：________________________</span></div></section></PrintPage>;
}

export function FormalReceiptPrintSheet({ orderId, receiptId, copy }: { orderId: number; receiptId: number; copy: "zh" | "en" }) {
  const [receipt, setReceipt] = useState<FormalReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void fetchFormalReceipt(orderId, receiptId).then((value) => { if (active) setReceipt(value); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Receipt 加载失败"); }); return () => { active = false; }; }, [orderId, receiptId]);
  if (error) return <div className="p-8 text-sm font-semibold text-rose-700">{error}</div>;
  if (!receipt) return <div className="p-8 text-sm text-slate-500">加载 Receipt…</div>;
  return copy === "en" ? <EnglishReceiptView receipt={receipt} /> : <ReceiptView receipt={receipt} />;
}

export function FormalBusinessOrderDocumentPrintSheet({ orderId, documentId }: { orderId: number; documentId: number }) {
  const [document, setDocument] = useState<FormalBusinessOrderDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void fetchFormalDocument(orderId, documentId).then((value) => { if (active) setDocument(value); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "打印文档加载失败"); }); return () => { active = false; }; }, [documentId, orderId]);
  if (error) return <div className="p-8 text-sm font-semibold text-rose-700">{error}</div>;
  if (!document) return <div className="p-8 text-sm text-slate-500">加载打印文档…</div>;
  return document.snapshot.kind === "office_archive"
    ? formalOfficeArchiveUsesEnglishPrimary(document.snapshot)
      ? <EnglishPrimaryOfficeView document={document} snapshot={document.snapshot} />
      : <LegacyOfficeView document={document} snapshot={document.snapshot} />
    : <MechanicView document={document} snapshot={document.snapshot} />;
}
