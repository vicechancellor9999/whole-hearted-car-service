import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PrintButton } from "@/app/(protected)/business-orders/[businessOrderId]/print-button";
import { currentSession } from "@/modules/auth/current-session";
import {
  BusinessOrderDocumentNotFoundError,
  type BusinessOrderDocumentRecord,
} from "@/modules/business-order/business-order-document-service";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import { requirePermission } from "@/modules/permissions/require-permission";

const categoryLabels = {
  labor: ["工时", "Labor"],
  part: ["配件", "Parts"],
  other: ["其他费用", "Other charges"],
} as const;

const noteLabels = {
  customer_concern: ["客户诉求", "Customer concern"],
  work_instruction: ["工作说明", "Work instruction"],
  liability_notice: ["责任义务与提前告知", "Liability and advance notice"],
  internal: ["办公室内部备注", "Office internal note"],
} as const;

function money(value: number) {
  return `JMD ${(value / 100).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function businessTime(value: Date | string) {
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

export function BusinessOrderDocumentView({
  document,
}: {
  document: BusinessOrderDocumentRecord;
}) {
  return document.snapshot.kind === "office_archive"
    ? <OfficeArchiveCopy document={document} snapshot={document.snapshot} />
    : <MechanicWorkCopy document={document} snapshot={document.snapshot} />;
}

function DocumentToolbar({
  businessOrderId,
  chineseOnly = false,
}: {
  businessOrderId: number;
  chineseOnly?: boolean;
}) {
  return (
    <nav className="document-toolbar">
      <Link href={`/business-orders/${businessOrderId}`}>Business Order 详情</Link>
      <PrintButton label={chineseOnly ? "打印" : undefined} />
    </nav>
  );
}

function BrandHeader({
  documentNo,
  orderNo,
  showCompanyName = true,
  title,
}: {
  documentNo: string;
  orderNo: string;
  showCompanyName?: boolean;
  title: string;
}) {
  return (
    <header className="document-header">
      <div className="document-brand">
        <Image
          alt="Whole Hearted Car Service Logo"
          className="document-logo"
          height={54}
          src="/brand-logo-wh-512.png"
          width={54}
        />
        <span>{showCompanyName ? <p>Whole Hearted Car Service Limited</p> : null}<h1>{title}</h1></span>
      </div>
      <div><strong>{documentNo}</strong><span>Business Order: {orderNo}</span></div>
    </header>
  );
}

function OfficeArchiveCopy({
  document,
  snapshot,
}: {
  document: BusinessOrderDocumentRecord;
  snapshot: Extract<BusinessOrderDocumentRecord["snapshot"], { kind: "office_archive" }>;
}) {
  return (
    <main className="document-page office-archive-document">
      <DocumentToolbar businessOrderId={document.businessOrderId} />
      <BrandHeader
        documentNo={document.documentNo}
        orderNo={snapshot.businessOrder.orderNo}
        title="办公室留底联 / Office Archive Copy"
      />
      <section className="document-facts">
        <span>费用承担方 / Payer<strong>{snapshot.businessOrder.payerName}</strong></span>
        <span>联系方式 / Contact<strong>{snapshot.businessOrder.payerContactName ?? snapshot.businessOrder.payerPhone ?? "—"}</strong></span>
        <span>TRN<strong>{snapshot.businessOrder.payerTrn ?? "—"}</strong></span>
        <span>车辆 / Vehicle<strong>{snapshot.businessOrder.plate} · {snapshot.businessOrder.vehicleDescription}</strong></span>
        <span>VIN<strong>{snapshot.businessOrder.vin ?? "—"}</strong></span>
        <span>生成时间 / Generated at<strong>{businessTime(document.generatedAt)}</strong></span>
      </section>

      <section className="document-section">
        <h2>收费项目 / Charges</h2>
        {(Object.keys(categoryLabels) as Array<keyof typeof categoryLabels>).map((kind) => {
          const items = snapshot.charges.items.filter((item) => item.kind === kind);
          if (items.length === 0) return null;
          return (
            <section className="document-charge-group" key={kind}>
              <h3>{categoryLabels[kind][0]} / {categoryLabels[kind][1]}</h3>
              {items.map((item, index) => (
                <div className="document-charge-row" key={`${kind}-${index}`}>
                  <span>
                    <strong>{item.nameZh}{item.nameEn ? ` / ${item.nameEn}` : ""}</strong>
                    <small>{item.descriptionZh}{item.descriptionEn ? ` / ${item.descriptionEn}` : ""}</small>
                  </span>
                  <span>{item.quantity} {item.unitLabelZh}{item.unitLabelEn ? ` / ${item.unitLabelEn}` : ""}</span>
                  <span>{money(item.unitPriceMinor)}<small>含税单价 / Tax-included unit price</small></span>
                  <strong>{money(item.subtotalMinor)}<small>{item.itemDiscountMinor > 0 ? `本项折扣 ${money(item.itemDiscountMinor)}` : ""}</small></strong>
                </div>
              ))}
            </section>
          );
        })}
        <div className="document-totals office-totals">
          <span>原价合计 / Gross total<strong>{money(snapshot.charges.totals.grossMinor)}</strong></span>
          <span>本项折扣 / Item discounts<strong>{money(snapshot.charges.totals.lineDiscountMinor)}</strong></span>
          <span>工时折扣 / Labor discount<strong>{money(snapshot.charges.totals.laborDiscountMinor)}</strong></span>
          <span>配件折扣 / Parts discount<strong>{money(snapshot.charges.totals.partDiscountMinor)}</strong></span>
          <span>其他费用折扣 / Other discount<strong>{money(snapshot.charges.totals.otherDiscountMinor)}</strong></span>
          <span>整单折扣 / Whole-order discount<strong>{money(snapshot.charges.totals.wholeOrderDiscountMinor)}</strong></span>
          <span>折后应收（含税）/ Total due<strong>{money(snapshot.charges.totals.totalDueMinor)}</strong></span>
          <span>其中含 15% GCT / Included 15% GCT<strong>{money(snapshot.charges.totals.includedGctMinor)}</strong></span>
        </div>
      </section>

      <section className="document-section">
        <h2>收付款历史 / Payment and refund history</h2>
        {snapshot.transactions.length === 0 ? <p>尚无收付款记录 / No transactions</p> : (
          <div className="document-ledger">
            {snapshot.transactions.map((transaction) => (
              <div key={`${transaction.type}-${transaction.referenceNo}`}>
                <span>{businessTime(transaction.occurredAt)}</span>
                <strong>{transaction.referenceNo}</strong>
                <span>{transaction.methodLabelZh}{transaction.methodLabelEn ? ` / ${transaction.methodLabelEn}` : ""}</span>
                <b>{transaction.type === "refund" ? "−" : "+"}{money(transaction.amountMinor)}</b>
              </div>
            ))}
          </div>
        )}
        <div className="document-totals">
          <span>累计收款 / Total paid<strong>{money(snapshot.totals.totalPaidMinor)}</strong></span>
          <span>累计退款 / Total refunded<strong>{money(snapshot.totals.totalRefundedMinor)}</strong></span>
          <span>未结余额 / Outstanding balance<strong>{money(snapshot.totals.balanceMinor)}</strong></span>
        </div>
      </section>

      {snapshot.charges.notes.length > 0 ? (
        <section className="document-section">
          <h2>备注、责任义务与提前告知 / Notes and notices</h2>
          {snapshot.charges.notes.map((note, index) => (
            <article className="document-note" key={`${note.kind}-${index}`}>
              <strong>{noteLabels[note.kind][0]} / {noteLabels[note.kind][1]}</strong>
              <p>{note.contentZh}{note.contentEn ? `\n${note.contentEn}` : ""}</p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="document-approval">
        <p>{snapshot.approval.statementZh}</p>
        <p>{snapshot.approval.statementEn}</p>
        <div>
          <span>客户签字 / Customer signature<strong>____________________________</strong></span>
          <span>签字日期 / Date<strong>____________________________</strong></span>
        </div>
      </section>
      <footer className="document-footer"><span>本联为生成当时的不可修改快照 / Immutable snapshot at generation</span><span>{document.documentNo}</span></footer>
    </main>
  );
}

function MechanicWorkCopy({
  document,
  snapshot,
}: {
  document: BusinessOrderDocumentRecord;
  snapshot: Extract<BusinessOrderDocumentRecord["snapshot"], { kind: "mechanic_work" }>;
}) {
  return (
    <main className="document-page mechanic-work-document">
      <DocumentToolbar businessOrderId={document.businessOrderId} chineseOnly />
      <BrandHeader
        documentNo={document.documentNo}
        orderNo={snapshot.businessOrder.orderNo}
        showCompanyName={false}
        title="维修工联"
      />
      <section className="document-facts">
        <span>车辆<strong>{snapshot.vehicle.plate} · {snapshot.vehicle.description}</strong></span>
        <span>VIN<strong>{snapshot.vehicle.vin ?? "未记录"}</strong></span>
        <span>维修轮次与班组<strong>第 {snapshot.repairRound.roundNo} 轮维修 · {snapshot.repairRound.teamName ?? "尚未派单"}</strong></span>
        <span>打印时间<strong>{businessTime(document.generatedAt)}</strong></span>
      </section>

      <section className="document-section">
        <h2>施工项目</h2>
        {snapshot.workItems.length === 0 ? <p>尚未填写施工项目。</p> : (
          <div className="mechanic-work-items">
            {snapshot.workItems.map((item, index) => (
              <article key={`${item.kind}-${index}`}>
                <span>{categoryLabels[item.kind][0]}</span>
                <strong>{item.nameZh}</strong>
                <p>{item.descriptionZh ?? "—"}</p>
                <b>{item.quantity} {item.unitLabelZh}</b>
              </article>
            ))}
          </div>
        )}
      </section>

      {snapshot.notes.length > 0 ? (
        <section className="document-section">
          <h2>施工备注与提前告知</h2>
          {snapshot.notes.map((note, index) => (
            <article className="document-note" key={`${note.kind}-${index}`}>
              <strong>{noteLabels[note.kind][0]}</strong><p>{note.contentZh}</p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="mechanic-return-section">
        <h2>回单填写</h2>
        <label>回单工作内容<span /></label>
        <div><label>实际维修工<strong>____________________</strong></label><label>完成时间<strong>____________________</strong></label></div>
        <label>维修工签名<strong>____________________________</strong></label>
      </section>
      <footer className="document-footer"><span>本联用于车辆施工与回单记录。</span><span>{document.documentNo}</span></footer>
    </main>
  );
}

export default async function BusinessOrderDocumentPage({ params }: {
  params: Promise<{ businessOrderId: string; documentId: string }>;
}) {
  await connection();
  const [session, route] = await Promise.all([currentSession(), params]);
  const viewer = requirePermission(session, "business.read.all");
  const businessOrderId = Number(route.businessOrderId);
  const documentId = Number(route.documentId);
  if (!Number.isSafeInteger(businessOrderId) || !Number.isSafeInteger(documentId)) notFound();
  const runtime = createBusinessOrderRuntime();
  try {
    let document: BusinessOrderDocumentRecord;
    try {
      document = await runtime.documents.getDocument({
        documentId,
        viewerAccountId: viewer.id,
      });
    } catch (error) {
      if (error instanceof BusinessOrderDocumentNotFoundError) notFound();
      throw error;
    }
    if (document.businessOrderId !== businessOrderId) notFound();
    return <BusinessOrderDocumentView document={document} />;
  } finally {
    await runtime.close();
  }
}
