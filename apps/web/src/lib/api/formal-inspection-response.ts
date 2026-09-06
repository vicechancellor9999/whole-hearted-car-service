import { z } from "zod";

const id = z.number().int().positive();
const text = z.string().nullable();
const amount = z.number().int().nonnegative();
const finding = z.object({ findingZh: z.string(), findingEn: text, recommendationZh: text, recommendationEn: text }).passthrough();

// Validate the response before it can replace the report or an unsaved draft.
// Blank optional business information and historical fractional quantities remain readable.
export const inspectionDetailResponse = z.object({
  report: z.object({
    id, reportNo: z.string().refine((value) => value.trim().length > 0), vehicleId: id,
    sourceBusinessOrderId: id.nullable(), sourceRepairRoundId: id.nullable(),
    correctionOfReportId: id.nullable(), correctionReason: text, inspectionTeamId: id,
    summaryZh: z.string(), summaryEn: text, specialCaseNotesZh: text,
    actualInspectorStaffMemberId: id.nullable(), paperPhotoFileId: id.nullable(),
    status: z.enum(["draft", "submitted"]), createdAt: z.string(), submittedAt: text,
    version: id, currentWorkspaceVersionNo: amount.optional(),
    findings: z.array(finding.extend({ id, sortOrder: z.number().int() })),
  }).passthrough(),
  vehicle: z.object({ id, plate: z.string(), description: z.string(), descriptionZh: z.string(), descriptionEn: z.string() }).passthrough(),
  customer: z.object({ name: text, phone: text, whatsapp: text, email: text }).passthrough(),
  inspectorName: text, teamName: z.string(),
  sourceBusinessOrder: z.object({ id, orderNo: z.string() }).passthrough().nullable(),
  followupStage: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  communications: z.array(z.object({
    id, inspectionReportId: id, vehicleId: id, sourceBusinessOrderId: id.nullable(),
    channel: z.enum(["sms", "email", "whatsapp"]), targetContact: z.string(),
    initiatedAt: z.string(), initiatedBy: id, status: z.enum(["initiated", "confirmed", "not_delivered"]), noteOrReply: text,
  }).passthrough()),
  workspace: z.object({
    versionNo: amount, source: z.enum(["original", "manual", "ai"]), changeReason: z.string(), createdAt: z.string(), createdBy: id,
    organized: z.object({ summaryZh: z.string(), summaryEn: text, specialCaseNotesZh: text, specialCaseNotesEn: text.optional(), findings: z.array(finding) }).passthrough(),
    quotation: z.object({
      status: z.enum(["pending", "entered", "not_quoted"]), noteZh: text, noteEn: text, wholeOrderDiscountMinor: amount.optional(),
      lines: z.array(z.object({
        kind: z.enum(["labor", "part", "other"]), nameZh: z.string(), nameEn: text, descriptionZh: text, descriptionEn: text,
        quantity: z.string(), unitPriceMinor: amount.nullable(), itemDiscountMinor: amount.optional(), subtotalMinor: amount.nullable(),
      }).passthrough()),
    }).passthrough(),
  }).passthrough(),
}).passthrough().refine((detail) => detail.vehicle.id === detail.report.vehicleId
  && detail.communications.every((entry) => entry.inspectionReportId === detail.report.id));

// Lists share the report contract, but do not contain workspace or communication details.
const { report, vehicle, customer, inspectorName, teamName, sourceBusinessOrder, followupStage } = inspectionDetailResponse.shape;
const inspectionListItemResponse = z.object({ report, vehicle, customer, inspectorName, teamName, sourceBusinessOrder, followupStage })
  .passthrough().refine((item) => item.vehicle.id === item.report.vehicleId);

export const inspectionListResponse = z.object({
  currentAccountId: id.optional(),
  items: z.array(inspectionListItemResponse),
  page: id, pageSize: id, pageCount: id, total: amount,
}).passthrough().refine((list) => list.page <= list.pageCount);
