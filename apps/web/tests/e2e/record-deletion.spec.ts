import { expect, test, type Page, type Route } from "@playwright/test";

const customerNo = "CUST-202608-9901";
const vehicleNo = "VEH-202608-9901";
const reportNo = "IR-20260827-9901";
const fingerprint = "a".repeat(64);

const consoleErrors = new WeakMap<Page, string[]>();

function observeErrors(page: Page): string[] {
  const existing = consoleErrors.get(page);
  if (existing) return existing;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  consoleErrors.set(page, errors);
  return errors;
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installSession(page: Page, role: string): Promise<void> {
  observeErrors(page);
  const origin = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3002";
  await page.context().addCookies([{
    name: "wh_session",
    value: `record-deletion-e2e-${role}`,
    url: origin,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.route("**/api/formal/auth/session", (route) => json(route, {
    account: { id: 901, username: "e2e", displayName: "E2E", role, isActive: true },
    expiresAt: "2099-01-01T00:00:00.000Z",
  }));
}

function inspectionDetail(status: "draft" | "submitted") {
  return {
    report: {
      id: 901,
      reportNo,
      vehicleId: 901,
      sourceBusinessOrderId: null,
      sourceRepairRoundId: null,
      correctionOfReportId: null,
      correctionReason: null,
      summaryZh: "删除验收测试",
      summaryEn: null,
      actualInspectorStaffMemberId: 901,
      paperPhotoFileId: null,
      status,
      createdAt: "2026-08-27T12:00:00.000Z",
      submittedAt: status === "submitted" ? "2026-08-27T13:00:00.000Z" : null,
      version: 1,
      findings: [],
    },
    vehicle: { id: 901, plate: "9901 ZZ", description: "E2E Vehicle" },
    customer: { name: "E2E Customer", phone: null, whatsapp: null, email: null },
    inspectorName: "E2E Inspector",
    sourceBusinessOrder: null,
    communications: [],
  };
}

async function installInspection(page: Page, status: "draft" | "submitted") {
  await page.route("**/api/formal/inspection-reports/901", (route) => json(route, inspectionDetail(status)));
  await page.route(/\/api\/formal\/inspection-reports\?(?:.*)/, (route) => json(route, {
    items: [], page: 1, pageSize: 20, pageCount: 0, total: 0,
  }));
}

async function installBlockedBusinessOrder(page: Page): Promise<void> {
  const orderNo = "KGN-WH-2026082799901";
  await page.route("**/api/formal/business-orders/901", (route) => json(route, {
    order: {
      id: 901, orderNo, vehicleId: 901,
      payer: { type: "person", displayName: "E2E Customer", phone: null, trn: null, contactName: null },
      vehicle: { plate: "9901 ZZ", description: "E2E Vehicle", vin: null },
      status: "waiting_assignment", currentChargeVersionNo: 1,
      createdAt: "2026-08-27T12:00:00.000Z", voided: false, voidReason: null, version: 1,
    },
    charges: {
      id: 901, businessOrderId: 901, versionNo: 1, reason: "初始收费",
      totals: {
        grossMinor: 10000, lineDiscountMinor: 0, laborDiscountMinor: 0,
        partDiscountMinor: 0, otherDiscountMinor: 0, categoryDiscountMinor: 0,
        wholeOrderDiscountMinor: 0, totalDueMinor: 10000, includedGctMinor: 1304,
      },
      items: [], notes: [], businessOrderVersion: 1,
    },
    ledger: {
      businessOrderId: 901, currentDueMinor: 10000, totalPaidMinor: 10000,
      totalRefundedMinor: 0, balanceMinor: 0, transactions: [],
    },
    refunds: [], documents: [], paymentMethods: [], chargeUnits: [],
    capabilities: { canWrite: true, canRecordPayment: false, canRefund: false },
  }));
  await page.route("**/api/formal/business-orders/901/rounds", (route) => json(route, {
    current: {
      id: 901, businessOrderId: 901, roundNo: 1, source: "initial", afterSalesIssue: null,
      status: "waiting_assignment", assignedTeamId: null, intakeMileageKm: null,
      intakePhotoFileIds: [], latestWorkReturnId: null, approvedWorkReturnId: null, version: 1,
    },
    auditTrail: [],
    history: [{
      id: 901, businessOrderId: 901, roundNo: 1, source: "initial", afterSalesIssue: null,
      status: "waiting_assignment", assignedTeamId: null, intakeMileageKm: null,
      intakePhotoFileIds: [], latestWorkReturnId: null, approvedWorkReturnId: null, version: 1,
      createdAt: "2026-08-27T12:00:00.000Z", createdBy: 901,
      updatedAt: "2026-08-27T12:00:00.000Z", events: [], formalHandoffs: [],
    }],
  }));
  await page.route("**/api/formal/master-data", (route) => json(route, {
    dictionaries: [], teams: [], staff: [], payrollParameters: [], teamCommissionRates: [],
  }));
  await page.route(/\/api\/formal\/inspection-reports\?(?:.*sourceBusinessOrderId=901.*)/, (route) => json(route, {
    items: [], page: 1, pageSize: 20, pageCount: 0, total: 0,
  }));
}

test.afterEach(async ({ page }) => {
  expect(observeErrors(page)).toEqual([]);
});

test("front desk deletes a draft inspection and the action submits only once", async ({ page }) => {
  await installSession(page, "front_desk");
  await installInspection(page, "draft");
  let executeCount = 0;
  await page.route("**/api/formal/record-deletions/preview", (route) => json(route, {
    eligible: true,
    rootRecord: { kind: "inspection_report", recordNo: reportNo, version: 1 },
    selectableLinkedRecords: [],
    dependentCounts: { inspection_report_findings: 0 },
    releasedIdentityKinds: [],
    blockers: [],
    previewFingerprint: fingerprint,
  }));
  await page.route("**/api/formal/record-deletions/execute", async (route) => {
    executeCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await json(route, {
      requestId: "delete-e2e-inspection",
      root: { kind: "inspection_report", recordNo: reportNo },
      deletedRecords: [{ kind: "inspection_report", recordNo: reportNo }],
      dependentCounts: {},
      releasedIdentityKinds: [],
      fileCleanupPending: 0,
    });
  });

  await page.goto("/orders/inspections/901");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "删除检查单" })).toBeVisible();
  await page.getByLabel("删除原因").selectOption("test_data");
  await page.getByLabel(/输入记录编号确认/).fill(reportNo);
  const confirm = page.getByRole("button", { name: "确认删除" });
  await confirm.click();
  await expect(page).toHaveURL(/\/orders\/inspections$/);
  expect(executeCount).toBe(1);
  await page.reload();
  await expect(page.getByText(reportNo)).toHaveCount(0);
});

test("submitted inspection shows the business blocker and remains unchanged", async ({ page }) => {
  await installSession(page, "super_admin");
  await installInspection(page, "submitted");
  let executeCount = 0;
  await page.route("**/api/formal/record-deletions/preview", (route) => json(route, {
    eligible: false,
    rootRecord: { kind: "inspection_report", recordNo: reportNo, version: 1 },
    selectableLinkedRecords: [],
    dependentCounts: {},
    releasedIdentityKinds: [],
    blockers: [{ code: "INSPECTION_SUBMITTED", label: "检查单已经提交", linkedRecord: null }],
    previewFingerprint: fingerprint,
  }));
  await page.route("**/api/formal/record-deletions/execute", (route) => {
    executeCount += 1;
    return json(route, {}, 500);
  });

  await page.goto("/orders/inspections/901");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("当前记录无法删除")).toBeVisible();
  await expect(page.getByText("检查单已经提交")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认删除" })).toHaveCount(0);
  expect(executeCount).toBe(0);
});

test("a business order with payment facts is blocked before confirmation", async ({ page }) => {
  await installSession(page, "front_desk");
  await installBlockedBusinessOrder(page);
  let executeCount = 0;
  await page.route("**/api/formal/record-deletions/preview", (route) => json(route, {
    eligible: false,
    rootRecord: { kind: "business_order", recordNo: "KGN-WH-2026082799901", version: 1 },
    selectableLinkedRecords: [], dependentCounts: {}, releasedIdentityKinds: [],
    blockers: [{ code: "HAS_PAYMENT", label: "业务单已有收款", linkedRecord: null }],
    previewFingerprint: fingerprint,
  }));
  await page.route("**/api/formal/record-deletions/execute", (route) => {
    executeCount += 1;
    return json(route, {}, 500);
  });

  await page.goto("/orders/business/901");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("业务单已有收款")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认删除" })).toHaveCount(0);
  expect(executeCount).toBe(0);
});

test("a non-authorized owner cannot see the delete action", async ({ page }) => {
  await installSession(page, "owner");
  await installInspection(page, "draft");
  await page.goto("/orders/inspections/901");
  await expect(page.getByText(reportNo)).toBeVisible();
  await expect(page.getByRole("button", { name: "删除", exact: true })).toHaveCount(0);
});

test("customer deletion requires explicit linked vehicle selection", async ({ page }) => {
  await installSession(page, "front_desk");
  let deleted = false;
  const person = {
    id: 901,
    customerNo,
    fullName: "E2E Delete Customer",
    normalizedPhone: "+18765559901",
    whatsapp: null,
    email: null,
    address: null,
    trn: null,
    isActive: true,
    version: 1,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };
  const vehicle = {
    id: 901,
    vehicleNo,
    plateDisplay: "9901 ZZ",
    normalizedPlate: "9901ZZ",
    vin: null,
    engineNumber: null,
    make: "Toyota",
    makeZh: "丰田",
    model: "Vitz",
    modelZh: "威驰",
    modelYear: 2020,
    color: "White",
    bodyType: "Hatchback",
    fuelType: "Petrol",
    engineCc: 1300,
    seating: 5,
    usage: null,
    specialNotes: null,
    currentOwner: { type: "person", id: 901, name: "E2E Delete Customer" },
    hasOpenDispute: false,
    openDisputeId: null,
    isActive: true,
    version: 1,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };
  const workspace = () => ({
    people: deleted ? [] : [person],
    companies: [],
    companyContacts: [],
    vehicles: deleted ? [] : [vehicle],
    vehicleAttachments: [],
    onSiteVehicleIds: [],
    ownerHistory: deleted ? [] : [{
      id: 901,
      vehicleId: 901,
      owner: { type: "person", id: 901, name: "E2E Delete Customer" },
      startedAt: "2026-08-27T12:00:00.000Z",
      endedAt: null,
      reason: null,
    }],
    totals: { people: deleted ? 0 : 1, companies: 0, vehicles: deleted ? 0 : 1 },
  });
  await page.route("**/api/formal/customer-vehicles", (route) => json(route, workspace()));
  await page.route(`**/api/formal/customers/${customerNo}`, (route) => json(route, {
    kind: "person", record: person,
  }));
  await page.route(`**/api/formal/customers/${customerNo}/driver-license-history`, (route) => json(route, {
    records: [],
  }));
  await page.route("**/api/formal/record-deletions/preview", async (route) => {
    const body = route.request().postDataJSON() as { selectedRecords?: Array<{ kind: string }> };
    const includesVehicle = body.selectedRecords?.some((record) => record.kind === "vehicle") ?? false;
    await json(route, {
      eligible: includesVehicle,
      rootRecord: { kind: "personal_customer", recordNo: customerNo, version: 1 },
      selectableLinkedRecords: [{ kind: "vehicle", recordNo: vehicleNo, version: 1 }],
      dependentCounts: includesVehicle ? { vehicle_owner_history: 1 } : {},
      releasedIdentityKinds: includesVehicle ? ["phone", "plate"] : [],
      blockers: includesVehicle ? [] : [{
        code: "HAS_VEHICLE",
        label: "存在关联车辆，请明确选择",
        linkedRecord: { kind: "vehicle", recordNo: vehicleNo },
      }],
      previewFingerprint: fingerprint,
    });
  });
  await page.route("**/api/formal/record-deletions/execute", async (route) => {
    deleted = true;
    await json(route, {
      requestId: "delete-e2e-customer",
      root: { kind: "personal_customer", recordNo: customerNo },
      deletedRecords: [
        { kind: "personal_customer", recordNo: customerNo },
        { kind: "vehicle", recordNo: vehicleNo },
      ],
      dependentCounts: { vehicle_owner_history: 1 },
      releasedIdentityKinds: ["phone", "plate"],
      fileCleanupPending: 0,
    });
  });

  await page.goto(`/customers/${customerNo}`);
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("当前记录无法删除")).toBeVisible();
  await page.getByText(vehicleNo, { exact: true }).click();
  await page.getByRole("button", { name: "重新检查关联" }).click();
  await expect(page.getByText("删除后将释放：手机号、车牌")).toBeVisible();
  await page.getByLabel("删除原因").selectOption("duplicate");
  await page.getByLabel(/输入记录编号确认/).fill(customerNo);
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.reload();
  await expect(page.getByText(customerNo)).toHaveCount(0);
  await expect(page.getByText(vehicleNo)).toHaveCount(0);
});

test("delete dialog fits a 390 by 844 viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installSession(page, "front_desk");
  await installInspection(page, "draft");
  await page.route("**/api/formal/record-deletions/preview", (route) => json(route, {
    eligible: true,
    rootRecord: { kind: "inspection_report", recordNo: reportNo, version: 1 },
    selectableLinkedRecords: [],
    dependentCounts: { inspection_report_findings: 3 },
    releasedIdentityKinds: [],
    blockers: [],
    previewFingerprint: fingerprint,
  }));

  await page.goto("/orders/inspections/901");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "删除检查单" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await page.getByTestId("record-delete-dialog").boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
});
