import { expect, test } from "@playwright/test";
import { businessOrderListHref, parseBusinessOrderListFilters } from "../../src/lib/orders/business-order-list-filters";

test("changing status preserves search/category and resets pagination", () => {
  expect(businessOrderListHref(new URLSearchParams("search=AB123&category=repair&page=4"), { status: "in_repair" }))
    .toBe("/orders/business?search=AB123&status=in_repair&category=repair");
});

test("clearing one filter preserves the other filters", () => {
  const current = new URLSearchParams("search=AB123&category=repair&status=assigned&page=3");
  expect(businessOrderListHref(current, { status: null })).toBe("/orders/business?search=AB123&category=repair");
  expect(businessOrderListHref(current, { search: "" })).toBe("/orders/business?status=assigned&category=repair");
});

test("paging preserves filters, trims search, and encodes user text", () => {
  expect(businessOrderListHref(new URLSearchParams("status=assigned&category=repair"), { search: " A&B ", page: 2 }))
    .toBe("/orders/business?search=A%26B&status=assigned&category=repair&page=2");
});

test("invalid URL values cannot produce invalid API filters or pages", () => {
  for (const page of ["-1", "0", "2.5", "Infinity", "bad", "9007199254740992"]) {
    expect(parseBusinessOrderListFilters(new URLSearchParams(`page=${page}&status=wrong&category=wrong`)))
      .toEqual({ search: "", status: undefined, category: undefined, page: 1 });
  }
});
