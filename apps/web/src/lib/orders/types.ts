export const ORDER_TEAMS = [
  { id: "t1", name: "车间一组" },
  { id: "t2", name: "车间二组" },
  { id: "t3", name: "工程机械组" },
  { id: "t4", name: "钣金喷漆组" },
] as const;

export type OrderTeamId = (typeof ORDER_TEAMS)[number]["id"];
export type OrderLifecycle = "open" | "completed";
export type OrderLifecycleFilter = OrderLifecycle | "all";
export type OrderProcessingStatus =
  | "submitted_awaiting_collection"
  | "returned_awaiting_frontdesk"
  | "in_progress"
  | "awaiting_acceptance"
  | "awaiting_dispatch";
export type OrderSettlementStatus = "due" | "settled" | "overpaid";
export type InspectionQuoteVersionLabel = "V1" | "V2" | "V3";

export interface OrderSourceInspection {
  readonly reportNo: string;
  readonly version: InspectionQuoteVersionLabel;
  readonly inspectorTeamId: OrderTeamId;
}

/**
 * 业务单状态链（2026-08-11 老板口述版）：新建 → 派单 → 接单 → 回单 → 交单完结。
 * 交单即业务单完结，此时给班组结算绩效值；取车不属于业务单，归车辆/停车流程。
 */
export const ORDER_PROCESSING_STATUS_LABELS: Record<OrderProcessingStatus, string> = {
  submitted_awaiting_collection: "已交单（完结）",
  returned_awaiting_frontdesk: "已回单 · 待交单",
  in_progress: "办理中",
  awaiting_acceptance: "已派单 · 待接单",
  awaiting_dispatch: "新建 · 待派单",
};

export interface OrderLineItem {
  id: string;
  name: string;
  amountJmd: number;
}

export interface OrderMoneyEvent {
  id: string;
  amountJmd: number;
}

export interface OrderRecord {
  id: string;
  orderNo: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  customer: {
    id: string;
    nameZh: string;
    nameEn?: string;
    phone: string;
  };
  vehicle: {
    id: string;
    plate: string;
    modelZh?: string;
    modelEn?: string;
  };
  laborItems: OrderLineItem[];
  partItems: OrderLineItem[];
  parkingFeeJmd: number;
  payments: OrderMoneyEvent[];
  refunds: OrderMoneyEvent[];
  readonly sourceInspection?: OrderSourceInspection;
  teamId?: OrderTeamId;
  mechanics: Array<{ id: string; name: string }>;
  acceptedAt?: string;
  returnedAt?: string;
  submittedAt?: string;
  pickedUpAt?: string;
}

export interface OrderFinancials {
  receivableJmd: number;
  netPaidJmd: number;
  balanceJmd: number;
  settlementStatus: OrderSettlementStatus;
}

export interface OrderListItem extends OrderFinancials {
  id: string;
  orderNo: string;
  customer: {
    nameZh: string;
    nameEn?: string;
    phone: string;
  };
  vehicle: {
    plate: string;
    modelZh?: string;
    modelEn?: string;
  };
  projectNames: string[];
  laborItemCount: number;
  partItemCount: number;
  processingStatus: OrderProcessingStatus;
  lifecycle: OrderLifecycle;
  readonly sourceInspection?: OrderSourceInspection;
  teamId?: OrderTeamId;
  teamName?: string;
  mechanicNames: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  contactPhone?: string;
}

export interface OrderListQuery {
  scope?: "business";
  lifecycle?: OrderLifecycleFilter;
  status?: OrderProcessingStatus;
  teamId?: OrderTeamId;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface OrderTeamSummary {
  id: OrderTeamId;
  name: string;
  activeCount: number;
  awaitingAcceptanceCount: number;
  inProgressCount: number;
  returnedAwaitingFrontdeskCount: number;
  openCount: number;
}

export interface OrderListResponse {
  items: OrderListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  teams: OrderTeamSummary[];
}

export interface ReassignOrderInput {
  orderId: string;
  expectedFromTeamId: OrderTeamId;
  toTeamId: OrderTeamId;
  reason: string;
}

export interface OrderReassignmentAudit {
  id: string;
  orderId: string;
  orderNo: string;
  fromTeamId: OrderTeamId;
  toTeamId: OrderTeamId;
  reason: string;
  actor: {
    id: string;
    name: string;
  };
  changedAt: string;
}
