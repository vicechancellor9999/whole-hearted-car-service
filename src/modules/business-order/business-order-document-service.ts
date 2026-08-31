import type { BusinessOrderDocumentRenderSnapshot } from "@formal/db/schema/business-order-document";
import type { ReceiptRenderSnapshot } from "@formal/db/schema/payment";
import { toBusinessDateKey } from "@formal/lib/time";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";
import { validateDocumentOverrides } from "@formal/modules/business-order/business-order-document-content";
import {
  BusinessOrderDocumentEnglishTranslationError,
  BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION,
  renderBusinessOrderDocumentPdf,
} from "@formal/modules/business-order/business-order-document-pdf";
import {
  readBusinessOrderDocumentPdf,
  removeBusinessOrderDocumentPdf,
  storeBusinessOrderDocumentPdf,
} from "@formal/modules/business-order/business-order-document-storage";

type DocumentKind = "customer_copy" | "office_archive" | "mechanic_work";

type DocumentRow = {
  id: number;
  document_no: string;
  business_order_id: number;
  kind: DocumentKind;
  charge_version_id: number;
  charge_version_no: number;
  repair_round_id: number | null;
  repair_round_no: number | null;
  render_snapshot: BusinessOrderDocumentRenderSnapshot | string;
  generated_at: Date;
  generated_by: number;
};

type RevisionRow = {
  id: number;
  document_snapshot_id: number;
  revision_no: number;
  field_overrides: Record<string, string> | string;
  renderer_version: string;
  file_id: number;
  content_sha256: string;
  english_file_id: number | null;
  english_content_sha256: string | null;
  created_at: Date;
  created_by: number;
};

type SourceRow = {
  id: number;
  order_no: string;
  vehicle_plate_snapshot: string;
  vehicle_description_snapshot: string;
  vehicle_vin_snapshot: string | null;
  payer_display_name_snapshot: string;
  payer_phone_snapshot: string | null;
  payer_trn_snapshot: string | null;
  payer_contact_name_snapshot: string | null;
  charge_version_id: number;
  charge_version_no: number;
  gross_minor: number;
  line_discount_minor: number;
  labor_discount_minor: number;
  part_discount_minor: number;
  other_discount_minor: number;
  category_discount_minor: number;
  whole_order_discount_minor: number;
  total_due_minor: number;
  included_gct_minor: number;
  repair_round_id: number;
  repair_round_no: number;
  team_name: string | null;
};

type ChargeItemRow = {
  kind: "labor" | "part" | "other";
  name_zh: string;
  name_en: string | null;
  description_zh: string | null;
  description_en: string | null;
  unit_label_zh: string;
  unit_label_en: string | null;
  quantity: string;
  unit_price_minor: number;
  item_discount_minor: number;
  subtotal_minor: number;
};

type NoteRow = {
  kind: ReceiptRenderSnapshot["charges"]["notes"][number]["kind"];
  content_zh: string | null;
  content_en: string | null;
};

type LedgerRow = {
  type: "payment" | "refund";
  reference_no: string;
  amount_minor: number;
  method_code: string;
  method_label_zh: string;
  method_label_en: string | null;
  occurred_at: Date;
  note: string | null;
  sort_id: number;
};

type ProblemDescriptionDocumentRow = {
  original_content_zh: string | null;
  original_content_en: string | null;
  original_confirmed_at: Date;
  repair_round_id: number;
  repair_round_no: number;
  round_version_id: number | null;
  round_version_no: number | null;
  round_content_zh: string | null;
  round_content_en: string | null;
};

export type BusinessOrderDocumentRecord = {
  id: number;
  documentNo: string;
  businessOrderId: number;
  kind: DocumentKind;
  chargeVersionId: number;
  chargeVersionNo: number;
  repairRoundId: number | null;
  repairRoundNo: number | null;
  snapshot: BusinessOrderDocumentRenderSnapshot;
  generatedAt: Date;
  generatedBy: number;
};

export type BusinessOrderDocumentRevisionRecord = {
  id: number;
  documentId: number;
  revisionNo: number;
  fieldOverrides: Record<string, string>;
  rendererVersion: string;
  fileId: number;
  contentSha256: string;
  englishFileId: number | null;
  englishContentSha256: string | null;
  createdAt: Date;
  createdBy: number;
};

export type BusinessOrderDocumentDetail = {
  document: BusinessOrderDocumentRecord;
  revisions: BusinessOrderDocumentRevisionRecord[];
  latestRevisionNo: number;
};

export class BusinessOrderDocumentNotFoundError extends Error {
  readonly status = 404;
  readonly code = "business_order_document_not_found";

  constructor(message = "Business Order 打印文档不存在") {
    super(message);
    this.name = "BusinessOrderDocumentNotFoundError";
  }
}

export class BusinessOrderDocumentReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "business_order_document_read_denied";

  constructor() {
    super("当前账号无权查看 Business Order 打印文档");
    this.name = "BusinessOrderDocumentReadDeniedError";
  }
}

export class BusinessOrderDocumentWriteDeniedError extends Error {
  readonly status = 403;
  readonly code = "business_order_document_write_denied";

  constructor() {
    super("只有超级管理员和前台可以生成打印文档");
    this.name = "BusinessOrderDocumentWriteDeniedError";
  }
}

export class BusinessOrderDocumentConflictError extends Error {
  readonly status = 409;
  readonly code = "business_order_document_conflict";

  constructor(message = "打印文档编号发生冲突，请重试") {
    super(message);
    this.name = "BusinessOrderDocumentConflictError";
  }
}

export class BusinessOrderDocumentRevisionConflictError extends Error {
  readonly status = 409;
  readonly code = "business_order_document_revision_conflict";
  constructor() {
    super("这份单据已产生新版本，请刷新后再保存");
    this.name = "BusinessOrderDocumentRevisionConflictError";
  }
}

export class BusinessOrderDocumentService {
  constructor(
    private readonly database: AuthSqlDatabase,
    private readonly options: { storageRoot?: string } = {},
  ) {}

  generateCustomerCopy(input: {
    businessOrderId: number;
    context: BusinessOrderActionContext;
  }) {
    return this.generate("customer_copy", input);
  }

  generateOfficeArchive(input: {
    businessOrderId: number;
    context: BusinessOrderActionContext;
  }) {
    return this.generate("office_archive", input);
  }

  generateMechanicWorkCopy(input: {
    businessOrderId: number;
    context: BusinessOrderActionContext;
  }) {
    return this.generate("mechanic_work", input);
  }

  async listForBusinessOrder(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<BusinessOrderDocumentRecord[]> {
    await requireReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<DocumentRow>(
      `${documentSelect()}
       where business_order_id = $1
       order by generated_at desc, id desc`,
      [input.businessOrderId],
    );
    return rows.map(mapDocument);
  }

  async getDocument(input: {
    documentId: number;
    viewerAccountId: number;
  }): Promise<BusinessOrderDocumentRecord> {
    await requireReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<DocumentRow>(
      `${documentSelect()} where id = $1 limit 1`,
      [input.documentId],
    );
    if (!rows[0]) throw new BusinessOrderDocumentNotFoundError();
    return mapDocument(rows[0]);
  }

  async getDocumentDetail(input: {
    documentId: number;
    viewerAccountId: number;
  }): Promise<BusinessOrderDocumentDetail> {
    const document = await this.getDocument(input);
    const revisions = (await this.database.query<RevisionRow>(
      `${revisionSelect()} where revision.document_snapshot_id = $1
       order by revision.revision_no`,
      [input.documentId],
    )).map(mapRevision);
    return { document, revisions, latestRevisionNo: revisions.at(-1)?.revisionNo ?? 0 };
  }

  async createRevision(input: {
    documentId: number;
    expectedLatestRevisionNo: number;
    fieldOverrides: unknown;
    context: BusinessOrderActionContext;
  }): Promise<BusinessOrderDocumentRevisionRecord> {
    await requireWriter(this.database, input.context.actorAccountId);
    const document = await this.getDocument({
      documentId: input.documentId,
      viewerAccountId: input.context.actorAccountId,
    });
    const overrides = validateDocumentOverrides(document.snapshot, input.fieldOverrides);
    const nextRevisionNo = input.expectedLatestRevisionNo + 1;
    let bytes: Uint8Array;
    let englishBytes: Uint8Array | null = null;
    try {
      [bytes, englishBytes] = await Promise.all([
        renderBusinessOrderDocumentPdf({
          documentNo: document.documentNo,
          revisionNo: nextRevisionNo,
          snapshot: document.snapshot,
          fieldOverrides: overrides,
          language: "zh",
        }),
        document.kind === "mechanic_work"
          ? Promise.resolve(null)
          : renderBusinessOrderDocumentPdf({
            documentNo: document.documentNo,
            revisionNo: nextRevisionNo,
            snapshot: document.snapshot,
            fieldOverrides: overrides,
            language: "en",
          }),
      ]);
    } catch (error) {
      if (error instanceof BusinessOrderDocumentEnglishTranslationError) {
        throw new BusinessOrderDocumentConflictError(error.message);
      }
      throw error;
    }
    const now = input.context.now ?? new Date();
    const [stored, englishStored] = await Promise.all([
      storeBusinessOrderDocumentPdf({
        documentNo: document.documentNo,
        revisionNo: nextRevisionNo,
        bytes,
        root: this.options.storageRoot,
        now,
        language: "zh",
      }),
      englishBytes
        ? storeBusinessOrderDocumentPdf({
          documentNo: document.documentNo,
          revisionNo: nextRevisionNo,
          bytes: englishBytes,
          root: this.options.storageRoot,
          now,
          language: "en",
        })
        : Promise.resolve(null),
    ]);
    try {
      return await this.database.transaction(async (transaction) => {
        await transaction.query(
          "lock table business_order_document_revisions in share row exclusive mode",
        );
        const latest = await transaction.query<{ latest: number }>(
          `select coalesce(max(revision_no), 0)::integer as latest
           from business_order_document_revisions where document_snapshot_id = $1`,
          [document.id],
        );
        if (Number(latest[0]?.latest ?? 0) !== input.expectedLatestRevisionNo) {
          throw new BusinessOrderDocumentRevisionConflictError();
        }
        const files = await transaction.query<{ id: number }>(
          `insert into stored_files
            (storage_key, original_name, media_type, size_bytes, sha256_hex, uploaded_by, uploaded_at)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [stored.storageKey, stored.originalName, stored.mediaType, stored.sizeBytes,
            stored.sha256Hex, input.context.actorAccountId, now],
        );
        const englishFiles = englishStored ? await transaction.query<{ id: number }>(
          `insert into stored_files
            (storage_key, original_name, media_type, size_bytes, sha256_hex, uploaded_by, uploaded_at)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [englishStored.storageKey, englishStored.originalName, englishStored.mediaType,
            englishStored.sizeBytes, englishStored.sha256Hex, input.context.actorAccountId, now],
        ) : [];
        const rows = await transaction.query<RevisionRow>(
          `insert into business_order_document_revisions
            (document_snapshot_id, revision_no, field_overrides, renderer_version,
             file_id, content_sha256, english_file_id, english_content_sha256,
             created_at, created_by)
           values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)
           returning id, document_snapshot_id, revision_no, field_overrides,
                     renderer_version, file_id, content_sha256,
                     english_file_id, english_content_sha256, created_at, created_by`,
          [document.id, nextRevisionNo, JSON.stringify(overrides),
            BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION, Number(files[0]?.id),
            stored.sha256Hex, englishStored ? Number(englishFiles[0]?.id) : null,
            englishStored?.sha256Hex ?? null, now, input.context.actorAccountId],
        );
        const revision = mapRevision(rows[0]);
        await writeAuditEvent(transaction, {
          occurredAt: now,
          actorAccountId: input.context.actorAccountId,
          eventType: "business_order.document_revision_created",
          objectType: "business_order_document",
          objectId: String(document.id),
          after: { businessOrderId: document.businessOrderId, documentNo: document.documentNo,
            revisionNo: revision.revisionNo, changedFieldCount: Object.keys(overrides).length },
          requestId: input.context.requestId,
          ipAddress: input.context.ipAddress,
          userAgent: input.context.userAgent,
        });
        return revision;
      });
    } catch (error) {
      await removeBusinessOrderDocumentPdf(stored.storageKey, this.options.storageRoot);
      if (englishStored) await removeBusinessOrderDocumentPdf(englishStored.storageKey, this.options.storageRoot);
      rethrow(error);
    }
  }

  async getRevisionFile(input: {
    documentId: number;
    revisionId: number;
    viewerAccountId: number;
    language?: "zh" | "en";
  }) {
    await requireReader(this.database, input.viewerAccountId);
    const language = input.language ?? "zh";
    const fileColumn = language === "en" ? "revision.english_file_id" : "revision.file_id";
    const rows = await this.database.query<RevisionRow & {
      storage_key: string; original_name: string; media_type: string; size_bytes: number;
    }>(
      `select revision.id, revision.document_snapshot_id, revision.revision_no,
              revision.field_overrides, revision.renderer_version, revision.file_id,
              revision.content_sha256, revision.english_file_id,
              revision.english_content_sha256, revision.created_at, revision.created_by,
              file.storage_key, file.original_name, file.media_type, file.size_bytes
       from business_order_document_revisions as revision
       join stored_files as file on file.id = ${fileColumn}
       where revision.document_snapshot_id = $1 and revision.id = $2 limit 1`,
      [input.documentId, input.revisionId],
    );
    const row = rows[0];
    if (!row) throw new BusinessOrderDocumentNotFoundError("打印文件版本不存在");
    const bytes = await readBusinessOrderDocumentPdf(row.storage_key, this.options.storageRoot);
    return { bytes, originalName: row.original_name, mediaType: row.media_type, sizeBytes: Number(row.size_bytes) };
  }

  private async generate(
    kind: DocumentKind,
    input: {
      businessOrderId: number;
      context: BusinessOrderActionContext;
    },
  ): Promise<BusinessOrderDocumentRecord> {
    if (!Number.isSafeInteger(input.businessOrderId) || input.businessOrderId <= 0) {
      throw new BusinessOrderDocumentNotFoundError();
    }
    const now = input.context.now ?? new Date();
    try {
      const document = await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        const source = await loadSource(transaction, input.businessOrderId, true);
        await transaction.query(
          "lock table business_order_document_snapshots in share row exclusive mode",
        );
        const [items, notes, ledgerRows, problemDescription] = await Promise.all([
          loadChargeItems(transaction, source.charge_version_id),
          loadNotes(transaction, source.charge_version_id),
          loadLedger(transaction, source.id),
          loadProblemDescription(transaction, source.id, source.repair_round_id),
        ]);
        const snapshot = kind === "customer_copy"
          ? buildCustomerSnapshot(source, items, notes, ledgerRows, problemDescription)
          : kind === "office_archive"
            ? buildOfficeSnapshot(source, items, notes, ledgerRows, problemDescription)
            : buildMechanicSnapshot(source, items, notes, problemDescription);
        const date = toBusinessDateKey(now).replaceAll("-", "");
        const prefixCode = kind === "customer_copy"
          ? "CUS"
          : kind === "office_archive"
            ? "OFF"
            : "MEC";
        const prefix = `${prefixCode}-${date}-`;
        const documentNo = await nextDocumentNumber(transaction, prefix);
        const rows = await transaction.query<DocumentRow>(
          `insert into business_order_document_snapshots
            (document_no, business_order_id, kind, charge_version_id,
             charge_version_no, repair_round_id, repair_round_no,
             render_snapshot, generated_at, generated_by)
           values ($1, $2, $3::business_order_document_kind, $4, $5,
                   $6, $7, $8::jsonb, $9, $10)
           returning id, document_no, business_order_id, kind,
                     charge_version_id, charge_version_no,
                     repair_round_id, repair_round_no, render_snapshot,
                     generated_at, generated_by`,
          [
            documentNo,
            source.id,
            kind,
            source.charge_version_id,
            source.charge_version_no,
            kind === "mechanic_work" ? source.repair_round_id : null,
            kind === "mechanic_work" ? source.repair_round_no : null,
            JSON.stringify(snapshot),
            now,
            input.context.actorAccountId,
          ],
        );
        const document = mapDocument(rows[0]);
        await writeAuditEvent(transaction, {
          occurredAt: now,
          actorAccountId: input.context.actorAccountId,
          eventType: "business_order.document_generated",
          objectType: "business_order_document",
          objectId: String(document.id),
          after: {
            businessOrderId: source.id,
            documentNo: document.documentNo,
            kind: document.kind,
            chargeVersionNo: document.chargeVersionNo,
            repairRoundNo: document.repairRoundNo,
          },
          requestId: input.context.requestId,
          ipAddress: input.context.ipAddress,
          userAgent: input.context.userAgent,
        });
        return document;
      });
      await this.createRevision({
        documentId: document.id,
        expectedLatestRevisionNo: 0,
        fieldOverrides: {},
        context: input.context,
      });
      return document;
    } catch (error) {
      rethrow(error);
    }
  }
}

function buildCustomerSnapshot(
  source: SourceRow,
  items: ChargeItemRow[],
  notes: NoteRow[],
  ledgerRows: LedgerRow[],
  problemDescription: ProblemDescriptionDocumentRow,
): BusinessOrderDocumentRenderSnapshot {
  const transactions = buildTransactions(ledgerRows);
  const totals = buildFinancialTotals(source, ledgerRows);
  return {
    version: 2,
    kind: "customer_copy",
    businessOrder: buildBusinessOrderSnapshot(source),
    charges: buildCharges(
      source,
      items,
      notes.filter((note) => note.kind !== "internal"),
    ),
    transactions,
    totals,
    problemDescription: buildCustomerProblemDescription(problemDescription),
    approval: {
      statementZh: "客户签字表示已阅读并认可本联所列施工、收费、金额、备注及提前告知内容。",
      statementEn: "The customer's signature confirms review and acceptance of the work, charges, amounts, notes and advance notices shown on this copy.",
    },
  };
}

function buildOfficeSnapshot(
  source: SourceRow,
  items: ChargeItemRow[],
  notes: NoteRow[],
  ledgerRows: LedgerRow[],
  problemDescription: ProblemDescriptionDocumentRow,
): BusinessOrderDocumentRenderSnapshot {
  const transactions = buildTransactions(ledgerRows);
  const totals = buildFinancialTotals(source, ledgerRows);
  return {
    version: 2,
    kind: "office_archive",
    presentation: "office_english_primary_v1",
    businessOrder: buildBusinessOrderSnapshot(source),
    charges: buildCharges(source, items, notes),
    transactions,
    totals,
    problemDescription: buildCustomerProblemDescription(problemDescription),
    approval: {
      statementZh: "客户签字表示已阅读并认可本联所列收费项目、金额、备注及提前告知内容。",
      statementEn: "The customer's signature confirms review and acceptance of the charges, amounts, notes and advance notices shown on this copy.",
    },
  };
}

function buildTransactions(ledgerRows: LedgerRow[]) {
  return ledgerRows.map((row) => ({
    type: row.type,
    referenceNo: row.reference_no,
    amountMinor: Number(row.amount_minor),
    methodCode: row.method_code,
    methodLabelZh: row.method_label_zh,
    methodLabelEn: row.method_label_en,
    occurredAt: new Date(row.occurred_at).toISOString(),
    note: row.note,
  }));
}

function buildFinancialTotals(source: SourceRow, ledgerRows: LedgerRow[]) {
  const totalPaidMinor = ledgerRows
    .filter((row) => row.type === "payment")
    .reduce((total, row) => total + Number(row.amount_minor), 0);
  const totalRefundedMinor = ledgerRows
    .filter((row) => row.type === "refund")
    .reduce((total, row) => total + Number(row.amount_minor), 0);
  return {
    currentDueMinor: Number(source.total_due_minor),
    totalPaidMinor,
    totalRefundedMinor,
    balanceMinor: Number(source.total_due_minor) - totalPaidMinor + totalRefundedMinor,
  };
}

function buildBusinessOrderSnapshot(source: SourceRow) {
  return {
    id: Number(source.id),
    orderNo: source.order_no,
    plate: source.vehicle_plate_snapshot,
    vehicleDescription: source.vehicle_description_snapshot,
    vin: source.vehicle_vin_snapshot,
    payerName: source.payer_display_name_snapshot,
    payerPhone: source.payer_phone_snapshot,
    payerTrn: source.payer_trn_snapshot,
    payerContactName: source.payer_contact_name_snapshot,
  };
}

function buildMechanicSnapshot(
  source: SourceRow,
  items: ChargeItemRow[],
  notes: NoteRow[],
  problemDescription: ProblemDescriptionDocumentRow,
): BusinessOrderDocumentRenderSnapshot {
  const original = {
    contentZh: problemDescription.original_content_zh,
    contentEn: problemDescription.original_content_en,
    confirmedAt: new Date(problemDescription.original_confirmed_at).toISOString(),
  };
  const round = problemDescription.round_version_id === null ? null : {
    scope: "repair_round" as const,
    repairRoundId: Number(problemDescription.repair_round_id),
    roundNo: problemDescription.repair_round_no,
    versionId: Number(problemDescription.round_version_id),
    versionNo: Number(problemDescription.round_version_no),
    contentZh: problemDescription.round_content_zh,
  };
  const sameAsOriginal = normalizedProblemText(round?.contentZh)
    === normalizedProblemText(original.contentZh);
  return {
    version: 2,
    kind: "mechanic_work",
    businessOrder: { id: Number(source.id), orderNo: source.order_no },
    vehicle: {
      plate: source.vehicle_plate_snapshot,
      description: source.vehicle_description_snapshot,
      vin: source.vehicle_vin_snapshot,
    },
    repairRound: {
      id: Number(source.repair_round_id),
      roundNo: source.repair_round_no,
      teamName: source.team_name,
    },
    problemDescription: {
      primary: round ?? {
        scope: "business_order_original",
        repairRoundId: null,
        roundNo: null,
        versionId: null,
        versionNo: null,
        contentZh: original.contentZh,
      },
      originalContext: sameAsOriginal ? null : original,
    },
    workItems: items.map((item) => ({
      kind: item.kind,
      nameZh: item.name_zh,
      descriptionZh: item.description_zh,
      unitLabelZh: item.unit_label_zh,
      quantity: item.quantity,
    })),
    notes: notes.flatMap((note) => {
      if (note.kind === "internal" || !note.content_zh?.trim()) return [];
      return [{
        kind: note.kind,
        contentZh: note.content_zh,
      }];
    }),
  };
}

function normalizedProblemText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function buildCustomerProblemDescription(row: ProblemDescriptionDocumentRow) {
  return {
    original: {
      contentZh: row.original_content_zh,
      contentEn: row.original_content_en,
      confirmedAt: new Date(row.original_confirmed_at).toISOString(),
    },
    repairRound: row.round_version_id === null ? null : {
      repairRoundId: Number(row.repair_round_id),
      roundNo: row.repair_round_no,
      versionId: Number(row.round_version_id),
      versionNo: Number(row.round_version_no),
      contentZh: row.round_content_zh,
      contentEn: row.round_content_en,
    },
  };
}

function buildCharges(
  source: SourceRow,
  items: ChargeItemRow[],
  notes: NoteRow[],
): ReceiptRenderSnapshot["charges"] {
  return {
    versionNo: source.charge_version_no,
    totals: {
      grossMinor: Number(source.gross_minor),
      lineDiscountMinor: Number(source.line_discount_minor),
      laborDiscountMinor: Number(source.labor_discount_minor),
      partDiscountMinor: Number(source.part_discount_minor),
      otherDiscountMinor: Number(source.other_discount_minor),
      categoryDiscountMinor: Number(source.category_discount_minor),
      wholeOrderDiscountMinor: Number(source.whole_order_discount_minor),
      totalDueMinor: Number(source.total_due_minor),
      includedGctMinor: Number(source.included_gct_minor),
    },
    items: items.map((item) => ({
      kind: item.kind,
      nameZh: item.name_zh,
      nameEn: item.name_en,
      descriptionZh: item.description_zh,
      descriptionEn: item.description_en,
      unitLabelZh: item.unit_label_zh,
      unitLabelEn: item.unit_label_en,
      quantity: item.quantity,
      unitPriceMinor: Number(item.unit_price_minor),
      itemDiscountMinor: Number(item.item_discount_minor),
      subtotalMinor: Number(item.subtotal_minor),
    })),
    notes: notes.map((note) => ({
      kind: note.kind,
      contentZh: note.content_zh,
      contentEn: note.content_en,
    })),
  };
}

async function loadSource(
  executor: AuthSqlExecutor,
  businessOrderId: number,
  lock: boolean,
): Promise<SourceRow> {
  const rows = await executor.query<SourceRow>(
    `select business_order.id, business_order.order_no,
            business_order.vehicle_plate_snapshot,
            business_order.vehicle_description_snapshot,
            business_order.vehicle_vin_snapshot,
            business_order.payer_display_name_snapshot,
            business_order.payer_phone_snapshot,
            business_order.payer_trn_snapshot,
            business_order.payer_contact_name_snapshot,
            charge.id as charge_version_id,
            charge.version_no as charge_version_no,
            charge.gross_minor, charge.line_discount_minor,
            charge.labor_discount_minor, charge.part_discount_minor,
            charge.other_discount_minor, charge.category_discount_minor,
            charge.whole_order_discount_minor, charge.total_due_minor,
            charge.included_gct_minor,
            repair_round.id as repair_round_id,
            repair_round.round_no as repair_round_no,
            team.name as team_name
     from business_orders as business_order
     join business_order_charge_versions as charge
       on charge.business_order_id = business_order.id
      and charge.version_no = business_order.current_charge_version_no
     join repair_rounds as repair_round
       on repair_round.business_order_id = business_order.id
      and repair_round.round_no = business_order.current_repair_round_no
     left join repair_teams as team on team.id = repair_round.assigned_team_id
     where business_order.id = $1
     ${lock ? "for update of business_order" : ""}`,
    [businessOrderId],
  );
  if (!rows[0]) {
    throw new BusinessOrderDocumentNotFoundError(
      "Business Order、当前收费版本或维修轮次不存在",
    );
  }
  return rows[0];
}

async function loadChargeItems(executor: AuthSqlExecutor, chargeVersionId: number) {
  return executor.query<ChargeItemRow>(
    `select item.kind, item.name_zh, item.name_en,
            item.description_zh, item.description_en,
            unit.label_zh as unit_label_zh, unit.label_en as unit_label_en,
            item.quantity::text as quantity, item.unit_price_minor,
            item.item_discount_minor, item.subtotal_minor
     from business_order_charge_items as item
     join dictionary_items as unit on unit.id = item.unit_item_id
     where item.charge_version_id = $1
     order by item.sort_order, item.id`,
    [chargeVersionId],
  );
}

async function loadNotes(executor: AuthSqlExecutor, chargeVersionId: number) {
  return executor.query<NoteRow>(
    `select kind, content_zh, content_en
     from business_order_notes
     where charge_version_id = $1
     order by sort_order, id`,
    [chargeVersionId],
  );
}

async function loadLedger(executor: AuthSqlExecutor, businessOrderId: number) {
  return executor.query<LedgerRow>(
    `select 'payment'::text as type, payment.payment_no as reference_no,
            payment.amount_minor,
            payment.payment_method_code_snapshot as method_code,
            payment.payment_method_label_zh_snapshot as method_label_zh,
            payment.payment_method_label_en_snapshot as method_label_en,
            payment.paid_at as occurred_at, payment.note, payment.id as sort_id
     from business_order_payments as payment
     where payment.business_order_id = $1
     union all
     select 'refund'::text as type, refund.refund_no as reference_no,
            refund.amount_minor,
            refund.payment_method_code_snapshot as method_code,
            refund.payment_method_label_zh_snapshot as method_label_zh,
            refund.payment_method_label_en_snapshot as method_label_en,
            refund.refunded_at as occurred_at, refund.reason as note,
            refund.id as sort_id
     from business_order_refunds as refund
     where refund.business_order_id = $1
     order by occurred_at, type, sort_id`,
    [businessOrderId],
  );
}

async function loadProblemDescription(
  executor: AuthSqlExecutor,
  businessOrderId: number,
  repairRoundId: number,
): Promise<ProblemDescriptionDocumentRow> {
  const rows = await executor.query<ProblemDescriptionDocumentRow>(
    `select original.content_zh as original_content_zh,
            original.content_en as original_content_en,
            original.confirmed_at as original_confirmed_at,
            round.id as repair_round_id, round.round_no as repair_round_no,
            version.id as round_version_id,
            version.version_no as round_version_no,
            version.content_zh as round_content_zh,
            version.content_en as round_content_en
     from business_order_problem_originals as original
     join repair_rounds as round on round.id = $2
       and round.business_order_id = original.business_order_id
     left join repair_round_problem_versions as version
       on version.repair_round_id = round.id
      and version.version_no = round.current_problem_description_version_no
     where original.business_order_id = $1
     limit 1`,
    [businessOrderId, repairRoundId],
  );
  if (!rows[0]) {
    throw new BusinessOrderDocumentNotFoundError("Business Order 问题描述上下文不存在");
  }
  return rows[0];
}

async function nextDocumentNumber(executor: AuthSqlExecutor, prefix: string) {
  const rows = await executor.query<{ current_number: number }>(
    `select coalesce(max(right(document_no, 4)::integer), 0)::integer as current_number
     from business_order_document_snapshots where document_no like $1`,
    [`${prefix}%`],
  );
  const next = Number(rows[0]?.current_number ?? 0) + 1;
  if (next > 9_999) {
    throw new BusinessOrderDocumentConflictError("当天打印文档编号已用尽");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function documentSelect() {
  return `select id, document_no, business_order_id, kind,
                 charge_version_id, charge_version_no,
                 repair_round_id, repair_round_no, render_snapshot,
                 generated_at, generated_by
          from business_order_document_snapshots`;
}

function revisionSelect() {
  return `select revision.id, revision.document_snapshot_id, revision.revision_no,
                 revision.field_overrides, revision.renderer_version, revision.file_id,
                 revision.content_sha256, revision.english_file_id,
                 revision.english_content_sha256, revision.created_at, revision.created_by
          from business_order_document_revisions as revision`;
}

function mapDocument(row: DocumentRow | undefined): BusinessOrderDocumentRecord {
  if (!row) throw new Error("打印文档写入后无法读取");
  return {
    id: Number(row.id),
    documentNo: row.document_no,
    businessOrderId: Number(row.business_order_id),
    kind: row.kind,
    chargeVersionId: Number(row.charge_version_id),
    chargeVersionNo: row.charge_version_no,
    repairRoundId: row.repair_round_id === null ? null : Number(row.repair_round_id),
    repairRoundNo: row.repair_round_no,
    snapshot: typeof row.render_snapshot === "string"
      ? JSON.parse(row.render_snapshot) as BusinessOrderDocumentRenderSnapshot
      : row.render_snapshot,
    generatedAt: new Date(row.generated_at),
    generatedBy: Number(row.generated_by),
  };
}

function mapRevision(row: RevisionRow | undefined): BusinessOrderDocumentRevisionRecord {
  if (!row) throw new Error("打印版本写入后无法读取");
  return {
    id: Number(row.id), documentId: Number(row.document_snapshot_id),
    revisionNo: Number(row.revision_no),
    fieldOverrides: typeof row.field_overrides === "string"
      ? JSON.parse(row.field_overrides) as Record<string, string>
      : row.field_overrides,
    rendererVersion: row.renderer_version, fileId: Number(row.file_id),
    contentSha256: row.content_sha256,
    englishFileId: row.english_file_id === null ? null : Number(row.english_file_id),
    englishContentSha256: row.english_content_sha256,
    createdAt: new Date(row.created_at),
    createdBy: Number(row.created_by),
  };
}

async function requireReader(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ allowed: boolean }>(
    `select true as allowed from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk', 'owner')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new BusinessOrderDocumentReadDeniedError();
}

async function requireWriter(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ allowed: boolean }>(
    `select true as allowed from staff_accounts
     where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk')
     limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new BusinessOrderDocumentWriteDeniedError();
}

function rethrow(error: unknown): never {
  if (
    error instanceof BusinessOrderDocumentNotFoundError ||
    error instanceof BusinessOrderDocumentReadDeniedError ||
    error instanceof BusinessOrderDocumentWriteDeniedError ||
    error instanceof BusinessOrderDocumentConflictError ||
    error instanceof BusinessOrderDocumentRevisionConflictError
  ) {
    throw error;
  }
  if (databaseErrorCode(error) === "23505") {
    throw new BusinessOrderDocumentConflictError();
  }
  throw error;
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}
