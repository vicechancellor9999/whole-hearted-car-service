import type { FormalBusinessOrderCategory, FormalBusinessOrderStatus } from "../api/formal-business-orders";

export const BUSINESS_ORDER_STATUSES = ["waiting_assignment", "assigned", "in_repair", "return_pending_review", "formally_handed_off"] as const;
const categories = ["maintenance", "repair", "inspection", "rework"] as const;
type SearchParams = { get(name: string): string | null };

export function parseBusinessOrderListFilters(params: SearchParams) {
  const requestedPage = Number(params.get("page"));
  return {
    search: (params.get("search") ?? "").trim(),
    status: BUSINESS_ORDER_STATUSES.find((status) => status === params.get("status")),
    category: categories.find((category) => category === params.get("category")),
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  };
}

export function businessOrderListHref(params: SearchParams, patch: {
  search?: string;
  status?: FormalBusinessOrderStatus | null;
  category?: FormalBusinessOrderCategory | null;
  page?: number;
}) {
  const current = parseBusinessOrderListFilters(params);
  const search = (patch.search ?? current.search).trim();
  const status = patch.status === undefined ? current.status : patch.status;
  const category = patch.category === undefined ? current.category : patch.category;
  const page = patch.page ?? 1;
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (status) query.set("status", status);
  if (category) query.set("category", category);
  if (Number.isSafeInteger(page) && page > 1) query.set("page", String(page));
  return `/orders/business${query.size ? `?${query.toString()}` : ""}`;
}
