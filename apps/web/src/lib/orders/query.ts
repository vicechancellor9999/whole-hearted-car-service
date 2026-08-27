import { toOrderListItem } from "./calculations";
import {
  ORDER_TEAMS,
  type OrderLifecycleFilter,
  type OrderListItem,
  type OrderListQuery,
  type OrderListResponse,
  type OrderProcessingStatus,
  type OrderRecord,
  type OrderTeamId,
  type OrderTeamSummary,
} from "./types";

const PROCESSING_STATUSES: OrderProcessingStatus[] = [
  "submitted_awaiting_collection",
  "returned_awaiting_frontdesk",
  "in_progress",
  "awaiting_acceptance",
  "awaiting_dispatch",
];
const LIFECYCLES: OrderLifecycleFilter[] = ["open", "completed", "all"];

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

function compact(value: string): string {
  return value.replace(/[^\p{L}\p{N}]/gu, "");
}

function matchesSearch(item: OrderListItem, search?: string): boolean {
  const normalizedSearch = normalize(search ?? "");
  if (!normalizedSearch) return true;
  const haystack = normalize([
    item.orderNo,
    item.customer.nameZh,
    item.customer.nameEn,
    item.customer.phone,
    item.contactPhone,
    item.vehicle.plate,
    item.vehicle.modelZh,
    item.vehicle.modelEn,
    ...item.projectNames,
  ].filter(Boolean).join(" "));
  const compactHaystack = compact(haystack);
  return normalizedSearch.split(" ").every((token) => {
    const compactToken = compact(token);
    return haystack.includes(token) || (compactToken.length > 0 && compactHaystack.includes(compactToken));
  });
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortNewestFirst(left: OrderListItem, right: OrderListItem): number {
  return timestamp(right.updatedAt) - timestamp(left.updatedAt)
    || timestamp(right.createdAt) - timestamp(left.createdAt)
    || right.orderNo.localeCompare(left.orderNo);
}

function buildTeamSummaries(items: OrderListItem[]): OrderTeamSummary[] {
  return ORDER_TEAMS.map((team) => {
    const teamItems = items.filter((item) => item.teamId === team.id);
    const awaitingAcceptanceCount = teamItems.filter(
      (item) => item.processingStatus === "awaiting_acceptance",
    ).length;
    const inProgressCount = teamItems.filter(
      (item) => item.processingStatus === "in_progress",
    ).length;
    return {
      id: team.id,
      name: team.name,
      activeCount: awaitingAcceptanceCount + inProgressCount,
      awaitingAcceptanceCount,
      inProgressCount,
      returnedAwaitingFrontdeskCount: teamItems.filter(
        (item) => item.processingStatus === "returned_awaiting_frontdesk",
      ).length,
      openCount: teamItems.filter((item) => item.lifecycle === "open").length,
    };
  });
}

function validateQuery(query: OrderListQuery): {
  lifecycle: OrderLifecycleFilter;
  page: number;
  pageSize: number;
} {
  if ((query.scope ?? "business") !== "business") {
    throw new Error("工单查询仅支持 business 范围");
  }
  const lifecycle = query.lifecycle ?? "open";
  if (!LIFECYCLES.includes(lifecycle)) throw new Error("工单生命周期无效");
  if (query.status && !PROCESSING_STATUSES.includes(query.status)) {
    throw new Error("工单办理状态无效");
  }
  if (query.teamId && !ORDER_TEAMS.some((team) => team.id === query.teamId)) {
    throw new Error("工单班组无效");
  }
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  if (!Number.isInteger(page) || page < 1) throw new Error("工单页码必须是大于等于 1 的整数");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
    throw new Error("工单每页数量必须是 1 至 100 的整数");
  }
  return { lifecycle, page, pageSize };
}

export function queryOrders(
  records: readonly OrderRecord[],
  query: OrderListQuery = {},
): OrderListResponse {
  const { lifecycle, page, pageSize } = validateQuery(query);
  const searchableItems = records.map(toOrderListItem).filter((item) => matchesSearch(item, query.search));
  const lifecycleItems = searchableItems.filter(
    (item) => lifecycle === "all" || item.lifecycle === lifecycle,
  );
  const teams = buildTeamSummaries(lifecycleItems);
  const filteredItems = lifecycleItems
    .filter((item) => !query.status || item.processingStatus === query.status)
    .filter((item) => !query.teamId || item.teamId === query.teamId)
    .sort(sortNewestFirst);
  const total = filteredItems.length;
  const start = (page - 1) * pageSize;

  return {
    items: filteredItems.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    teams,
  };
}

export function isOrderTeamId(value: string): value is OrderTeamId {
  return ORDER_TEAMS.some((team) => team.id === value);
}

export function isOrderProcessingStatus(value: string): value is OrderProcessingStatus {
  return PROCESSING_STATUSES.includes(value as OrderProcessingStatus);
}

export function isOrderLifecycleFilter(value: string): value is OrderLifecycleFilter {
  return LIFECYCLES.includes(value as OrderLifecycleFilter);
}
