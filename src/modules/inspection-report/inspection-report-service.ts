import { toBusinessDateKey } from "@formal/lib/time";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";
import {
  buildInspectionOriginalQuotationText,
  deriveInspectionFollowupStage,
  deriveOriginalInspectionQuotation,
  type InspectionFollowupStage,
} from "@formal/modules/inspection-report/inspection-report-derivation";

type FindingInput = {
  findingZh: string;
  findingEn?: string | null;
  recommendationZh?: string | null;
  recommendationEn?: string | null;
};

type ParsedFinding = {
  findingZh: string;
  findingEn: string | null;
  recommendationZh: string | null;
  recommendationEn: string | null;
};

type InspectionReportRow = {
  id: number;
  report_no: string;
  vehicle_id: number;
  source_business_order_id: number | null;
  source_repair_round_id: number | null;
  correction_of_report_id: number | null;
  correction_reason: string | null;
  summary_zh: string;
  summary_en: string | null;
  inspection_team_id: number;
  actual_inspector_staff_member_id: number | null;
  special_case_notes_zh: string | null;
  paper_photo_file_id: number | null;
  status: "draft" | "submitted";
  created_at: Date;
  created_by: number;
  submitted_at: Date | null;
  submitted_by: number | null;
  version: number;
  current_workspace_version_no: number;
};

type InspectionReportListRow = InspectionReportRow & {
  vehicle_plate_display: string | null;
  vehicle_make: string;
  vehicle_make_zh: string | null;
  vehicle_model: string;
  vehicle_model_zh: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_whatsapp: string | null;
  customer_email: string | null;
  inspector_name: string | null;
  team_name: string;
  source_business_order_no: string | null;
  latest_communication_status: "initiated" | "confirmed" | "not_delivered" | null;
};

export type InspectionReportRecord = {
  id: number;
  reportNo: string;
  vehicleId: number;
  sourceBusinessOrderId: number | null;
  sourceRepairRoundId: number | null;
  correctionOfReportId: number | null;
  correctionReason: string | null;
  summaryZh: string;
  summaryEn: string | null;
  inspectionTeamId: number;
  actualInspectorStaffMemberId: number | null;
  specialCaseNotesZh: string | null;
  paperPhotoFileId: number | null;
  status: "draft" | "submitted";
  createdAt: Date;
  createdBy: number;
  submittedAt: Date | null;
  submittedBy: number | null;
  version: number;
  currentWorkspaceVersionNo?: number;
  findings: Array<ParsedFinding & { id: number; sortOrder: number }>;
};

export type InspectionReportOrganizedContent = {
  summaryZh: string;
  summaryEn: string | null;
  specialCaseNotesZh: string | null;
  specialCaseNotesEn?: string | null;
  findings: ParsedFinding[];
};

export type InspectionReportQuotation = {
  status: "pending" | "entered" | "not_quoted";
  noteZh: string | null;
  noteEn: string | null;
  wholeOrderDiscountMinor?: number;
  lines: Array<{
    kind: "labor" | "part" | "other";
    nameZh: string;
    nameEn: string | null;
    descriptionZh: string | null;
    descriptionEn: string | null;
    quantity: string;
    unitPriceMinor: number | null;
    itemDiscountMinor?: number;
    subtotalMinor: number | null;
  }>;
};

export type InspectionReportWorkspaceVersion = {
  versionNo: number;
  source: "original" | "manual" | "ai";
  changeReason: string;
  createdAt: Date;
  createdBy: number;
  organized: InspectionReportOrganizedContent;
  quotation: InspectionReportQuotation;
};

export type InspectionReportListItem = {
  report: InspectionReportRecord;
  vehicle: {
    id: number;
    plate: string;
    description: string;
    descriptionZh: string;
    descriptionEn: string;
  };
  customer: {
    name: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
  };
  inspectorName: string | null;
  teamName: string;
  sourceBusinessOrder: { id: number; orderNo: string } | null;
  followupStage: InspectionFollowupStage;
};

export type InspectionReportDetailItem = InspectionReportListItem & {
  workspace: InspectionReportWorkspaceVersion;
};

export type InspectionReportCommunicationRecord = {
  id: number;
  inspectionReportId: number;
  vehicleId: number;
  sourceBusinessOrderId: number | null;
  channel: "sms" | "email" | "whatsapp";
  targetContact: string;
  initiatedAt: Date;
  initiatedBy: number;
  status: "initiated" | "confirmed" | "not_delivered";
  noteOrReply: string | null;
};

export class InspectionReportValidationError extends Error {
  readonly status = 422;
  readonly code = "inspection_report_validation";

  constructor(message: string) {
    super(message);
    this.name = "InspectionReportValidationError";
  }
}

export class InspectionReportNotFoundError extends Error {
  readonly status = 404;
  readonly code = "inspection_report_not_found";

  constructor(message = "Inspection Report 不存在") {
    super(message);
    this.name = "InspectionReportNotFoundError";
  }
}

export class InspectionReportAccessDeniedError extends Error {
  readonly status = 403;
  readonly code = "inspection_report_access_denied";

  constructor(message = "当前账号不能执行这项 Inspection Report 操作") {
    super(message);
    this.name = "InspectionReportAccessDeniedError";
  }
}

export class InspectionReportService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async createInspectionReport(input: {
    vehicleId: number;
    sourceBusinessOrderId?: number | null;
    sourceRepairRoundId?: number | null;
    inspectionTeamId: number;
    actualInspectorStaffMemberId?: number | null;
    paperPhotoFileId?: number | null;
    specialCaseNotesZh?: string | null;
    summaryZh: string;
    summaryEn?: string | null;
    findings: FindingInput[];
    context: BusinessOrderActionContext;
  }): Promise<InspectionReportRecord> {
    const fields = parseDraftInput(input);
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireReportWriter(
        transaction,
        input.context.actorAccountId,
        fields.inspectionTeamId,
        fields.actualInspectorStaffMemberId,
      );
      await validateReportLinks(transaction, fields);
      await transaction.query("lock table inspection_reports in share row exclusive mode");
      const report = await insertDraft(transaction, {
        ...fields,
        reportNo: await nextReportNumber(transaction, now),
        correctionOfReportId: null,
        correctionReason: null,
        createdBy: input.context.actorAccountId,
        createdAt: now,
      });
      await audit(transaction, input.context, now, "inspection_report.created", report.id, {
        reportNo: report.reportNo,
        vehicleId: report.vehicleId,
        sourceBusinessOrderId: report.sourceBusinessOrderId,
        sourceRepairRoundId: report.sourceRepairRoundId,
        inspectionTeamId: report.inspectionTeamId,
      });
      return report;
    });
  }

  async submitInspectionReport(input: {
    inspectionReportId: number;
    expectedVersion: number;
    context: BusinessOrderActionContext;
  }): Promise<InspectionReportRecord> {
    const reportId = positiveId(input.inspectionReportId, "Inspection Report");
    const expectedVersion = positiveId(input.expectedVersion, "Inspection Report 版本");
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const rows = await selectReportRows(transaction, reportId, true);
      const report = rows[0];
      if (!report) throw new InspectionReportNotFoundError();
      await requireReportWriter(
        transaction,
        input.context.actorAccountId,
        Number(report.inspection_team_id),
        nullableNumber(report.actual_inspector_staff_member_id),
      );
      if (report.version !== expectedVersion) {
        throw new InspectionReportValidationError(
          "Inspection Report 已被其他操作修改，请刷新后重试",
        );
      }
      if (report.status !== "draft") {
        throw new InspectionReportValidationError("只有草稿可以提交");
      }
      const updated = await transaction.query<{ version: number }>(
        `update inspection_reports
         set status = 'submitted', submitted_at = $2, submitted_by = $3,
             version = version + 1
         where id = $1 and version = $4 and status = 'draft'
         returning version`,
        [reportId, now, input.context.actorAccountId, expectedVersion],
      );
      if (!updated[0]) {
        throw new InspectionReportValidationError(
          "Inspection Report 已被其他操作修改，请刷新后重试",
        );
      }
      await audit(transaction, input.context, now, "inspection_report.submitted", reportId, {
        version: Number(updated[0].version),
        inspectionTeamId: Number(report.inspection_team_id),
        actualInspectorStaffMemberId: nullableNumber(report.actual_inspector_staff_member_id),
      });
      return selectReport(transaction, reportId);
    });
  }

  async correctInspectionReport(input: {
    originalInspectionReportId: number;
    expectedOriginalVersion: number;
    correctionReason: string;
    summaryZh: string;
    summaryEn?: string | null;
    findings: FindingInput[];
    inspectionTeamId?: number | null;
    actualInspectorStaffMemberId?: number | null;
    specialCaseNotesZh?: string | null;
    paperPhotoFileId?: number | null;
    context: BusinessOrderActionContext;
  }): Promise<InspectionReportRecord> {
    const originalId = positiveId(
      input.originalInspectionReportId,
      "原 Inspection Report",
    );
    const expectedVersion = positiveId(
      input.expectedOriginalVersion,
      "原 Inspection Report 版本",
    );
    const content = parseContent(input);
    const actualInspectorStaffMemberId = nullablePositiveId(
      input.actualInspectorStaffMemberId,
      "维修工姓名",
    );
    const paperPhotoFileId = nullablePositiveId(input.paperPhotoFileId, "纸质检查单照片");
    const correctionReason = nonempty(input.correctionReason, "更正原因");
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      const originals = await selectReportRows(transaction, originalId, true);
      const original = originals[0];
      if (!original) throw new InspectionReportNotFoundError("原 Inspection Report 不存在");
      const inspectionTeamId = input.inspectionTeamId == null
        ? Number(original.inspection_team_id)
        : positiveId(input.inspectionTeamId, "提交班组");
      await requireReportWriter(
        transaction,
        input.context.actorAccountId,
        inspectionTeamId,
        actualInspectorStaffMemberId,
      );
      if (original.version !== expectedVersion || original.status !== "submitted") {
        throw new InspectionReportValidationError(
          "只有当前已提交版本可以追加更正",
        );
      }
      const existingCorrections = await transaction.query<{ id: number }>(
        `select id from inspection_reports
         where correction_of_report_id = $1 limit 1`,
        [originalId],
      );
      if (existingCorrections[0]) {
        throw new InspectionReportValidationError(
          "这份 Inspection Report 已经有后续更正，请从最新更正继续",
        );
      }
      const fields = {
        vehicleId: Number(original.vehicle_id),
        sourceBusinessOrderId: nullableNumber(original.source_business_order_id),
        sourceRepairRoundId: nullableNumber(original.source_repair_round_id),
        inspectionTeamId,
        actualInspectorStaffMemberId,
        specialCaseNotesZh: optionalText(input.specialCaseNotesZh),
        paperPhotoFileId,
        ...content,
      };
      await validateReportLinks(transaction, fields);
      await transaction.query("lock table inspection_reports in share row exclusive mode");
      const correction = await insertDraft(transaction, {
        ...fields,
        reportNo: await nextReportNumber(transaction, now),
        correctionOfReportId: originalId,
        correctionReason,
        createdBy: input.context.actorAccountId,
        createdAt: now,
      });
      await audit(
        transaction,
        input.context,
        now,
        "inspection_report.correction_created",
        correction.id,
        { originalInspectionReportId: originalId, correctionReason },
      );
      return correction;
    });
  }

  async listVehicleInspectionReports(input: {
    vehicleId: number;
    viewerAccountId: number;
    page?: number;
    pageSize?: number;
  }) {
    const vehicleId = positiveId(input.vehicleId, "车辆");
    const access = await requireReportReader(this.database, input.viewerAccountId);
    const pageSize = toPageSize(input.pageSize);
    const requestedPage = toPage(input.page);
    const teamId = access.role === "mechanic" ? access.currentTeamId : null;
    const countRows = await this.database.query<{ total: number }>(
      `select count(*)::integer as total
       from inspection_reports as report
       where report.vehicle_id = $1
         and ($2::bigint is null or report.inspection_team_id = $2)`,
      [vehicleId, teamId],
    );
    const total = Number(countRows[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const rows = await this.database.query<InspectionReportRow>(
      `select ${reportColumns("report")}
       from inspection_reports as report
       where report.vehicle_id = $1
         and ($2::bigint is null or report.inspection_team_id = $2)
       order by report.created_at desc, report.id desc
       offset $3 limit $4`,
      [vehicleId, teamId, (page - 1) * pageSize, pageSize],
    );
    const items: InspectionReportRecord[] = [];
    for (const row of rows) items.push(await mapReportWithFindings(this.database, row));
    return { items, page, pageSize, pageCount, total };
  }

  async getInspectionReport(input: {
    inspectionReportId: number;
    viewerAccountId: number;
  }): Promise<InspectionReportDetailItem> {
    const reportId = positiveId(input.inspectionReportId, "Inspection Report");
    const access = await requireReportReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<InspectionReportListRow>(
      `${reportListQuery()} where report.id = $1
        and ($2::bigint is null or report.inspection_team_id = $2)`,
      [reportId, access.role === "mechanic" ? access.currentTeamId : null],
    );
    if (!rows[0]) throw new InspectionReportNotFoundError();
    const item = await mapListItem(this.database, rows[0]);
    return { ...item, workspace: await selectWorkspace(this.database, item.report) };
  }

  async updateInspectionReportWorkspace(input: {
    inspectionReportId: number;
    expectedVersion: number;
    organized: InspectionReportOrganizedContent;
    quotation: InspectionReportQuotation;
    source: "manual" | "ai";
    changeReason: string;
    context: BusinessOrderActionContext;
  }): Promise<InspectionReportDetailItem> {
    const reportId = positiveId(input.inspectionReportId, "Inspection Report");
    const expectedVersion = positiveId(input.expectedVersion, "Inspection Report 版本");
    const organized = parseOrganizedContent(input.organized);
    const quotation = parseQuotation(input.quotation);
    const changeReason = nonempty(input.changeReason, "修改原因");
    if (!(["manual", "ai"] as const).includes(input.source)) {
      throw new InspectionReportValidationError("整理来源无效");
    }
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const rows = await selectReportRows(transaction, reportId, true);
      const report = rows[0];
      if (!report) throw new InspectionReportNotFoundError();
      await requireReportWriter(
        transaction,
        input.context.actorAccountId,
        Number(report.inspection_team_id),
        nullableNumber(report.actual_inspector_staff_member_id),
      );
      if (Number(report.version) !== expectedVersion) {
        throw new InspectionReportValidationError("Inspection Report 已被其他操作修改，请刷新后重试");
      }
      const versionNo = Number(report.current_workspace_version_no) + 1;
      await transaction.query(
        `insert into inspection_report_workspace_versions
          (inspection_report_id, version_no, organized_content, quotation,
           source, change_reason, created_by, created_at)
         values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)`,
        [reportId, versionNo, JSON.stringify(organized), JSON.stringify(quotation),
          input.source, changeReason, input.context.actorAccountId, now],
      );
      const updated = await transaction.query<{ version: number }>(
        `update inspection_reports
         set current_workspace_version_no = $2, version = version + 1
         where id = $1 and version = $3 returning version`,
        [reportId, versionNo, expectedVersion],
      );
      if (!updated[0]) {
        throw new InspectionReportValidationError("Inspection Report 已被其他操作修改，请刷新后重试");
      }
      await audit(transaction, input.context, now, "inspection_report.workspace_version_appended", reportId, {
        versionNo,
        source: input.source,
        quotationStatus: quotation.status,
        quotationLineCount: quotation.lines.length,
      });
      const detailRows = await transaction.query<InspectionReportListRow>(
        `${reportListQuery()} where report.id = $1`,
        [reportId],
      );
      if (!detailRows[0]) throw new InspectionReportNotFoundError();
      const item = await mapListItem(transaction, detailRows[0]);
      return { ...item, workspace: await selectWorkspace(transaction, item.report) };
    });
  }

  async listInspectionReports(input: {
    viewerAccountId: number;
    sourceBusinessOrderId?: number;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const access = await requireReportReader(this.database, input.viewerAccountId);
    const pageSize = toPageSize(input.pageSize);
    const requestedPage = toPage(input.page);
    const sourceBusinessOrderId = input.sourceBusinessOrderId === undefined
      ? null
      : positiveId(input.sourceBusinessOrderId, "来源 Business Order");
    const search = optionalText(input.search);
    const teamId = access.role === "mechanic" ? access.currentTeamId : null;
    const filters = `where ($1::bigint is null or report.source_business_order_id = $1)
      and ($2::text is null or concat_ws(' ', report.report_no, report.summary_zh,
        vehicle.plate_display, vehicle.make, vehicle.make_zh, vehicle.model, vehicle.model_zh,
        person.full_name, company.legal_name, inspector.full_name) ilike '%' || $2 || '%')
      and ($3::bigint is null or report.inspection_team_id = $3)`;
    const countRows = await this.database.query<{ total: number }>(
      `select count(*)::integer as total
       from inspection_reports as report
       join vehicles as vehicle on vehicle.id = report.vehicle_id
       left join personal_customers as person on person.id = vehicle.current_person_customer_id
       left join company_accounts as company on company.id = vehicle.current_company_account_id
       left join staff_members as inspector on inspector.id = report.actual_inspector_staff_member_id
       ${filters}`,
      [sourceBusinessOrderId, search, teamId],
    );
    const total = Number(countRows[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const rows = await this.database.query<InspectionReportListRow>(
      `${reportListQuery()} ${filters}
       order by report.created_at desc, report.id desc
       offset $4 limit $5`,
      [sourceBusinessOrderId, search, teamId, (page - 1) * pageSize, pageSize],
    );
    const items: InspectionReportListItem[] = [];
    for (const row of rows) items.push(await mapListItem(this.database, row));
    return { items, page, pageSize, pageCount, total };
  }

  async listInspectionReportCommunications(input: {
    inspectionReportId: number;
    viewerAccountId: number;
  }): Promise<InspectionReportCommunicationRecord[]> {
    const reportId = positiveId(input.inspectionReportId, "Inspection Report");
    await requireReportReader(this.database, input.viewerAccountId);
    return selectCommunications(this.database, reportId);
  }

  async recordInspectionReportCommunication(input: {
    inspectionReportId: number;
    channel: "sms" | "email" | "whatsapp";
    targetContact: string;
    noteOrReply?: string | null;
    status?: "initiated" | "confirmed" | "not_delivered";
    eventKind?: "notification" | "reply" | "status_correction";
    context: BusinessOrderActionContext;
  }): Promise<InspectionReportCommunicationRecord> {
    const reportId = positiveId(input.inspectionReportId, "Inspection Report");
    const targetContact = nonempty(input.targetContact, "目标联系方式");
    const noteOrReply = optionalText(input.noteOrReply);
    if (!["sms", "email", "whatsapp"].includes(input.channel)) {
      throw new InspectionReportValidationError("通知渠道无效");
    }
    const status = input.status ?? "initiated";
    if (!["initiated", "confirmed", "not_delivered"].includes(status)) {
      throw new InspectionReportValidationError("客户跟进状态无效");
    }
    const eventKind = input.eventKind ?? "notification";
    if (!["notification", "reply", "status_correction"].includes(eventKind)) {
      throw new InspectionReportValidationError("客户跟进事件类型无效");
    }
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireReportReader(transaction, input.context.actorAccountId);
      const rows = await selectReportRows(transaction, reportId, true);
      const report = rows[0];
      if (!report) throw new InspectionReportNotFoundError();
      const inserted = await transaction.query<InspectionReportCommunicationRow>(
        `insert into inspection_report_communications
          (inspection_report_id, vehicle_id, source_business_order_id, channel,
           target_contact, initiated_at, initiated_by, status, note_or_reply)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning ${communicationColumns()}`,
        [reportId, report.vehicle_id, report.source_business_order_id, input.channel,
          targetContact, now, input.context.actorAccountId, status, noteOrReply],
      );
      const communication = mapCommunication(inserted[0]!);
      const auditEvent = eventKind === "reply"
        ? "inspection_report.customer_reply_recorded"
        : eventKind === "status_correction"
          ? "inspection_report.followup_status_corrected"
          : "inspection_report.customer_notification_initiated";
      await audit(transaction, input.context, now, auditEvent, reportId, {
        communicationId: communication.id,
        channel: communication.channel,
        targetContact: communication.targetContact,
        status: communication.status,
        eventKind,
      });
      return communication;
    });
  }
}

type InspectionReportCommunicationRow = {
  id: number;
  inspection_report_id: number;
  vehicle_id: number;
  source_business_order_id: number | null;
  channel: "sms" | "email" | "whatsapp";
  target_contact: string;
  initiated_at: Date;
  initiated_by: number;
  status: "initiated" | "confirmed" | "not_delivered";
  note_or_reply: string | null;
};

function reportListQuery() {
  return `select ${reportColumns("report")},
          vehicle.plate_display as vehicle_plate_display,
          vehicle.make as vehicle_make, vehicle.make_zh as vehicle_make_zh,
          vehicle.model as vehicle_model, vehicle.model_zh as vehicle_model_zh,
          coalesce(person.full_name, company.legal_name) as customer_name,
          coalesce(person.normalized_phone, company.phone) as customer_phone,
          person.whatsapp as customer_whatsapp,
          coalesce(person.email, company.email) as customer_email,
          inspector.full_name as inspector_name,
          team.name as team_name,
          source_order.order_no as source_business_order_no,
          latest_communication.status as latest_communication_status
   from inspection_reports as report
   join vehicles as vehicle on vehicle.id = report.vehicle_id
   left join personal_customers as person on person.id = vehicle.current_person_customer_id
   left join company_accounts as company on company.id = vehicle.current_company_account_id
   left join staff_members as inspector on inspector.id = report.actual_inspector_staff_member_id
   join repair_teams as team on team.id = report.inspection_team_id
   left join business_orders as source_order on source_order.id = report.source_business_order_id
   left join lateral (
     select communication.status
     from inspection_report_communications as communication
     where communication.inspection_report_id = report.id
     order by communication.initiated_at desc, communication.id desc
     limit 1
   ) as latest_communication on true`;
}

async function mapListItem(
  executor: AuthSqlExecutor,
  row: InspectionReportListRow,
): Promise<InspectionReportListItem> {
  const report = await mapReportWithFindings(executor, row);
  const plate = row.vehicle_plate_display ?? "未登记车牌";
  const descriptionZh = `${row.vehicle_make_zh ?? row.vehicle_make} ${row.vehicle_model_zh ?? row.vehicle_model}`.trim();
  const descriptionEn = `${row.vehicle_make} ${row.vehicle_model}`.trim();
  return {
    report,
    vehicle: {
      id: report.vehicleId,
      plate,
      description: descriptionZh,
      descriptionZh,
      descriptionEn,
    },
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      whatsapp: row.customer_whatsapp,
      email: row.customer_email,
    },
    inspectorName: row.inspector_name,
    teamName: row.team_name,
    sourceBusinessOrder: report.sourceBusinessOrderId === null || row.source_business_order_no === null
      ? null
      : { id: report.sourceBusinessOrderId, orderNo: row.source_business_order_no },
    followupStage: deriveInspectionFollowupStage(
      report.currentWorkspaceVersionNo ?? 0,
      row.latest_communication_status ? [{ status: row.latest_communication_status }] : [],
    ),
  };
}

async function selectCommunications(
  executor: AuthSqlExecutor,
  inspectionReportId: number,
): Promise<InspectionReportCommunicationRecord[]> {
  const rows = await executor.query<InspectionReportCommunicationRow>(
    `select ${communicationColumns()} from inspection_report_communications
     where inspection_report_id = $1 order by initiated_at desc, id desc`,
    [inspectionReportId],
  );
  return rows.map(mapCommunication);
}

function communicationColumns() {
  return "id, inspection_report_id, vehicle_id, source_business_order_id, channel, target_contact, initiated_at, initiated_by, status, note_or_reply";
}

function mapCommunication(row: InspectionReportCommunicationRow): InspectionReportCommunicationRecord {
  return {
    id: Number(row.id),
    inspectionReportId: Number(row.inspection_report_id),
    vehicleId: Number(row.vehicle_id),
    sourceBusinessOrderId: nullableNumber(row.source_business_order_id),
    channel: row.channel,
    targetContact: row.target_contact,
    initiatedAt: new Date(row.initiated_at),
    initiatedBy: Number(row.initiated_by),
    status: row.status,
    noteOrReply: row.note_or_reply,
  };
}

async function insertDraft(
  executor: AuthSqlExecutor,
  input: {
    reportNo: string;
    vehicleId: number;
    sourceBusinessOrderId: number | null;
    sourceRepairRoundId: number | null;
    correctionOfReportId: number | null;
    correctionReason: string | null;
    summaryZh: string;
    summaryEn: string | null;
    inspectionTeamId: number;
    actualInspectorStaffMemberId: number | null;
    specialCaseNotesZh: string | null;
    paperPhotoFileId: number | null;
    findings: ParsedFinding[];
    createdBy: number;
    createdAt: Date;
  },
) {
  const rows = await executor.query<InspectionReportRow>(
    `insert into inspection_reports
      (report_no, vehicle_id, source_business_order_id,
       source_repair_round_id, correction_of_report_id, correction_reason,
       summary_zh, summary_en, inspection_team_id,
       actual_inspector_staff_member_id, special_case_notes_zh,
       paper_photo_file_id, created_at, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     returning ${reportColumns()}`,
    [input.reportNo, input.vehicleId, input.sourceBusinessOrderId,
      input.sourceRepairRoundId, input.correctionOfReportId,
      input.correctionReason, input.summaryZh, input.summaryEn,
      input.inspectionTeamId, input.actualInspectorStaffMemberId,
      input.specialCaseNotesZh, input.paperPhotoFileId,
      input.createdAt, input.createdBy],
  );
  for (const [index, finding] of input.findings.entries()) {
    await executor.query(
      `insert into inspection_report_findings
        (inspection_report_id, finding_zh, finding_en,
         recommendation_zh, recommendation_en, sort_order)
       values ($1, $2, $3, $4, $5, $6)`,
      [rows[0].id, finding.findingZh, finding.findingEn,
        finding.recommendationZh, finding.recommendationEn, index + 1],
    );
  }
  return mapReportWithFindings(executor, rows[0]);
}

async function selectReport(executor: AuthSqlExecutor, reportId: number) {
  const rows = await selectReportRows(executor, reportId, false);
  if (!rows[0]) throw new InspectionReportNotFoundError();
  return mapReportWithFindings(executor, rows[0]);
}

async function selectReportRows(
  executor: AuthSqlExecutor,
  reportId: number,
  lock: boolean,
) {
  return executor.query<InspectionReportRow>(
    `select ${reportColumns()} from inspection_reports
     where id = $1${lock ? " for update" : ""}`,
    [reportId],
  );
}

async function mapReportWithFindings(
  executor: AuthSqlExecutor,
  row: InspectionReportRow,
): Promise<InspectionReportRecord> {
  const findings = await executor.query<{
    id: number;
    finding_zh: string;
    finding_en: string | null;
    recommendation_zh: string | null;
    recommendation_en: string | null;
    sort_order: number;
  }>(
    `select id, finding_zh, finding_en, recommendation_zh,
            recommendation_en, sort_order
     from inspection_report_findings
     where inspection_report_id = $1 order by sort_order, id`,
    [row.id],
  );
  return {
    id: Number(row.id),
    reportNo: row.report_no,
    vehicleId: Number(row.vehicle_id),
    sourceBusinessOrderId: nullableNumber(row.source_business_order_id),
    sourceRepairRoundId: nullableNumber(row.source_repair_round_id),
    correctionOfReportId: nullableNumber(row.correction_of_report_id),
    correctionReason: row.correction_reason,
    summaryZh: row.summary_zh,
    summaryEn: row.summary_en,
    inspectionTeamId: Number(row.inspection_team_id),
    actualInspectorStaffMemberId: nullableNumber(
      row.actual_inspector_staff_member_id,
    ),
    specialCaseNotesZh: row.special_case_notes_zh,
    paperPhotoFileId: nullableNumber(row.paper_photo_file_id),
    status: row.status,
    createdAt: new Date(row.created_at),
    createdBy: Number(row.created_by),
    submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    submittedBy: nullableNumber(row.submitted_by),
    version: row.version,
    currentWorkspaceVersionNo: Number(row.current_workspace_version_no),
    findings: findings.map((finding) => ({
      id: Number(finding.id),
      findingZh: finding.finding_zh,
      findingEn: finding.finding_en,
      recommendationZh: finding.recommendation_zh,
      recommendationEn: finding.recommendation_en,
      sortOrder: finding.sort_order,
    })),
  };
}

async function validateReportLinks(
  executor: AuthSqlExecutor,
  input: {
    vehicleId: number;
    sourceBusinessOrderId: number | null;
    sourceRepairRoundId: number | null;
    inspectionTeamId: number;
    actualInspectorStaffMemberId: number | null;
    paperPhotoFileId: number | null;
  },
) {
  const vehicles = await executor.query<{ id: number }>(
    "select id from vehicles where id = $1 and is_active = true limit 1",
    [input.vehicleId],
  );
  if (!vehicles[0]) throw new InspectionReportNotFoundError("车辆不存在或已停用");
  const teams = await executor.query<{ id: number }>(
    "select id from repair_teams where id = $1 and is_active = true limit 1",
    [input.inspectionTeamId],
  );
  if (!teams[0]) {
    throw new InspectionReportValidationError("提交班组不存在或已停用");
  }
  if (input.actualInspectorStaffMemberId !== null) {
    const staff = await executor.query<{ id: number; current_team_id: number }>(
      `select id, current_team_id from staff_members
       where id = $1 and status = 'active' limit 1`,
      [input.actualInspectorStaffMemberId],
    );
    if (!staff[0]) {
      throw new InspectionReportValidationError("维修工不存在或已经离职");
    }
    if (Number(staff[0].current_team_id) !== input.inspectionTeamId) {
      throw new InspectionReportValidationError("维修工不属于所选提交班组");
    }
  }
  if (input.sourceBusinessOrderId !== null) {
    const orders = await executor.query<{ id: number }>(
      "select id from business_orders where id = $1 and vehicle_id = $2 limit 1",
      [input.sourceBusinessOrderId, input.vehicleId],
    );
    if (!orders[0]) {
      throw new InspectionReportValidationError("来源 Business Order 不属于当前车辆");
    }
  }
  if (input.sourceRepairRoundId !== null) {
    const rounds = await executor.query<{ business_order_id: number }>(
      `select round.business_order_id
       from repair_rounds as round
       join business_orders as business_order
         on business_order.id = round.business_order_id
       where round.id = $1 and business_order.vehicle_id = $2 limit 1`,
      [input.sourceRepairRoundId, input.vehicleId],
    );
    if (
      !rounds[0] ||
      (input.sourceBusinessOrderId !== null &&
        Number(rounds[0].business_order_id) !== input.sourceBusinessOrderId)
    ) {
      throw new InspectionReportValidationError("来源维修轮次与车辆或 Business Order 不一致");
    }
  }
  if (input.paperPhotoFileId !== null) {
    const files = await executor.query<{ file_id: number }>(
      `select file_id from vehicle_attachments
       where vehicle_id = $1 and file_id = $2 limit 1`,
      [input.vehicleId, input.paperPhotoFileId],
    );
    if (!files[0]) {
      throw new InspectionReportValidationError("纸质检查单照片必须先归档到车辆档案");
    }
  }
}

async function requireReportWriter(
  executor: AuthSqlExecutor,
  accountId: number,
  inspectionTeamId: number,
  actualInspectorStaffMemberId: number | null,
) {
  const rows = await executor.query<{
    role: string;
    staff_member_id: number | null;
    current_team_id: number | null;
  }>(
    `select account.role, member.id as staff_member_id, member.current_team_id
     from staff_accounts as account
     left join staff_members as member
       on member.account_id = account.id and member.status = 'active'
     where account.id = $1 and account.is_active = true limit 1`,
    [accountId],
  );
  const actor = rows[0];
  if (actor && ["super_admin", "front_desk"].includes(actor.role)) return;
  if (
    actor?.role === "mechanic" &&
    Number(actor.current_team_id) === inspectionTeamId &&
    (actualInspectorStaffMemberId === null ||
      Number(actor.staff_member_id) === actualInspectorStaffMemberId)
  ) return;
  throw new InspectionReportAccessDeniedError();
}

async function requireReportReader(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ role: string; current_team_id: number | null }>(
    `select account.role, member.current_team_id
     from staff_accounts as account
     left join staff_members as member
       on member.account_id = account.id and member.status = 'active'
     where account.id = $1 and account.is_active = true limit 1`,
    [accountId],
  );
  const actor = rows[0];
  if (!actor) throw new InspectionReportAccessDeniedError();
  if (["super_admin", "front_desk", "owner"].includes(actor.role)) {
    return { role: actor.role, currentTeamId: null };
  }
  if (actor.role === "mechanic" && actor.current_team_id !== null) {
    return { role: actor.role, currentTeamId: Number(actor.current_team_id) };
  }
  throw new InspectionReportAccessDeniedError();
}

async function nextReportNumber(executor: AuthSqlExecutor, now: Date) {
  const prefix = `IR-${toBusinessDateKey(now).replaceAll("-", "")}-`;
  const rows = await executor.query<{ current_number: number }>(
    `select coalesce(max(right(report_no, 4)::integer), 0)::integer as current_number
     from inspection_reports where report_no like $1`,
    [`${prefix}%`],
  );
  const next = Number(rows[0]?.current_number ?? 0) + 1;
  if (next > 9_999) {
    throw new InspectionReportValidationError("当天 Inspection Report 编号已经用尽");
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

async function audit(
  executor: AuthSqlExecutor,
  context: BusinessOrderActionContext,
  occurredAt: Date,
  eventType: string,
  reportId: number,
  after: Record<string, unknown>,
) {
  await writeAuditEvent(executor, {
    occurredAt,
    actorAccountId: context.actorAccountId,
    eventType,
    objectType: "inspection_report",
    objectId: String(reportId),
    after,
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
}

function reportColumns(prefix?: string) {
  const p = prefix ? `${prefix}.` : "";
  return `${p}id, ${p}report_no, ${p}vehicle_id,
          ${p}source_business_order_id, ${p}source_repair_round_id,
          ${p}correction_of_report_id, ${p}correction_reason,
          ${p}summary_zh, ${p}summary_en,
          ${p}inspection_team_id, ${p}actual_inspector_staff_member_id,
          ${p}special_case_notes_zh, ${p}paper_photo_file_id,
          ${p}status, ${p}created_at, ${p}created_by,
          ${p}submitted_at, ${p}submitted_by, ${p}version,
          ${p}current_workspace_version_no`;
}

async function selectWorkspace(
  executor: AuthSqlExecutor,
  report: InspectionReportRecord,
): Promise<InspectionReportWorkspaceVersion> {
  const currentWorkspaceVersionNo = report.currentWorkspaceVersionNo ?? 0;
  if (currentWorkspaceVersionNo === 0) {
    return {
      versionNo: 0,
      source: "original",
      changeReason: "维修工原始回单",
      createdAt: report.createdAt,
      createdBy: report.createdBy,
      organized: {
        summaryZh: report.summaryZh,
        summaryEn: report.summaryEn,
        specialCaseNotesZh: report.specialCaseNotesZh,
        specialCaseNotesEn: null,
        findings: report.findings.map(({ id: _id, sortOrder: _sortOrder, ...finding }) => finding),
      },
      quotation: deriveOriginalInspectionQuotation(buildInspectionOriginalQuotationText({
        summaryZh: report.summaryZh,
        summaryEn: report.summaryEn,
        specialCaseNotesZh: report.specialCaseNotesZh,
        findings: report.findings,
      })),
    };
  }
  const rows = await executor.query<{
    version_no: number;
    source: "manual" | "ai";
    change_reason: string;
    created_at: Date;
    created_by: number;
    organized_content: InspectionReportOrganizedContent;
    quotation: InspectionReportQuotation;
  }>(
    `select version_no, source, change_reason, created_at, created_by,
            organized_content, quotation
     from inspection_report_workspace_versions
     where inspection_report_id = $1 and version_no = $2 limit 1`,
    [report.id, currentWorkspaceVersionNo],
  );
  const row = rows[0];
  if (!row) throw new InspectionReportValidationError("Inspection Report 当前整理版本不存在");
  return {
    versionNo: Number(row.version_no),
    source: row.source,
    changeReason: row.change_reason,
    createdAt: new Date(row.created_at),
    createdBy: Number(row.created_by),
    organized: parseOrganizedContent(row.organized_content),
    quotation: parseQuotation(row.quotation),
  };
}

function parseOrganizedContent(value: InspectionReportOrganizedContent): InspectionReportOrganizedContent {
  if (!value || typeof value !== "object") {
    throw new InspectionReportValidationError("整理后的检查报告无效");
  }
  return {
    summaryZh: nonempty(value.summaryZh, "整理后的检查总结"),
    summaryEn: optionalText(value.summaryEn),
    specialCaseNotesZh: optionalText(value.specialCaseNotesZh),
    specialCaseNotesEn: optionalText(value.specialCaseNotesEn),
    findings: (Array.isArray(value.findings) ? value.findings : []).map((finding) => ({
      findingZh: nonempty(finding.findingZh, "检查结果"),
      findingEn: optionalText(finding.findingEn),
      recommendationZh: optionalText(finding.recommendationZh),
      recommendationEn: optionalText(finding.recommendationEn),
    })),
  };
}

function parseQuotation(value: InspectionReportQuotation): InspectionReportQuotation {
  if (!value || typeof value !== "object" || !["pending", "entered", "not_quoted"].includes(value.status)) {
    throw new InspectionReportValidationError("报价状态无效");
  }
  const lines = Array.isArray(value.lines) ? value.lines.map((line) => {
    if (!line || !["labor", "part", "other"].includes(line.kind)) {
      throw new InspectionReportValidationError("报价项目类别无效");
    }
    const quantity = nonempty(String(line.quantity ?? ""), "报价数量");
    const numericQuantity = Number(quantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      throw new InspectionReportValidationError("报价数量无效");
    }
    const unitPriceMinor = nullableMoneyMinor(line.unitPriceMinor, "报价单价");
    const itemDiscountMinor = nullableMoneyMinor(line.itemDiscountMinor, "本项折扣") ?? 0;
    const subtotalMinor = nullableMoneyMinor(line.subtotalMinor, "报价小计");
    if (itemDiscountMinor > 0 && unitPriceMinor === null) {
      throw new InspectionReportValidationError("填写本项折扣前必须填写报价单价");
    }
    if (unitPriceMinor !== null) {
      const grossMinor = Math.round(unitPriceMinor * numericQuantity);
      if (itemDiscountMinor > grossMinor) {
        throw new InspectionReportValidationError("本项折扣不能超过项目原价");
      }
      if (subtotalMinor !== null && subtotalMinor !== grossMinor - itemDiscountMinor) {
        throw new InspectionReportValidationError("报价小计必须等于数量乘单价减本项折扣");
      }
    }
    return {
      kind: line.kind,
      nameZh: nonempty(line.nameZh, "报价项目名称"),
      nameEn: optionalText(line.nameEn),
      descriptionZh: optionalText(line.descriptionZh),
      descriptionEn: optionalText(line.descriptionEn),
      quantity,
      unitPriceMinor,
      itemDiscountMinor,
      subtotalMinor,
    };
  }) : [];
  if (value.status === "entered" && lines.length === 0) {
    throw new InspectionReportValidationError("已报价时至少需要一个报价项目");
  }
  if (value.status === "entered" && lines.some((line) => line.subtotalMinor === null)) {
    throw new InspectionReportValidationError("已报价项目必须填写小计");
  }
  const wholeOrderDiscountMinor = nullableMoneyMinor(value.wholeOrderDiscountMinor, "整单优惠") ?? 0;
  const lineSubtotalMinor = lines.reduce((sum, line) => sum + (line.subtotalMinor ?? 0), 0);
  if (wholeOrderDiscountMinor > lineSubtotalMinor) {
    throw new InspectionReportValidationError("整单优惠不能超过报价小计");
  }
  return {
    status: value.status,
    noteZh: optionalText(value.noteZh),
    noteEn: optionalText(value.noteEn),
    wholeOrderDiscountMinor,
    lines,
  };
}

function nullableMoneyMinor(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new InspectionReportValidationError(`${label}无效`);
  }
  return parsed;
}

function parseDraftInput(input: {
  vehicleId: number;
  sourceBusinessOrderId?: number | null;
  sourceRepairRoundId?: number | null;
  inspectionTeamId: number;
  actualInspectorStaffMemberId?: number | null;
  paperPhotoFileId?: number | null;
  specialCaseNotesZh?: string | null;
  summaryZh: string;
  summaryEn?: string | null;
  findings: FindingInput[];
}) {
  return {
    vehicleId: positiveId(input.vehicleId, "车辆"),
    sourceBusinessOrderId: nullablePositiveId(input.sourceBusinessOrderId, "来源 Business Order"),
    sourceRepairRoundId: nullablePositiveId(input.sourceRepairRoundId, "来源维修轮次"),
    inspectionTeamId: positiveId(input.inspectionTeamId, "提交班组"),
    actualInspectorStaffMemberId: nullablePositiveId(
      input.actualInspectorStaffMemberId,
      "维修工姓名",
    ),
    specialCaseNotesZh: optionalText(input.specialCaseNotesZh),
    paperPhotoFileId: nullablePositiveId(input.paperPhotoFileId, "纸质检查单照片"),
    ...parseContent(input),
  };
}

function parseContent(input: {
  summaryZh: string;
  summaryEn?: string | null;
  findings: FindingInput[];
}) {
  if (!Array.isArray(input.findings)) {
    throw new InspectionReportValidationError("Inspection Report 检查明细无效");
  }
  return {
    summaryZh: nonempty(input.summaryZh, "检查结果"),
    summaryEn: optionalText(input.summaryEn),
    findings: input.findings.map((finding) => ({
      findingZh: nonempty(finding.findingZh, "检查结果"),
      findingEn: optionalText(finding.findingEn),
      recommendationZh: optionalText(finding.recommendationZh),
      recommendationEn: optionalText(finding.recommendationEn),
    })),
  };
}

function positiveId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InspectionReportValidationError(`${label}无效`);
  }
  return value;
}

function nullablePositiveId(value: number | null | undefined, label: string) {
  return value == null ? null : positiveId(value, label);
}

function nonempty(value: string, label: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) throw new InspectionReportValidationError(`${label}不能为空`);
  return normalized;
}

function optionalText(value: string | null | undefined) {
  const normalized = value?.normalize("NFKC").trim();
  return normalized ? normalized : null;
}

function nullableNumber(value: number | null) {
  return value === null ? null : Number(value);
}

function toPage(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : 1;
}

function toPageSize(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value as number, 100)
    : 20;
}
