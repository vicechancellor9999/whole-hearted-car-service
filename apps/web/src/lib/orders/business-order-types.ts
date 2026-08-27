import type { ChargeLine } from "../billing/types";
import type { OrderTeamId } from "./types";

export type BusinessOrderExecutionStatus = "planned" | "in_progress" | "completed" | "cancelled";

export type BusinessOrderStartMileage =
  | {
      readonly status: "recorded";
      readonly value: number;
      readonly unit: "km" | "mile";
      readonly recordedAt: string;
      readonly recordedById: string;
      readonly recordedByName: string;
    }
  | {
      readonly status: "legacy_missing";
      readonly reason: "created_before_start_mileage_rule";
    };

/** One vehicle's business-order mileage history, joined to its order record. */
export interface VehicleBusinessOrderRow {
  readonly id: string;
  readonly businessOrderNo: string;
  readonly vehicleId: string;
  readonly executionStatus: BusinessOrderExecutionStatus;
  readonly createdAt: string;
  readonly acceptedAt: string | null;
  readonly startMileage: BusinessOrderStartMileage | null;
}

/**
 * Immutable cross-document traceability for one source project. Inspection
 * attribution and actual execution attribution deliberately remain separate.
 */
export interface SourceProjectLink {
  readonly inspectionReportId: string;
  readonly inspectionItemId: string;
  readonly quotationId: string;
  readonly quotationVersionId: string;
  readonly quotationItemId: string;
  readonly businessOrderId: string;
  readonly businessOrderItemId: string;
  readonly inspectorTeamId: OrderTeamId;
  readonly executionTeamId: OrderTeamId;
  readonly executionStatus: BusinessOrderExecutionStatus;
}

export interface BusinessOrderItem {
  readonly id: string;
  readonly sourceProject: SourceProjectLink;
  readonly chargeLines: ReadonlyArray<ChargeLine>;
}

interface VehicleReleaseBase {
  readonly id: string;
  readonly businessOrderId: string;
  readonly vehicleId: string;
}

export interface VehicleNotAuthorizedFact extends VehicleReleaseBase {
  readonly status: "not_authorized";
}

export interface VehicleAuthorizedFact extends VehicleReleaseBase {
  readonly status: "authorized";
  readonly authorizationId: string;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
  readonly specialAgreementAuthorizationId?: string;
}

export interface VehicleReleasedFact extends VehicleReleaseBase {
  readonly status: "released";
  readonly authorizationId: string;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
  readonly releasedBy: string;
  readonly releasedAt: string;
  readonly specialAgreementAuthorizationId?: string;
}

/** Release belongs to the BO/vehicle and is never an Invoice field. */
export type VehicleReleaseFact = VehicleNotAuthorizedFact | VehicleAuthorizedFact | VehicleReleasedFact;

function assertReleaseText(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label}不能为空`);
}

function assertReleaseTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new RangeError(`${label}必须为有效时间`);
}

/** Runtime boundary for audit-critical release states arriving from APIs. */
export function createVehicleReleaseFact(input: VehicleReleaseFact): VehicleReleaseFact {
  assertReleaseText(input.id, "放车事实 ID");
  assertReleaseText(input.businessOrderId, "业务单 ID");
  assertReleaseText(input.vehicleId, "车辆 ID");
  if (input.status === "not_authorized") return Object.freeze({ ...input });
  if (input.status !== "authorized" && input.status !== "released") throw new RangeError("放车状态无效");
  assertReleaseText(input.authorizationId, "放车授权 ID");
  assertReleaseText(input.authorizedBy, "授权人");
  assertReleaseTimestamp(input.authorizedAt, "授权时间");
  if (input.specialAgreementAuthorizationId !== undefined) {
    assertReleaseText(input.specialAgreementAuthorizationId, "特殊协商授权 ID");
  }
  if (input.status === "authorized") return Object.freeze({ ...input });
  assertReleaseText(input.releasedBy, "放车操作人");
  assertReleaseTimestamp(input.releasedAt, "放车时间");
  return Object.freeze({ ...input });
}

/**
 * A Business Order owns execution and vehicle-release facts. Invoice payment and
 * settlement stay independent from both execution and release.
 *
 * 整单绩效值（JMD）：系统按已确认工时项目给出默认值，正式交单前允许手工调整
 * （只改绩效值，不动执行/财务状态）。正式交单是绩效计入的唯一触发点：
 * performanceCountedAt 为 null 表示"待计入"，交单后写入计入时间表示"已计入"。
 * 绩效只归班组（executionTeamId），不归属个人。
 */
export interface BusinessOrder {
  readonly id: string;
  readonly businessOrderNo: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly executionStatus: BusinessOrderExecutionStatus;
  readonly executionTeamId: OrderTeamId;
  /** 维修工接单时记录的车辆起始里程；历史单不会伪造该事实。 */
  readonly startMileage: BusinessOrderStartMileage | null;
  readonly items: ReadonlyArray<BusinessOrderItem>;
  readonly invoiceIds: ReadonlyArray<string>;
  readonly vehicleReleaseFacts: ReadonlyArray<VehicleReleaseFact>;
  /** 整单绩效值（JMD，非负整数）。 */
  readonly performanceValueJmd: number;
  /** 绩效计入时间；null = 待计入。计入月份按该时间归属。 */
  readonly performanceCountedAt: string | null;
  /** 正式交单时间；null = 尚未正式交单。 */
  readonly formalSubmittedAt: string | null;
  /** 正式交单操作者标识。 */
  readonly formalSubmittedBy: string | null;
}

export type BusinessOrderPerformanceAuditKind = "performance_value_adjusted" | "formal_submitted";

/** 单级绩效值审计：手工调整与正式交单都必须留痕（操作者/时间/前后值）。 */
export interface BusinessOrderPerformanceAudit {
  readonly id: string;
  readonly orderId: string;
  readonly kind: BusinessOrderPerformanceAuditKind;
  readonly actorId: string;
  readonly actorName: string;
  readonly previousValueJmd: number;
  readonly newValueJmd: number;
  readonly reason?: string;
  readonly at: string;
}

// TODO(backend)：以下输入/输出类型按真实服务形态设计，演示版由 Mock API 实现。

export interface FormalSubmitOrderInput {
  readonly orderId: string;
  /** 交单前操作者核对过的绩效值，必须与单上当前绩效值一致。 */
  readonly confirmedPerformanceValueJmd: number;
  /** 乐观锁：读取详情时拿到的全局 revision。 */
  readonly expectedRevision: number;
}

export interface FormalSubmitOrderResult {
  readonly orderId: string;
  readonly performanceValueJmd: number;
  readonly formalSubmittedAt: string;
  readonly formalSubmittedBy: string;
  readonly performanceCountedAt: string;
  readonly revision: number;
  readonly audit: BusinessOrderPerformanceAudit;
}

export interface UpdateOrderPerformanceValueInput {
  readonly orderId: string;
  readonly performanceValueJmd: number;
  /** 手工调整必须填写原因，随审计留痕。 */
  readonly reason: string;
  readonly expectedRevision: number;
}

export interface UpdateOrderPerformanceValueResult {
  readonly orderId: string;
  readonly performanceValueJmd: number;
  readonly revision: number;
  readonly audit: BusinessOrderPerformanceAudit;
}

export interface TeamOrdersPerformanceSummary {
  /** 班组 id：只允许超级管理员在基础字典中实际创建的班组。 */
  readonly teamId: string;
  readonly teamName: string;
  readonly countedOrderCount: number;
  readonly countedValueJmd: number;
  readonly pendingOrderCount: number;
  readonly pendingValueJmd: number;
}

/**
 * 绩效页"已正式交单绩效值"汇总：已计入按 performanceCountedAt 归属查询月份；
 * 待计入为当前仍未交单计入的全部工单（不随月份过滤）。
 */
export interface OrdersPerformanceSummary {
  readonly month: string;
  readonly counted: { readonly orderCount: number; readonly totalValueJmd: number };
  readonly pending: { readonly orderCount: number; readonly totalValueJmd: number };
  readonly byTeam: ReadonlyArray<TeamOrdersPerformanceSummary>;
}

export interface OrdersPerformanceSummaryResponse extends OrdersPerformanceSummary {
  /** 当前全局 revision，供后续交单/调整的 expectedRevision 乐观锁使用。 */
  readonly stateRevision: number;
}
