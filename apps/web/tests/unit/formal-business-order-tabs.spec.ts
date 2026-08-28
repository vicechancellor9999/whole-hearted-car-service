import { expect, test } from "@playwright/test";
import {
  buildBusinessOrderWorkspaceHref,
  parseBusinessOrderWorkspace,
} from "../../src/components/orders/formal-business-order-tabs";

test("Business Order workspace values recover to the operations tab", () => {
  expect(parseBusinessOrderWorkspace("documents")).toBe("documents");
  expect(parseBusinessOrderWorkspace("history")).toBe("history");
  expect(parseBusinessOrderWorkspace("messages")).toBe("messages");
  expect(parseBusinessOrderWorkspace("unknown")).toBe("operations");
  expect(parseBusinessOrderWorkspace(null)).toBe("operations");
});

test("workspace links preserve unrelated query values and clear a message deep link outside messages", () => {
  expect(buildBusinessOrderWorkspaceHref(
    "/orders/business/17",
    new URLSearchParams("tab=history&message=41&from=vehicle"),
    "documents",
  )).toBe("/orders/business/17?tab=documents&from=vehicle");
});
