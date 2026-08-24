import { toBusinessDateKey } from "@/lib/time";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@/modules/auth/session-repository";
import { writeAuditEvent } from "@/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";

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
  actual_inspector_staff_member_id: number | null;
  paper_photo_file_id: number | null;
  status: "draft" | "submitted";
  created_at: Date;
  created_by: number;
  submitted_at: Date | null;
  submitted_by: number | null;
  version: number;
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
  actualInspectorStaffMemberId: number | null;
  paperPhotoFileId: number | null;
  status: "draft" | "submitted";
  createdAt: Date;
  createdBy: number;
  submittedAt: Date | null;
  submittedBy: number | null;
  version: number;
  findings: Array<ParsedFinding & { id: number; sortOrder: number }>;
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
    actualInspectorStaffMemberId?: number | null;
    paperPhotoFileId?: number | null;
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
      if (report.actual_inspector_staff_member_id === null) {
        throw new InspectionReportValidationError("提交前必须记录实际检查人");
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
        actualInspectorStaffMemberId: Number(report.actual_inspector_staff_member_id),
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
    actualInspectorStaffMemberId?: number | null;
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
    const actualInspectorStaffMemberId = requiredPositiveId(
      input.actualInspectorStaffMemberId,
      "实际检查人",
    );
    const paperPhotoFileId = nullablePositiveId(input.paperPhotoFileId, "纸质检查单照片");
    const correctionReason = nonempty(input.correctionReason, "更正原因");
    const now = input.context.now ?? new Date();

    return this.database.transaction(async (transaction) => {
      const originals = await selectReportRows(transaction, originalId, true);
      const original = originals[0];
      if (!original) throw new InspectionReportNotFoundError("原 Inspection Report 不存在");
      await requireReportWriter(
        transaction,
        input.context.actorAccountId,
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
        actualInspectorStaffMemberId,
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
       left join staff_members as inspector
         on inspector.id = report.actual_inspector_staff_member_id
       where report.vehicle_id = $1
         and ($2::bigint is null or inspector.current_team_id = $2)`,
      [vehicleId, teamId],
    );
    const total = Number(countRows[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const rows = await this.database.query<InspectionReportRow>(
      `select ${reportColumns("report")}
       from inspection_reports as report
       left join staff_members as inspector
         on inspector.id = report.actual_inspector_staff_member_id
       where report.vehicle_id = $1
         and ($2::bigint is null or inspector.current_team_id = $2)
       order by report.created_at desc, report.id desc
       offset $3 limit $4`,
      [vehicleId, teamId, (page - 1) * pageSize, pageSize],
    );
    const items: InspectionReportRecord[] = [];
    for (const row of rows) items.push(await mapReportWithFindings(this.database, row));
    return { items, page, pageSize, pageCount, total };
  }
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
    actualInspectorStaffMemberId: number | null;
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
       summary_zh, summary_en, actual_inspector_staff_member_id,
       paper_photo_file_id, created_at, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning ${reportColumns()}`,
    [input.reportNo, input.vehicleId, input.sourceBusinessOrderId,
      input.sourceRepairRoundId, input.correctionOfReportId,
      input.correctionReason, input.summaryZh, input.summaryEn,
      input.actualInspectorStaffMemberId, input.paperPhotoFileId,
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
    actualInspectorStaffMemberId: nullableNumber(
      row.actual_inspector_staff_member_id,
    ),
    paperPhotoFileId: nullableNumber(row.paper_photo_file_id),
    status: row.status,
    createdAt: new Date(row.created_at),
    createdBy: Number(row.created_by),
    submittedAt: row.submitted_at ? new Date(row.submitted_at) : null,
    submittedBy: nullableNumber(row.submitted_by),
    version: row.version,
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
    actualInspectorStaffMemberId: number | null;
    paperPhotoFileId: number | null;
  },
) {
  const vehicles = await executor.query<{ id: number }>(
    "select id from vehicles where id = $1 and is_active = true limit 1",
    [input.vehicleId],
  );
  if (!vehicles[0]) throw new InspectionReportNotFoundError("车辆不存在或已停用");
  if (input.actualInspectorStaffMemberId !== null) {
    const staff = await executor.query<{ id: number }>(
      "select id from staff_members where id = $1 and status = 'active' limit 1",
      [input.actualInspectorStaffMemberId],
    );
    if (!staff[0]) {
      throw new InspectionReportValidationError("实际检查人不存在或已经离职");
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
  actualInspectorStaffMemberId: number | null,
) {
  const rows = await executor.query<{ role: string; staff_member_id: number | null }>(
    `select account.role, member.id as staff_member_id
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
    actualInspectorStaffMemberId !== null &&
    Number(actor.staff_member_id) === actualInspectorStaffMemberId
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
          ${p}actual_inspector_staff_member_id, ${p}paper_photo_file_id,
          ${p}status, ${p}created_at, ${p}created_by,
          ${p}submitted_at, ${p}submitted_by, ${p}version`;
}

function parseDraftInput(input: {
  vehicleId: number;
  sourceBusinessOrderId?: number | null;
  sourceRepairRoundId?: number | null;
  actualInspectorStaffMemberId?: number | null;
  paperPhotoFileId?: number | null;
  summaryZh: string;
  summaryEn?: string | null;
  findings: FindingInput[];
}) {
  return {
    vehicleId: positiveId(input.vehicleId, "车辆"),
    sourceBusinessOrderId: nullablePositiveId(input.sourceBusinessOrderId, "来源 Business Order"),
    sourceRepairRoundId: nullablePositiveId(input.sourceRepairRoundId, "来源维修轮次"),
    actualInspectorStaffMemberId: requiredPositiveId(
      input.actualInspectorStaffMemberId,
      "实际检查人",
    ),
    paperPhotoFileId: nullablePositiveId(input.paperPhotoFileId, "纸质检查单照片"),
    ...parseContent(input),
  };
}

function parseContent(input: {
  summaryZh: string;
  summaryEn?: string | null;
  findings: FindingInput[];
}) {
  if (!Array.isArray(input.findings) || input.findings.length === 0) {
    throw new InspectionReportValidationError("Inspection Report 至少要有一条检查结果");
  }
  return {
    summaryZh: nonempty(input.summaryZh, "检查总结"),
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

function requiredPositiveId(value: number | null | undefined, label: string) {
  if (value == null) throw new InspectionReportValidationError(`${label}不能为空`);
  return positiveId(value, label);
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
