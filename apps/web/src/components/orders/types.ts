import {
  ORDER_PROCESSING_STATUS_LABELS,
  ORDER_TEAMS,
  type OrderLifecycleFilter,
  type OrderListItem,
  type OrderProcessingStatus,
  type OrderSettlementStatus,
  type OrderTeamId,
  type OrderTeamSummary,
} from "@/lib/orders/types";
import type { OrderOperationsStage } from "@/lib/orders/inspection-types";
import type {
  OrdersOperationsOverview,
  OrdersTeamWorkload,
} from "@/lib/orders/operations-overview";

export type ProcessingState = OrderProcessingStatus;
export type TeamId = OrderTeamId;
export type SettlementStatus = OrderSettlementStatus;
export type LifecycleTab = OrderLifecycleFilter;
export type OrderRowVM = OrderListItem;
export type TeamSummary = OrderTeamSummary;

export const PROCESSING_STATE_LABELS = ORDER_PROCESSING_STATUS_LABELS;

export const TEAM_LABELS = Object.fromEntries(
  ORDER_TEAMS.map((team) => [team.id, team.name]),
) as Record<TeamId, string>;

export const TEAM_ORDER = ORDER_TEAMS.map((team) => team.id);

export const TEAM_COLORS: Record<TeamId, string> = {
  t1: "#465fff",
  t2: "#7a5af8",
  t3: "#f59e0b",
  t4: "#06b6d4",
};

export const SETTLEMENT_LABELS: Record<SettlementStatus, string> = {
  due: "未结清",
  settled: "已结清",
  overpaid: "溢收待处理",
};

export const LIFECYCLE_TABS: Array<{ id: LifecycleTab; label: string }> = [
  { id: "open", label: "未完结" },
  { id: "completed", label: "已完成" },
  { id: "all", label: "全部记录" },
];

// ============================================================
// Visual-layer types — 工单管理 operations center
// These model the inspection/quotation/version/reassignment
// concepts from the design spec. They are visual-layer types
// defined here so the UI can render; the domain API (owned by
// Codex) will eventually provide real data in compatible shapes.
// ============================================================

/** 单据主视图 tab */
export type DocumentTab = "all" | "inspection" | "business" | "completed";

export const DOCUMENT_TABS: Array<{ id: DocumentTab; label: string }> = [
  { id: "all", label: "所有单据" },
  { id: "inspection", label: "检查与报价" },
  { id: "business", label: "维修工单" },
  { id: "completed", label: "已完成历史" },
];

/** 流程阶段：与 operations API 的领域命名保持一致。 */
export type FlowStageId = OrderOperationsStage;

export type FlowStageGroup = "inspection" | "quotation" | "repair" | "handover";

export interface FlowStageDef {
  id: FlowStageId;
  label: string;
  group: FlowStageGroup;
}

export const FLOW_STAGES: FlowStageDef[] = [
  { id: "inspection_awaiting_dispatch", label: "检查待派", group: "inspection" },
  { id: "inspection_awaiting_acceptance", label: "待接检查", group: "inspection" },
  { id: "inspection_in_progress", label: "检查中", group: "inspection" },
  { id: "inspection_awaiting_frontdesk", label: "检查待前台核对", group: "inspection" },
  { id: "quote_awaiting_customer", label: "报价待客户决定", group: "quotation" },
  { id: "quote_accepted_awaiting_order", label: "客户已采用待成立工单", group: "quotation" },
  { id: "repair_awaiting_dispatch", label: "维修待派", group: "repair" },
  { id: "repair_awaiting_acceptance", label: "待接维修", group: "repair" },
  { id: "repair_in_progress", label: "维修施工中", group: "repair" },
  { id: "blocked", label: "阻滞中", group: "repair" },
  { id: "returned_awaiting_frontdesk", label: "回单待前台", group: "handover" },
  { id: "awaiting_formal_handover", label: "待正式交单", group: "handover" },
  { id: "submitted_awaiting_collection", label: "已交单待取车", group: "handover" },
  { id: "vehicle_collected", label: "已取车", group: "handover" },
];

export const FLOW_STAGE_LABELS: Record<FlowStageId, string> = Object.fromEntries(
  FLOW_STAGES.map((s) => [s.id, s.label]),
) as Record<FlowStageId, string>;

export const FLOW_GROUP_LABELS: Record<FlowStageGroup, string> = {
  inspection: "检查流程",
  quotation: "报价流程",
  repair: "维修流程",
  handover: "交车流程",
};

/** 统一单据列表行 */
export interface DocumentListItem {
  id: string;
  type: "inspection" | "business" | "completed";
  docNo: string;
  version?: string;
  sourceDocNo?: string;
  resultDocNo?: string;
  customer: { nameZh: string; nameEn?: string; phone: string };
  vehicle: { plate: string; modelZh?: string; modelEn?: string };
  flowStage: FlowStageId;
  teamId?: TeamId;
  teamName?: string;
  handler: string;
  stageDurationLabel: string;
  nextStep: string;
  updatedAt: string;
  updatedBy: string;
  amountJmd?: number;
}

/** 流程数量 */
export interface ProcessCount {
  id: FlowStageId;
  label: string;
  count: number;
  group: FlowStageGroup;
}

/** 今日普通车辆首次派检均衡，可直接接收 operations API DTO。 */
export type FirstInspectionBalance =
  OrdersOperationsOverview["firstInspectionDistribution"];

/** 班组当前实时负载，teamName 仅为视图可选文案。 */
export type TeamWorkload = OrdersTeamWorkload & { teamName?: string };

/** 检查报价项目 */
export interface InspectionItem {
  id: string;
  nameZh: string;
  nameEn?: string;
  laborJmd: number;
  partsName?: string;
  partsJmd?: number;
  quantity: number;
  customerDecision?: "accepted" | "rejected" | "pending";
}

/** 检查报价版本 */
export interface InspectionVersion {
  version: string;
  publishedAt: string;
  publishedBy: string;
  items: InspectionItem[];
}

/** 改组记录 */
export interface ReassignmentRecord {
  id: string;
  fromTeamId: TeamId;
  fromTeamName: string;
  toTeamId: TeamId;
  toTeamName: string;
  reason: string;
  operator: string;
  timestamp: string;
}

/** 已转换项目对原检查报价版本与行的不可丢失引用。 */
export interface InspectionConversionReference {
  sourceVersion: string;
  sourceItemId: string;
  sourceItemName: string;
  linkedOrderNo: string;
}

/** 检查报告详情 */
export interface InspectionReportDetail {
  irNo: string;
  linkedOrderNo?: string;
  customer: { nameZh: string; nameEn?: string; phone: string };
  vehicle: { plate: string; modelZh?: string; modelEn?: string };
  submittedBy: { id: string; name: string; teamId?: TeamId; teamName: string };
  submittedAt?: string;
  naturalLanguageText: string;
  mileage?: string;
  photoCount: number;
  aiDraft: {
    conclusion: string;
    items: InspectionItem[];
    customerNoteZh: string;
    customerNoteEn: string;
  };
  versions: InspectionVersion[];
  currentVersion: string;
  convertedItemIds: string[];
  conversionReferences?: InspectionConversionReference[];
  reassignmentHistory: ReassignmentRecord[];
}
