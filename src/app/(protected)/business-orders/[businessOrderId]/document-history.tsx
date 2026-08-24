import Link from "next/link";
import type { BusinessOrderDocumentRecord } from "@/modules/business-order/business-order-document-service";

type FormAction = (formData: FormData) => void | Promise<void>;

const kindLabels = {
  office_archive: "办公室留底联",
  mechanic_work: "维修工联",
} as const;

export function DocumentHistory({
  action,
  businessOrderId,
  canGenerate,
  documents,
}: {
  action: FormAction;
  businessOrderId: number;
  canGenerate: boolean;
  documents: BusinessOrderDocumentRecord[];
}) {
  return (
    <section aria-label="Business Order 打印文档" className="bo-panel bo-document-panel">
      <header className="bo-panel-heading">
        <div>
          <h2>办公室留底联与维修工联</h2>
          <p>每次生成都冻结当时内容；打开旧记录即为补打，不重算。</p>
        </div>
        {canGenerate ? (
          <div className="bo-document-actions">
            <form action={action}>
              <input name="operation" type="hidden" value="generate_office_archive" />
              <input name="businessOrderId" type="hidden" value={businessOrderId} />
              <button type="submit">生成办公室留底联</button>
            </form>
            <form action={action}>
              <input name="operation" type="hidden" value="generate_mechanic_work" />
              <input name="businessOrderId" type="hidden" value={businessOrderId} />
              <button type="submit">生成维修工联</button>
            </form>
          </div>
        ) : null}
      </header>
      {documents.length === 0 ? (
        <p className="record-empty">尚未生成办公室留底联或维修工联。</p>
      ) : (
        <div className="bo-document-history">
          {documents.map((document) => (
            <article key={document.id}>
              <span>
                <strong>{document.documentNo}</strong>
                <small>{kindLabels[document.kind]} · 收费版本 {document.chargeVersionNo}</small>
              </span>
              <span>
                {new Intl.DateTimeFormat("zh-CN", {
                  timeZone: "America/Jamaica",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(document.generatedAt)}
              </span>
              <Link href={`/business-orders/${businessOrderId}/documents/${document.id}`}>
                打开 / 补打
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
