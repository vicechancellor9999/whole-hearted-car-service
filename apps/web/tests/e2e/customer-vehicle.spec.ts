import { expect, test, type Locator, type Page } from "@playwright/test";
import type { MockCustomerVehicleE2EScenario } from "../../src/lib/api/mock-customers";

type CustomerVehicleIdentity = "superadmin" | "frontdesk_admin" | "parts";

const CUSTOMER_STORAGE_KEY = "wh_customer_vehicle_mock_v1";

interface IdentityStorageOptions {
  preserveCustomerStorage?: boolean;
  customerStorageSeed?: unknown;
}

const identities = {
  superadmin: {
    id: "emp-001", name: "超级管理员", nameEn: "Super Admin", role: "superadmin",
    roleLabel: "超级管理员", roleLabelEn: "Super Admin", scope: "all",
    avatarColor: "#465fff", initials: "SA",
  },
  frontdesk_admin: {
    id: "emp-003", name: "王建华", nameEn: "Wang Jianhua", role: "frontdesk_admin",
    roleLabel: "前台管理员", roleLabelEn: "Front Desk Admin", scope: "all",
    avatarColor: "#0ea5e9", initials: "WJ",
  },
  parts: {
    id: "emp-004", name: "张伟", nameEn: "Zhang Wei", role: "parts",
    roleLabel: "配件专员", roleLabelEn: "Parts Specialist", scope: "assigned",
    avatarColor: "#f59e0b", initials: "ZW",
  },
} as const;

const runtimeErrors = new WeakMap<Page, string[]>();

function observeRuntimeErrors(page: Page): string[] {
  const existing = runtimeErrors.get(page);
  if (existing) return existing;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    const knownRechartsWarning = text.includes("Support for defaultProps will be removed");
    if (message.type() === "error" && !knownRechartsWarning) errors.push(`console: ${text}`);
  });
  runtimeErrors.set(page, errors);
  return errors;
}

async function useIdentity(
  page: Page,
  identity: CustomerVehicleIdentity,
  scenario?: MockCustomerVehicleE2EScenario,
  storageOptions: IdentityStorageOptions = {},
): Promise<void> {
  observeRuntimeErrors(page);
  const selected = identities[identity];
  const resetMarker = `wh_customer_vehicle_e2e_reset_${Date.now()}_${Math.random()}`;
  const session = {
    identity: selected,
    token: `offline-${selected.id}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  await page.addInitScript(
    ({ serializedSession, customerScenario, marker, preserveCustomerStorage, serializedCustomerSeed }) => {
      localStorage.setItem("wh_session", serializedSession);
      if (sessionStorage.getItem(marker) !== "done") {
        if (serializedCustomerSeed !== null) {
          localStorage.setItem("wh_customer_vehicle_mock_v1", serializedCustomerSeed);
        } else if (!preserveCustomerStorage) {
          localStorage.removeItem("wh_customer_vehicle_mock_v1");
        }
        sessionStorage.setItem(marker, "done");
      }
      (window as typeof window & { __WH_CUSTOMERS_TEST_SCENARIO__?: unknown })
        .__WH_CUSTOMERS_TEST_SCENARIO__ = customerScenario;
    },
    {
      serializedSession: JSON.stringify(session),
      customerScenario: scenario,
      marker: resetMarker,
      preserveCustomerStorage: storageOptions.preserveCustomerStorage ?? false,
      serializedCustomerSeed: storageOptions.customerStorageSeed === undefined
        ? null
        : JSON.stringify(storageOptions.customerStorageSeed),
    },
  );
}

function genuineV2CustomerEnvelope() {
  return {
    schemaVersion: 2,
    state: {
      sourceRevision: 9,
      customers: [{
        id: "CUST-E2E-V2-001",
        customerType: "individual",
        name: "Jason Wong",
        nameZh: null,
        organizationName: null,
        salutation: null,
        language: "English",
        phone: "+1 876 555 0991",
        secondaryPhone: null,
        whatsapp: null,
        email: "jason.wong@example.test",
        preferredChannel: "phone",
        address: "Kingston",
        gender: null,
        birthDate: null,
        trn: null,
        licensePhotoUrl: null,
        source: "walk-in",
        riskLevel: "normal",
        riskNote: null,
        riskFlags: [],
        verification: {
          otpVerified: true,
          otpVerifiedAt: "2025-03-01T00:00:00.000Z",
          kycStatus: "verified",
          kycVerifiedAt: "2025-03-02T00:00:00.000Z",
          agreementStatus: "signed",
          agreementVersion: "v1.2",
          agreementSignedAt: "2025-03-03T00:00:00.000Z",
        },
        creditEligibility: {
          eligible: false,
          registeredAt: null,
          registeredBy: null,
          signatureNote: null,
          signatureDataUrl: null,
          cancelledAt: null,
          cancelledBy: null,
        },
        tags: ["legacy-user-value"],
        profileCompleteness: "incomplete",
        recentBusiness: "Legacy service",
        recentBusinessDate: "2026-01-01T00:00:00.000Z",
        activeBusinessCount: 1,
        status: "active",
        contacts: [{ id: "CONTACT-V2-001", name: "Duplicate Jason", role: "friend", phone: "+1 876 555 0992", email: null, isPrimary: false }],
        orders: [],
        paymentSummary: { totalAmount: 100, paidAmount: 100, unpaidAmount: 0, orderCount: 1 },
        communications: [],
        tasks: [],
        attachments: [],
        notes: [{ id: "NOTE-V2-001", content: "Preserve migrated note", author: "emp-1", time: "2026-01-01T00:00:00.000Z" }],
        changeHistory: [],
        revision: 7,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      vehicles: [{
        id: "VEH-E2E-V2-001",
        plate: "991 ZZ",
        vin: "1HGBH41JXMN299991",
        engineNumber: null,
        make: "Honda",
        model: "Fit",
        makeZh: "本田",
        modelZh: "飞度",
        variant: null,
        year: 2020,
        color: null,
        powertrain: null,
        bodyType: null,
        seating: null,
        ccRating: null,
        fuelType: null,
        mileage: 50000,
        mileageUnit: "km",
        mileageRecordedAt: "2026-01-01T00:00:00.000Z",
        usage: null,
        specialNotes: null,
        recentService: "Legacy service",
        recentServiceDate: "2026-01-01T00:00:00.000Z",
        photos: [],
        linkedOrderCount: 1,
        totalAmount: 100,
        unpaidAmount: 0,
        status: "off_site",
        serviceHistory: [],
        partsNeeds: [{ id: "PART-V2-001", name: "Filter", urgency: "normal", status: "pending", estimatedCost: 10 }],
        tasks: [{ id: "VEH-TASK-V2-001", title: "Preserve migrated task", status: "pending", assignee: "emp-1", dueAt: null }],
        attachments: [],
        changeHistory: [],
        revision: 4,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      relationships: [{
        id: "REL-E2E-V2-001",
        vehicleId: "VEH-E2E-V2-001",
        customerId: "CUST-E2E-V2-001",
        startedAt: "2025-01-01T00:00:00.000Z",
        endedAt: null,
      }],
      auditRecords: [],
    },
  };
}

async function openWorkspace(page: Page, url = "/customers"): Promise<void> {
  const response = await page.goto(url);
  expect(response?.ok()).toBe(true);
  const heading = url.includes("/vehicles") ? "vehicles-heading" : "customers-heading";
  await expect(page.getByTestId(heading)).toBeVisible();
}

function relativeLuminance(rgb: string): number {
  const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`无法解析颜色：${rgb}`);
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

async function contrastRatio(locator: Locator): Promise<number> {
  const colors = await locator.evaluate((node) => {
    const foreground = getComputedStyle(node).color;
    let current: Element | null = node;
    let background = "rgba(0, 0, 0, 0)";
    while (current) {
      const candidate = getComputedStyle(current).backgroundColor;
      if (!candidate.endsWith(", 0)") && candidate !== "transparent") {
        background = candidate;
        break;
      }
      current = current.parentElement;
    }
    return { foreground, background };
  });
  const light = Math.max(relativeLuminance(colors.foreground), relativeLuminance(colors.background));
  const dark = Math.min(relativeLuminance(colors.foreground), relativeLuminance(colors.background));
  return (light + 0.05) / (dark + 0.05);
}

test.afterEach(async ({ page }) => {
  expect(observeRuntimeErrors(page)).toEqual([]);
});

test("a fresh browser initializes the default preview session and loads the protected workspace without retry", async ({ page }) => {
  observeRuntimeErrors(page);
  await page.addInitScript(() => {
    const loadCount = Number(sessionStorage.getItem("wh_fresh_session_load_count") ?? "0") + 1;
    sessionStorage.setItem("wh_fresh_session_load_count", String(loadCount));
    if (sessionStorage.getItem("wh_fresh_session_saw_error") === null) {
      sessionStorage.setItem("wh_fresh_session_saw_error", "false");
    }
    const observeWorkspace = () => {
      const rememberError = () => {
        if (document.querySelector('[data-testid="customer-workspace-error"]')) {
          sessionStorage.setItem("wh_fresh_session_saw_error", "true");
        }
      };
      new MutationObserver(rememberError).observe(document.documentElement, { childList: true, subtree: true });
      rememberError();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", observeWorkspace, { once: true });
    } else {
      observeWorkspace();
    }
  });

  await openWorkspace(page);
  await expect(page.getByTestId("customer-row-CUST-UAT-001")).toContainText("Alicia Bennett", { timeout: 5_000 });
  await expect(page.getByTestId("customer-workspace-error")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const serialized = localStorage.getItem("wh_session");
    if (!serialized) return null;
    return (JSON.parse(serialized) as { identity?: { role?: string } }).identity?.role ?? null;
  })).toBe("superadmin");
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("wh_fresh_session_load_count")))).toBe(2);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("wh_fresh_session_saw_error"))).toBe("false");
});

test("typed API workspace keeps the global shell and supports tabs, search, filters, and semantic table controls", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);

  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByTestId("dashboard-header")).toHaveCount(0);
  await expect(page.getByTestId("page-header")).toBeVisible();
  await expect(page.getByRole("link", { name: "客户档案" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("customer-row-CUST-UAT-001")).toContainText("Alicia Bennett");
  await expect(page.getByText("Marcus Reid", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("customer-card-filter-all")).toContainText("300");
  await expect(page.getByTestId("customer-card-filter-vehicles")).toContainText("在场");

  const firstRow = page.getByTestId("customer-row-CUST-UAT-001");
  await expect(firstRow).toHaveAttribute("role", "link");
  await expect(firstRow).toHaveAttribute("tabindex", "0");
  const opener = page.getByTestId("customer-open-CUST-UAT-001");
  await opener.focus();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/, { timeout: 10_000 });
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await page.getByTestId("customer-detail-back").click();
  await expect(page).toHaveURL(/\/customers$/);

  await page.getByTestId("search-input-customers").fill("north coast");
  await expect(page.getByTestId("customer-row-CUST-UAT-002")).toContainText("North Coast Logistics Ltd");
  await expect(page.getByTestId("customer-row-CUST-UAT-001")).toHaveCount(0);
  await page.getByTestId("search-input-customers").fill("7012 AB");
  await expect(page.getByTestId("customer-row-CUST-UAT-001")).toContainText("Alicia Bennett");
  await page.getByTestId("filter-reset").click();
  await page.getByTestId("filter-status").selectOption("inactive");
  await expect(page.getByTestId("customer-row-CUST-UAT-004")).toContainText("Seaview Villas Group");

  await page.goto("/vehicles");
  await expect(page).toHaveURL(/\/vehicles$/);
  await expect(page.getByTestId("vehicle-row-VEH-UAT-001")).toContainText("7012 AB");
  await page.getByTestId("search-input-vehicles").fill("Honda CR-V");
  await expect(page.getByTestId("vehicle-row-VEH-UAT-001")).toContainText("7012 AB");
  await page.getByTestId("search-input-vehicles").fill("555 0101");
  await expect(page.getByTestId("vehicle-row-VEH-UAT-003")).toContainText("9154 DZ");
  await expect(page.getByTestId("vehicle-row-VEH-UAT-001")).toContainText("7012 AB");
});

test("customer status filters do not affect the separate vehicle archive page", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await expect(page.getByTestId("tab-vehicles")).toHaveCount(0);

  await page.getByTestId("filter-status").selectOption("inactive");
  await page.getByTestId("filter-status").selectOption("blacklisted");

  await page.goto("/vehicles");
  await expect(page.locator('[data-testid^="vehicle-row-"]')).toHaveCount(8);
  await expect(page.getByTestId("vehicle-pagination")).toContainText("共 324 条");
  await expect(page.getByTestId("vehicle-row-VEH-UAT-001")).toContainText("7012 AB");
});

test("customer current vehicle counts ignore ended relationships", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await expect(page.getByTestId("customer-row-CUST-UAT-001").getByTestId("customer-active-vehicle-count-CUST-UAT-001")).toHaveText("1");
  await expect(page.getByTestId("customer-row-CUST-UAT-002").getByTestId("customer-active-vehicle-count-CUST-UAT-002")).toHaveText("2");
  await expect(page.getByTestId("customer-row-CUST-UAT-003").getByTestId("customer-active-vehicle-count-CUST-UAT-003")).toHaveText("0");
});

test("formal customer and vehicle lists keep useful filters and hide deprecated static business fields", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);

  await expect(page.getByTestId("filter-type")).toBeVisible();
  await expect(page.getByTestId("filter-risk")).toBeVisible();
  await expect(page.getByTestId("filter-status")).toBeVisible();
  await expect(page.getByTestId("filter-channel")).toBeVisible();
  const firstCustomerRow = page.getByTestId("customer-row-CUST-UAT-001");
  await expect(firstCustomerRow).toContainText("WhatsApp");
  await expect(firstCustomerRow).toContainText(/正常|关注|高风险/);
  await expect(firstCustomerRow.getByTestId("customer-profile-CUST-UAT-001")).toContainText(/资料完整|待完善/);
  await expect(firstCustomerRow).toContainText("alicia.bennett@synthetic.example");
  await expect(firstCustomerRow.getByTestId("customer-recent-business-CUST-UAT-001")).toHaveCount(0);
  // 欠账列 2026-08-14 按老板要求恢复（Invoice 权威来源），Alicia 为欠账锚点
  await expect(firstCustomerRow.getByTestId("customer-debt-CUST-UAT-001")).toContainText("JMD");

  await page.getByTestId("filter-risk").selectOption("high");
  const highRows = page.locator('[data-testid^="customer-row-"]');
  await expect(highRows.first()).toBeVisible();
  for (const row of await highRows.all()) await expect(row).toContainText("高风险");
  await page.getByTestId("filter-reset").click();
  await page.getByTestId("filter-channel").selectOption("email");
  await expect(page.locator('[data-testid^="customer-row-"]')).not.toHaveCount(0);
  await expect(page.locator('[data-testid^="customer-row-"]').first()).toContainText("邮件");

  await page.goto("/vehicles");
  await expect(page.getByTestId("filter-make")).toBeVisible();
  await expect(page.getByTestId("filter-status")).toBeVisible();
  await expect(page.getByTestId("filter-unpaid")).toHaveCount(0);
  const vehicleRow = page.getByTestId("vehicle-row-VEH-UAT-001");
  await expect(vehicleRow).toContainText("艾丽西亚·贝内特 / Alicia Bennett");
  await expect(vehicleRow.getByTestId("vehicle-mileage-VEH-UAT-001")).toBeVisible();
  await expect(vehicleRow.getByTestId("vehicle-business-VEH-UAT-001")).toHaveCount(0);
  await expect(vehicleRow.getByTestId("vehicle-recent-service-VEH-UAT-001")).toHaveCount(0);
});

test("customer detail merges contact data into formal details and removes deprecated profile and business blocks", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await page.getByTestId("customer-open-CUST-UAT-001").click();
  await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);

  const detail = page.getByTestId("customer-detail-page");
  await expect(detail).toContainText("Alicia Bennett");
  await expect(detail).toContainText("alicia.bennett@synthetic.example");
  const formalDetails = page.getByTestId("customer-formal-details");
  await expect(page.getByTestId("customer-section-profile")).toContainText(/正式资料|资料完整/);
  await expect(formalDetails).toContainText("主要电话");
  await expect(formalDetails).toContainText("Email");
  await expect(formalDetails).toContainText("alicia.bennett@synthetic.example");
  await expect(page.getByTestId("customer-registration-time")).toBeVisible();
  await expect(page.getByTestId("customer-section-current-vehicles")).toContainText("7012 AB");
  await expect(page.getByTestId("customer-section-historical-vehicles")).toBeVisible();
  await expect(page.getByTestId("customer-section-notes")).toContainText("Prefers morning pickup");
  await expect(page.getByTestId("customer-financial-hero")).toContainText("挂账资格"); // 栏已删，按钮进英雄卡（2026-08-16 老板定）
  await expect(page.getByTestId("customer-edit-btn")).toBeVisible();
  await expect(page.getByTestId("customer-section-contacts")).toHaveCount(0);
  await expect(page.getByTestId("customer-section-payment")).toHaveCount(0);
  await expect(page.getByTestId("customer-section-bo-history")).toHaveCount(0);
  await expect(page.getByTestId("customer-section-attachments")).toHaveCount(0);
  await expect(page.getByTestId("customer-section-history")).toHaveCount(0);
  await expect(detail).not.toContainText("Customer referral");
  await expect(detail).not.toContainText("Brake pad replacement & oil change");
  await expect(detail).not.toContainText("loyal");
  await expect(detail).not.toContainText("morning-pickup");
});

test("vehicle detail keeps master, ownership, photos, parts, tasks, and attachments while hiding static business", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page, "/vehicles");
  await page.getByTestId("vehicle-open-VEH-UAT-001").click();
  await expect(page).toHaveURL(/\/vehicles\/VEH-UAT-001$/);

  const detail = page.getByTestId("vehicle-detail-page");
  await expect(detail).toContainText("7012 AB");
  await expect(page.getByTestId("vehicle-section-master")).toContainText("Honda CR-V");
  await expect(page.getByTestId("vehicle-section-photos")).toBeVisible();
  await expect(page.getByTestId("vehicle-section-current-customers")).toContainText("艾丽西亚·贝内特 / Alicia Bennett");
  await expect(page.getByTestId("vehicle-section-historical-customers")).toBeVisible();
  await expect(page.getByTestId("vehicle-section-mileage")).toHaveCount(0);
  const businessOrderSection = page.getByTestId("vehicle-section-business-orders");
  await expect(businessOrderSection).toBeVisible();
  // Clean v2 demo: only the three explicitly linked BOs belong to VEH-UAT-001.
  await expect(businessOrderSection.locator('[data-testid^="vehicle-business-order-demo-v2-"]')).toHaveCount(3);
  const newestBusinessOrder = page.getByTestId("vehicle-business-order-demo-v2-refunds");
  await expect(newestBusinessOrder).toContainText("KGN-WH-2026072000003");
  await expect(page.getByTestId("vehicle-business-order-mileage-demo-v2-refunds")).toContainText("入场里程：未记录");
  await expect(page.getByTestId("vehicle-section-parts-needs")).toContainText("PART-UAT-001");
  await expect(page.getByTestId("vehicle-section-tasks")).toBeVisible();
  await expect(page.getByTestId("vehicle-section-tasks")).toContainText("暂无任务");
  await expect(page.getByTestId("vehicle-section-tasks")).not.toContainText("TASK-VEH-UAT-001");
  await expect(page.getByTestId("vehicle-section-attachments")).toBeVisible();
  await expect(page.getByTestId("vehicle-section-summary")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-section-service-history")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-section-history")).toHaveCount(0);
  await expect(detail).not.toContainText("SERVICE-UAT-001");
  await expect(page.getByTestId("vehicle-edit-btn")).toBeVisible();

  await newestBusinessOrder.click();
  await expect(page).toHaveURL(/\/orders\/business\/demo-v2-refunds$/, { timeout: 10_000 });
  await expect(page.getByTestId("quick-detail-no")).toContainText("KGN-WH-2026072000003");
});

test("default, invalid, and legacy URLs canonicalize, and detail routes render pages instead of modals", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page, "/customers");
  await expect(page).toHaveURL(/\/customers$/);

  await page.goto("/customers?view=wrong");
  await expect(page.getByTestId("customers-heading")).toBeVisible();

  await page.goto("/customers?view=vehicles");
  await expect(page).toHaveURL(/\/vehicles$/);
  await expect(page.getByTestId("vehicles-heading")).toBeVisible();

  await page.goto("/customers?view=customers&customer=CUST-UAT-001&vehicle=VEH-UAT-001");
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
  await expect(page.getByTestId("customer-list")).toBeVisible();

  await page.goto("/customers/CUST-UAT-001");
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await expect(page.getByTestId("customer-section-profile")).toContainText("Alicia Bennett");
  await page.goto("/vehicles/VEH-UAT-001");
  await expect(page.getByTestId("vehicle-detail-page")).toBeVisible();
  await expect(page.getByTestId("vehicle-section-master")).toContainText("7012 AB");
});

test("detail pages return to the list and stay synchronized with browser history", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await page.getByTestId("customer-open-CUST-UAT-001").click();
  await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await page.getByTestId("customer-detail-back").click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.goBack();
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId("customer-detail-page")).toHaveCount(0);

  await page.getByTestId("customer-open-CUST-UAT-002").click();
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("customer-detail-page")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
});

test("cross-detail navigation links customer and vehicle pages in both directions", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await page.getByTestId("customer-open-CUST-UAT-001").click();
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await page.getByTestId("customer-vehicle-link-VEH-UAT-001").click();
  await expect(page).toHaveURL(/\/vehicles\/VEH-UAT-001$/);
  await expect(page.getByTestId("vehicle-detail-page")).toBeVisible();
  await expect(page.getByTestId("vehicle-section-master")).toContainText("7012 AB");
  await page.getByTestId("vehicle-customer-link-CUST-UAT-001").click();
  await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await expect(page.getByTestId("customer-section-profile")).toContainText("Alicia Bennett");

  await page.goto("/vehicles");
  await page.getByTestId("vehicle-open-VEH-UAT-001").click();
  await expect(page.getByTestId("vehicle-detail-page")).toBeVisible();
  await page.getByTestId("vehicle-customer-link-CUST-UAT-001").click();
  await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
});

test("the onboarding entry replaces legacy create while customer edit hard-blocks duplicate phone numbers", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await expect(page.getByTestId("customer-row-CUST-UAT-001")).toBeVisible();
  await page.getByTestId("create-customer-btn").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toBeVisible();
  await expect(page.getByTestId("customer-form-dialog")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-send-otp")).toBeDisabled();
  await page.getByTestId("onboarding-cancel").click();
  await expect(page.getByTestId("customer-onboarding-dialog")).toHaveCount(0);

  await page.getByTestId("customer-open-CUST-UAT-001").click();
  await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);
  await page.getByTestId("customer-edit-btn").click();
  await page.getByTestId("form-customer-phone").fill("+1 876 555 0102");
  await page.getByTestId("form-save").click();
  await expect(page.getByTestId("form-save-error")).toContainText("电话号码已属于其他客户档案");
  await expect(page.getByTestId("customer-duplicate-candidates")).toHaveCount(0);
  await expect(page.getByTestId("form-customer-phone")).toHaveValue("+1 876 555 0102");

  await page.getByTestId("form-customer-phone").fill("+1 876 000 0998");
  await page.getByTestId("form-customer-address").fill("Kingston 8");
  await page.getByTestId("form-save").click();
  await expect(page.getByTestId("customer-duplicate-candidates")).toBeVisible();
  await expect(page.getByTestId("customer-duplicate-candidates")).not.toContainText(/phone|whatsapp/i);
  await expect(page.getByTestId("confirm-customer-duplicate")).toHaveCount(0);
  await expect(page.getByTestId("form-save")).toBeEnabled();
  await page.getByTestId("form-save").click();
  await expect(page.getByTestId("customer-form-dialog")).toHaveCount(0);
  await expect(page.getByTestId("customer-detail-page")).toContainText("Alicia Bennett");
  await expect(page.getByTestId("customer-revision")).toContainText("2");
});

test("an existing customer can clear every contact channel and still save an unrelated edit", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/customers/CUST-UAT-003");
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await page.getByTestId("customer-edit-btn").click();
  await page.getByTestId("form-customer-phone").fill("");
  await page.getByTestId("form-customer-secondary-phone").fill("");
  await page.getByTestId("form-customer-whatsapp").fill("");
  await page.getByTestId("form-customer-email").fill("");
  await page.getByTestId("form-customer-address").fill("Nonblocking edit address");
  await page.getByTestId("form-save").click();
  await expect(page.getByTestId("form-customer-contact-error")).toHaveCount(0);
  await expect(page.getByTestId("customer-duplicate-candidates")).toBeVisible();
  await expect(page.getByTestId("customer-duplicate-candidates")).not.toContainText(/phone|whatsapp/i);
  await page.getByTestId("form-save").click();
  await expect(page.getByTestId("customer-form-dialog")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
  await expect(page.getByTestId("customer-formal-details")).toContainText("Nonblocking edit address");
  await expect(page.getByTestId("verification-row-otp")).toContainText("尚未登记可验证号码");
  await expect(page.getByTestId("verification-row-kyc")).toContainText("尚未上传驾驶证图片");
  const persisted = await page.evaluate((storageKey) => {
    const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      state?: { customers?: Array<Record<string, unknown>> };
    };
    const customer = envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-003");
    return customer ? {
      phone: customer.phone,
      secondaryPhone: customer.secondaryPhone,
      whatsapp: customer.whatsapp,
      email: customer.email,
      address: customer.address,
    } : null;
  }, CUSTOMER_STORAGE_KEY);
  expect(persisted).toEqual({
    phone: null,
    secondaryPhone: null,
    whatsapp: null,
    email: null,
    address: "Nonblocking edit address",
  });
});

test("save failure keeps customer edit input available for a same-path retry", async ({ page }) => {
  await useIdentity(page, "superadmin", { failNext: { customerVehicleSave: "演示保存失败" } });
  await openWorkspace(page);
  await page.getByTestId("customer-open-CUST-UAT-003").click();
  await page.getByTestId("customer-edit-btn").click();
  await page.getByTestId("form-customer-email").fill("retry.ui@example.test");
  await page.getByTestId("form-save").click();
  await expect(page.getByTestId("customer-duplicate-candidates")).toBeVisible();
  await expect(page.getByTestId("confirm-customer-duplicate")).toHaveCount(0);
  await page.getByTestId("form-save").click();
  await expect(page.getByTestId("form-save-error")).toContainText("演示保存失败");
  await expect(page.getByTestId("form-customer-email")).toHaveValue("retry.ui@example.test");
  await page.getByTestId("form-save").click();
  await expect(page.getByTestId("customer-form-dialog")).toHaveCount(0, { timeout: 8_000 });
  await expect(page.getByTestId("customer-formal-details")).toContainText("retry.ui@example.test");
});

test("customer onboarding exposes staged business gates and vehicle forms retain linked validation errors", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await page.getByTestId("create-customer-btn").click();
  await expect(page.getByTestId("onboarding-send-otp")).toBeDisabled();
  await expect(page.getByTestId("onboarding-license-step")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("onboarding-profile-step")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("onboarding-preview")).toBeDisabled();
  await expect(page.getByTestId("onboarding-create")).toBeDisabled();
  await page.getByTestId("onboarding-cancel").click();

  await page.goto("/vehicles");
  await page.getByTestId("create-vehicle-btn").click();
  await page.getByTestId("vehicle-form-save").click();
  await expect(page.getByTestId("form-vehicle-make-error")).toContainText("必填");
  await expect(page.getByTestId("form-vehicle-model-error")).toContainText("必填");
  await expect(page.getByTestId("form-vehicle-year-error")).toContainText("必填");
  await expect(page.getByTestId("form-vehicle-make")).toBeFocused();
  await page.getByTestId("form-vehicle-make").fill("Honda");
  await page.getByTestId("form-vehicle-model").fill("Fit");
  await page.getByTestId("form-vehicle-year").fill("1800");
  await page.getByTestId("vehicle-form-save").click();
  await expect(page.getByTestId("form-vehicle-year-error")).toContainText(/1886|年份/);
  await page.getByTestId("form-vehicle-year").fill("2024");
  await expect(page.getByTestId("form-vehicle-mileage")).toHaveCount(0);
  await expect(page.getByTestId("form-vehicle-mileage-unit")).toHaveCount(0);
  await expect(page.getByTestId("form-vehicle-mileage-time")).toHaveCount(0);
  await expect(page.getByTestId("form-vehicle-linked-orders")).toHaveCount(0);
  await expect(page.getByTestId("form-vehicle-total-amount")).toHaveCount(0);
  await expect(page.getByTestId("form-vehicle-unpaid-amount")).toHaveCount(0);
});

test("dirty forms guard X, Escape, backdrop, and cancel on the detail pages", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await page.getByTestId("customer-open-CUST-UAT-001").click();
  await page.getByTestId("customer-edit-btn").click();
  const nameInput = page.getByTestId("form-customer-name");
  await nameInput.fill("Unsaved Alicia");

  await page.getByTestId("customer-form-close").click();
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
  await expect(page.getByTestId("discard-confirmation")).toContainText("放弃更改");
  await expect(page.getByTestId("continue-editing")).toBeFocused();
  await page.getByTestId("continue-editing").click();
  await expect(nameInput).toHaveValue("Unsaved Alicia");
  await expect(page.getByTestId("customer-form-close")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("discard-confirmation")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("discard-confirmation")).toHaveCount(0);
  await expect(nameInput).toHaveValue("Unsaved Alicia");

  await page.getByTestId("customer-form-dialog-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(page.getByTestId("discard-confirmation")).toBeVisible();
  await page.getByTestId("continue-editing").click();
  await page.getByTestId("form-cancel").click();
  await expect(page.getByTestId("discard-confirmation")).toBeVisible();
  await page.getByTestId("discard-changes").click();
  await expect(page.getByTestId("customer-form-dialog")).toHaveCount(0);
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();

  await page.goto("/vehicles");
  await page.getByTestId("vehicle-open-VEH-UAT-001").click();
  await page.getByTestId("vehicle-edit-btn").click();
  await page.getByTestId("form-vehicle-model").fill("Unsaved CR-V");
  await page.keyboard.press("Escape");
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
  await expect(page.getByTestId("discard-confirmation")).toContainText("放弃更改");
  await page.getByTestId("discard-changes").click();
  await expect(page.getByTestId("vehicle-form-dialog")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-detail-page")).toBeVisible();
});

test("clean edit forms close directly and dirty forms opened from a direct page entry are guarded", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page);
  await page.getByTestId("customer-open-CUST-UAT-001").click();
  await page.getByTestId("customer-edit-btn").click();
  await page.getByTestId("form-cancel").click();
  await expect(page.getByTestId("customer-form-dialog")).toHaveCount(0);
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();

  await page.goto("/settings");
  await page.goto("/customers/CUST-UAT-001");
  await page.getByTestId("customer-detail-page").waitFor();
  await expect(page.getByTestId("customer-section-profile")).toContainText("Alicia Bennett");
  await page.getByTestId("customer-edit-btn").click();
  await page.getByTestId("form-customer-name").fill("Direct entry unsaved Alicia");
  await page.getByTestId("form-cancel").click();
  await expect(page.getByTestId("discard-confirmation")).toBeVisible();
  await page.getByTestId("discard-changes").click();
  await expect(page.getByTestId("customer-form-dialog")).toHaveCount(0);
  await expect(page.getByTestId("customer-detail-page")).toBeVisible();
});

test("vehicle preview blocks duplicate plates, saves one current customer, and updates by revision", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page, "/vehicles");
  await page.getByTestId("create-vehicle-btn").click();
  await page.getByTestId("form-vehicle-plate").fill("7012 ab");
  await page.getByTestId("form-vehicle-make").fill("Honda");
  await page.getByTestId("form-vehicle-model").fill("Duplicate");
  await page.getByTestId("form-vehicle-year").fill("2024");
  await page.getByTestId("vehicle-form-save").click();
  await expect(page.getByTestId("vehicle-duplicate-existing")).toContainText("VEH-UAT-001");
  await expect(page.getByTestId("vehicle-form-save")).toBeDisabled();

  await page.getByTestId("form-vehicle-plate").fill("NEW909");
  await page.getByTestId("form-vehicle-model").fill("Fit");
  await expect(page.locator('[data-testid^="vehicle-relationship-"]')).toHaveCount(0);
  const createCurrentCustomer = page.getByTestId("form-vehicle-current-customer");
  await expect(createCurrentCustomer).toHaveAccessibleName("当前绑定客户");
  await expect(createCurrentCustomer).toHaveAccessibleDescription(/换绑.*保留历史/);
  await createCurrentCustomer.selectOption("CUST-UAT-001");
  await page.getByTestId("vehicle-form-save").click();
  await expect(page.getByTestId("vehicle-form-dialog")).toHaveCount(0);
  await expect(page.getByTestId("search-input-vehicles")).toBeEnabled();
  await page.getByTestId("search-input-vehicles").fill("NEW909");
  await expect.poll(async () => page.locator('[data-testid^="vehicle-row-"]').count(), { timeout: 8000 }).toBe(1);
  await expect(page.locator('[data-testid^="vehicle-row-"]').first()).toContainText("NEW909");

  await page.getByRole("button", { name: /查看车辆 NEW ?909 详情/ }).click();
  await expect(page).toHaveURL(/\/vehicles\/VEH-[A-Z0-9-]+$/);
  await expect(page.getByTestId("vehicle-active-relationships")).toContainText("艾丽西亚·贝内特 / Alicia Bennett");
  await expect(page.getByTestId("vehicle-active-relationships")).not.toContainText("North Coast Logistics Ltd");
  await page.getByTestId("vehicle-edit-btn").click();
  await page.getByTestId("form-vehicle-model").fill("Jazz");
  await page.getByTestId("vehicle-form-save").click();
  await expect(page.getByTestId("vehicle-detail-page")).toContainText("Jazz");
  await expect(page.getByTestId("vehicle-revision")).toContainText("2");
});

test("editing a vehicle master field preserves its legacy mileage storage unchanged", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/vehicles/VEH-UAT-001");
  await expect(page.getByTestId("vehicle-section-master")).toContainText("7012 AB");

  const storedMileage = async () => page.evaluate((storageKey) => {
    const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
      state?: { vehicles?: Array<{ id?: string; mileage?: unknown; mileageUnit?: unknown; mileageRecordedAt?: unknown }> };
    } | null;
    const vehicle = envelope?.state?.vehicles?.find((entry) => entry.id === "VEH-UAT-001");
    return vehicle ? {
      mileage: vehicle.mileage,
      mileageUnit: vehicle.mileageUnit,
      mileageRecordedAt: vehicle.mileageRecordedAt,
    } : null;
  }, CUSTOMER_STORAGE_KEY);
  await page.getByTestId("vehicle-edit-btn").click();
  await page.getByTestId("form-vehicle-color").fill("Midnight Blue");
  await page.getByTestId("vehicle-form-save").click();
  await expect(page.getByTestId("vehicle-form-dialog")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-section-master")).toContainText("Midnight Blue");
  expect(await storedMileage()).toEqual({
    mileage: 84_200,
    mileageUnit: "km",
    mileageRecordedAt: "2026-08-05T10:30:00.000Z",
  });
});

test("vehicle update hands over its only current customer, preserves history, and can become unbound", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await openWorkspace(page, "/vehicles");
  await page.getByTestId("vehicle-open-VEH-UAT-003").click();
  await expect(page).toHaveURL(/\/vehicles\/VEH-UAT-003$/);
  await page.getByTestId("vehicle-edit-btn").click();
  const currentCustomer = page.getByTestId("form-vehicle-current-customer");
  await expect(currentCustomer).toHaveValue("CUST-UAT-002");
  await currentCustomer.selectOption("CUST-UAT-003");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("discard-confirmation")).toBeVisible();
  await page.getByTestId("continue-editing").click();
  await expect(currentCustomer).toHaveValue("CUST-UAT-003");
  await page.getByTestId("vehicle-form-save").click();

  const active = page.getByTestId("vehicle-active-relationships");
  await expect(active).toContainText("Marcia Reid");
  await expect(active).not.toContainText("North Coast Logistics Ltd");
  await expect(active).not.toContainText("Alicia Bennett");
  const history = page.getByTestId("vehicle-section-historical-customers");
  await expect(history.locator('[data-testid^="vehicle-customer-history-"]')).toHaveCount(3);
  await expect(history).toContainText("艾丽西亚·贝内特 / Alicia Bennett");
  await expect(history).toContainText("North Coast Logistics Ltd");
  await expect(history).toContainText("Marcia Reid");

  await page.getByTestId("vehicle-detail-back").click();
  await expect(page).toHaveURL(/\/vehicles$/);
  await expect(page.getByTestId("vehicle-row-VEH-UAT-003")).toContainText("Marcia Reid");
  await expect(page.getByTestId("vehicle-row-VEH-UAT-003")).not.toContainText("North Coast Logistics Ltd");
  await page.getByTestId("vehicle-open-VEH-UAT-003").click();

  await page.getByTestId("vehicle-edit-btn").click();
  await expect(page.getByTestId("form-vehicle-current-customer")).toHaveValue("CUST-UAT-003");
  await page.getByTestId("form-vehicle-current-customer").selectOption("");
  await page.getByTestId("vehicle-form-save").click();
  await expect(page.getByTestId("vehicle-active-relationships")).toContainText("暂无当前客户关系");
  const historyAfterUnbind = page.getByTestId("vehicle-section-historical-customers");
  await expect(historyAfterUnbind.locator('[data-testid^="vehicle-customer-history-"]')).toHaveCount(4);
  await expect(historyAfterUnbind).toContainText("Marcia Reid");

  await page.getByTestId("vehicle-detail-back").click();
  await expect(page.getByTestId("vehicle-row-VEH-UAT-003")).toContainText("暂无当前客户");
});

test("a successful onboarding create followed by a refresh failure reports the read failure and retries without resaving", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string): void {
      original.call(this, key, value);
      if (key === "wh_customer_vehicle_mock_v1") {
        (window as typeof window & { __WH_CUSTOMERS_TEST_SCENARIO__?: unknown })
          .__WH_CUSTOMERS_TEST_SCENARIO__ = { failNext: { customerVehicleRead: "保存后刷新失败" } };
      }
    };
  });
  await openWorkspace(page);
  await page.getByTestId("create-customer-btn").click();
  await page.getByTestId("onboarding-customer-type").selectOption("organization");
  await page.getByTestId("onboarding-phone").fill("+1 876 555 0187");
  await page.getByTestId("onboarding-check-phone").click();
  await page.getByTestId("onboarding-send-otp").click();
  await page.getByTestId("onboarding-otp-code").fill("123456");
  await page.getByTestId("onboarding-verify-otp").click();
  await page.getByTestId("onboarding-organization-name").fill("Refresh Retry Fleet Ltd");
  await page.getByTestId("onboarding-name-source").fill("周雅雯");
  await page.getByTestId("customer-name-transliteration-confirm").click();
  await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("Zhou Yawen");
  await page.getByTestId("onboarding-email").fill("refresh.retry@example.test");
  await page.getByTestId("onboarding-preview").click();
  await page.getByTestId("onboarding-create").click();
  await expect(page.getByTestId("customer-workspace-error")).toContainText("保存成功，但刷新失败");
  await page.getByTestId("customer-workspace-retry").click();
  await page.getByTestId("search-input-customers").fill("Refresh Retry Fleet Ltd");
  await expect(page.locator('[data-testid^="customer-row-"]').first()).toContainText("Zhou Yawen");
  await expect(page.getByTestId("customer-card-filter-all")).toContainText("301");
});

test("unauthorized workspace fails closed without rendering customer, vehicle, contact, or VIN data", async ({ page }) => {
  await useIdentity(page, "parts");
  await openWorkspace(page);
  await expect(page.getByTestId("customer-workspace-error")).toContainText("无权");
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/Alicia Bennett|North Coast Logistics|7012 AB|1HGBH41JXMN100001|555 0101/);
  await expect(page.getByTestId("customer-list")).toHaveCount(0);
});

test("slow reads show a real loading state and one-shot read errors retry without a fake list", async ({ page }) => {
  await useIdentity(page, "superadmin", { delayMs: { customerVehicleRead: 1_500 } });
  await openWorkspace(page);
  await expect(page.getByTestId("customer-workspace-loading")).toBeVisible();
  await expect(page.getByText("Alicia Bennett", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("customer-row-CUST-UAT-001")).toContainText("Alicia Bennett", { timeout: 5_000 });

  const errorPage = await page.context().newPage();
  await useIdentity(errorPage, "superadmin", { failNext: { customerVehicleRead: "演示读取失败" } });
  await openWorkspace(errorPage);
  await expect(errorPage.getByTestId("customer-workspace-error")).toContainText("演示读取失败");
  await expect(errorPage.getByText("Alicia Bennett", { exact: true })).toHaveCount(0);
  await errorPage.getByTestId("customer-workspace-retry").click();
  await expect(errorPage.getByTestId("customer-row-CUST-UAT-001")).toContainText("Alicia Bennett");
  expect(observeRuntimeErrors(errorPage)).toEqual([]);
  await errorPage.close();
});

test("pending reads are isolated by session identity and cannot reuse authorized PII", async ({ page }) => {
  await useIdentity(page, "superadmin", { delayMs: { customerVehicleRead: 1_500 } });
  await openWorkspace(page);
  await expect(page.getByTestId("customer-workspace-loading")).toBeVisible();
  await page.evaluate((partsIdentity) => {
    localStorage.setItem("wh_session", JSON.stringify({
      identity: partsIdentity, token: "offline-emp-004", expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", "/vehicles");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, identities.parts);
  await expect(page.getByTestId("customer-workspace-error")).toContainText("无权", { timeout: 5_000 });
  expect(await page.locator("body").innerText()).not.toMatch(/Alicia Bennett|7012 AB|1HGBH41JXMN100001/);
});

test("loaded vehicle detail fails closed across anonymous and unauthorized session switches", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/vehicles/VEH-UAT-001");
  await expect(page.getByTestId("vehicle-section-master")).toContainText("7012 AB");
  await expect(page.locator('[data-testid^="vehicle-business-order-demo-v2-"]')).toHaveCount(3);

  await page.evaluate(() => {
    localStorage.removeItem("wh_session");
    history.pushState({}, "", "/vehicles/VEH-UAT-001?identity=anonymous");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("vehicle-detail-loading")).toBeVisible();
  await expect(page.getByTestId("vehicle-section-master")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-section-business-orders")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/Alicia Bennett|7012 AB|KGN-WH-2026072000003|84,200/);

  await page.evaluate((adminIdentity) => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown })
      .__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
        delayMs: { byAction: { "quickOrders.list.read": 1_500 } },
      };
    localStorage.setItem("wh_session", JSON.stringify({
      identity: adminIdentity, token: "offline-emp-001", expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", "/vehicles/VEH-UAT-001?identity=admin-reload");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, identities.superadmin);
  await expect(page.getByTestId("vehicle-detail-loading")).toBeVisible();
  await page.waitForTimeout(700);

  await page.evaluate((partsIdentity) => {
    localStorage.setItem("wh_session", JSON.stringify({
      identity: partsIdentity, token: "offline-emp-004", expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", "/vehicles/VEH-UAT-001?identity=parts");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, identities.parts);
  await expect(page.getByTestId("vehicle-section-master")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-section-business-orders")).toHaveCount(0);
  await expect(page.getByTestId("vehicle-detail-error")).toContainText("无权", { timeout: 5_000 });
  await page.waitForTimeout(1_800);
  expect(await page.locator("body").innerText()).not.toMatch(/Alicia Bennett|7012 AB|KGN-WH-2026072000003|84,200/);
});

test("vehicle client-route switch clears the prior vehicle and read failure exposes retry", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/vehicles/VEH-UAT-001");
  await expect(page.getByTestId("vehicle-section-master")).toContainText("7012 AB");
  await page.evaluate(() => {
    (window as typeof window & { __WH_LINKED_OPERATIONS_TEST_SCENARIO__?: unknown }).__WH_LINKED_OPERATIONS_TEST_SCENARIO__ = {
      delayMs: { byAction: { "vehicle.inspectionArchive.read:VEH-BULK-001": 900 } },
    };
  });
  await page.getByTestId("vehicle-detail-back").click();
  await page.getByTestId("vehicle-open-VEH-BULK-001").click();
  await expect(page.getByTestId("vehicle-detail-loading")).toBeVisible();
  await expect(page.getByText("7012 AB", { exact: false })).toHaveCount(0);
  await expect(page.getByTestId("vehicle-section-master")).toContainText("8765 JZ", { timeout: 5_000 });

  await page.goto("/vehicles/VEH-MISSING-TASK7");
  await expect(page.getByTestId("vehicle-detail-error")).toContainText("车辆不存在", { timeout: 5_000 });
  await expect(page.getByTestId("vehicle-detail-retry")).toBeVisible();
  await page.getByTestId("vehicle-detail-retry").click();
  await expect(page.getByTestId("vehicle-detail-error")).toContainText("车辆不存在", { timeout: 5_000 });
  await expect(page.getByTestId("vehicle-detail-loading")).toHaveCount(0);
});

test("loaded business order detail hides data when the session becomes anonymous", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/orders/business/demo-v2-refunds");
  await expect(page.getByTestId("quick-detail-no")).toContainText("KGN-WH-2026072000003");

  await page.evaluate(() => {
    localStorage.removeItem("wh_session");
    history.pushState({}, "", "/orders/business/demo-v2-refunds?identity=anonymous");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  // The Mock request wrapper resolves authorization within 500 ms. Keeping the
  // anonymous state beyond that boundary proves no late response can restore PII.
  await page.waitForTimeout(700);
  await expect(page.getByTestId("quick-detail-loading")).toBeVisible();
  await expect(page.getByTestId("quick-detail-no")).toHaveCount(0);
  await expect(page.getByTestId("quick-detail-error")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/Alicia Bennett|7012 AB|KGN-WH-2026072000003|84,200/);
});

test("loaded business order detail rejects an unauthorized session identity", async ({ page }) => {
  await useIdentity(page, "superadmin");
  await page.goto("/orders/business/demo-v2-refunds");
  await expect(page.getByTestId("quick-detail-no")).toContainText("KGN-WH-2026072000003");

  await page.evaluate((partsIdentity) => {
    localStorage.setItem("wh_session", JSON.stringify({
      identity: partsIdentity, token: "offline-emp-004", expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", "/orders/business/demo-v2-refunds?identity=parts");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, identities.parts);

  await expect(page.getByTestId("quick-detail-error")).toContainText("无权", { timeout: 5_000 });
  await expect(page.getByTestId("quick-detail-no")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/Alicia Bennett|7012 AB|KGN-WH-2026072000003|84,200/);
});

test("an unauthorized-authorized-unauthorized ABA switch cannot reuse a request authorized under the middle identity", async ({ page }) => {
  await useIdentity(page, "parts", { delayMs: { customerVehicleRead: 1_500 } });
  await openWorkspace(page);
  await expect(page.getByTestId("customer-workspace-error")).toContainText("无权");

  await page.evaluate((adminIdentity) => {
    localStorage.setItem("wh_session", JSON.stringify({
      identity: adminIdentity, token: "offline-emp-001", expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", "/vehicles");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, identities.superadmin);
  await expect(page.getByTestId("customer-workspace-loading")).toBeVisible();
  await expect(page).toHaveURL(/\/vehicles$/);
  await page.evaluate((partsIdentity) => {
    localStorage.setItem("wh_session", JSON.stringify({
      identity: partsIdentity, token: "offline-emp-004", expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    history.pushState({}, "", "/customers");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, identities.parts);

  await expect(page.getByTestId("customer-workspace-error")).toContainText("无权", { timeout: 5_000 });
  expect(await page.locator("body").innerText()).not.toMatch(/Alicia Bennett|7012 AB|1HGBH41JXMN100001/);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} summary, customer, and vehicle auxiliary text and active badges keep at least 4.5:1 computed contrast`, async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.addInitScript((selectedTheme) => localStorage.setItem("wh_theme", selectedTheme), theme);
    await openWorkspace(page);

    await expect.poll(() => contrastRatio(page.getByTestId("customer-card-subtext").first())).toBeGreaterThanOrEqual(4.5);
    const customerRow = page.getByTestId("customer-row-CUST-UAT-001");
    await expect(customerRow).toBeVisible();
    await expect.poll(() => contrastRatio(customerRow.getByTestId("customer-secondary-CUST-UAT-001"))).toBeGreaterThanOrEqual(4.5);
    await expect.poll(() => contrastRatio(customerRow.getByTestId("customer-status-active-CUST-UAT-001"))).toBeGreaterThanOrEqual(4.5);
    await page.getByTestId("customer-open-CUST-UAT-001").click();
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();
    await expect.poll(() => contrastRatio(page.getByTestId("customer-vehicle-action-VEH-UAT-001"))).toBeGreaterThanOrEqual(4.5);
    await page.getByTestId("customer-detail-back").click();
    await expect(page).toHaveURL(/\/customers$/);

    await page.goto("/vehicles");
    const vehicleRow = page.getByTestId("vehicle-row-VEH-UAT-001");
    await expect(vehicleRow).toBeVisible();
    await expect.poll(() => contrastRatio(vehicleRow.getByTestId("vehicle-secondary-VEH-UAT-001"))).toBeGreaterThanOrEqual(4.5);
    await expect.poll(() => contrastRatio(vehicleRow.getByTestId("vehicle-status-on_site-VEH-UAT-001"))).toBeGreaterThanOrEqual(4.5);
  });

  test(`430x932 ${theme} keeps both lists, rich details, and edit forms within the viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await useIdentity(page, "superadmin");
    await page.addInitScript((selectedTheme) => localStorage.setItem("wh_theme", selectedTheme), theme);
    await openWorkspace(page);
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
    const widths = await page.evaluate(() => ({
      rootClient: document.documentElement.clientWidth,
      rootScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
    }));
    expect(widths.rootClient).toBe(430);
    expect(Math.max(widths.rootScroll, widths.bodyScroll)).toBeLessThanOrEqual(430);

    await page.getByTestId("customer-card-CUST-UAT-001").click();
    await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);
    const detail = page.getByTestId("customer-detail-page");
    await expect(detail).toBeVisible();
    await expect(page.getByTestId("customer-section-profile")).toBeVisible();
    const mobileVerificationRows = await Promise.all([
      page.getByTestId("verification-row-otp").boundingBox(),
      page.getByTestId("verification-row-kyc").boundingBox(),
      page.getByTestId("verification-row-agreement").boundingBox(),
    ]);
    if (mobileVerificationRows.some((box) => box === null)) throw new Error("移动端验证与协议项不可见");
    const mobileRows = mobileVerificationRows as Exclude<(typeof mobileVerificationRows)[number], null>[];
    expect(Math.max(...mobileRows.map((box) => box.x)) - Math.min(...mobileRows.map((box) => box.x))).toBeLessThanOrEqual(1);
    expect(mobileRows[0].y).toBeLessThan(mobileRows[1].y);
    expect(mobileRows[1].y).toBeLessThan(mobileRows[2].y);
    const detailWidths = await page.evaluate(() => ({
      rootScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
    }));
    expect(Math.max(detailWidths.rootScroll, detailWidths.bodyScroll)).toBeLessThanOrEqual(430);

    await page.getByTestId("customer-edit-btn").click();
    const customerForm = page.getByTestId("customer-form-dialog");
    await expect(customerForm).toBeVisible();
    await expect(page.getByTestId("customer-formal-details")).toBeVisible();
    await expect(page.getByTestId("form-customer-channel")).toBeVisible();
    await expect(page.getByTestId("form-customer-risk")).toHaveCount(0);
    await expect(page.getByTestId("form-customer-name-zh")).toHaveCount(0);
    await expect(page.getByTestId("form-customer-source")).toHaveCount(0);
    await expect(page.getByTestId("license-ocr-block")).toHaveCount(0);
    const customerFormGeometry = await customerForm.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      width: node.getBoundingClientRect().width,
    }));
    expect(customerFormGeometry.scrollHeight).toBeGreaterThan(customerFormGeometry.clientHeight);
    expect(customerFormGeometry.scrollWidth).toBeLessThanOrEqual(customerFormGeometry.clientWidth);
    expect(customerFormGeometry.width).toBeLessThanOrEqual(398);
    await customerForm.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect(page.getByTestId("form-cancel")).toBeInViewport();
    await expect(page.getByTestId("form-save")).toBeInViewport();
    await expect(page.getByTestId("form-save")).toBeEnabled();
    await page.getByTestId("form-save").click({ trial: true });
    await page.getByTestId("form-cancel").click();
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();
    await page.getByTestId("customer-detail-back").click();
    await expect(page).toHaveURL(/\/customers$/);

    await page.goto("/vehicles");
    await expect(page.getByTestId("vehicle-card-VEH-UAT-001")).toBeVisible();
    await page.getByTestId("vehicle-card-VEH-UAT-001").click();
    await expect(page).toHaveURL(/\/vehicles\/VEH-UAT-001$/);
    const vehicleDetail = page.getByTestId("vehicle-detail-page");
    await expect(vehicleDetail).toBeVisible();
    await expect(page.getByTestId("vehicle-section-master")).toBeVisible();
    await expect(page.getByTestId("vehicle-section-business-orders")).toBeVisible();
    await expect(page.getByTestId("vehicle-business-order-demo-v2-refunds")).toBeVisible();
    const businessOrderMileage = page.getByTestId("vehicle-business-order-mileage-demo-v2-refunds");
    await expect(businessOrderMileage).toContainText("入场里程：未记录");
    await expect(businessOrderMileage).not.toContainText("84,200 km");
    const vehicleDetailWidths = await page.evaluate(() => ({
      rootScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
    }));
    expect(Math.max(vehicleDetailWidths.rootScroll, vehicleDetailWidths.bodyScroll)).toBeLessThanOrEqual(430);
    await page.getByTestId("vehicle-edit-btn").click();
    const vehicleForm = page.getByTestId("vehicle-form-dialog");
    await expect(vehicleForm).toBeVisible();
    await expect(page.getByTestId("form-vehicle-mileage")).toHaveCount(0);
    await expect(page.getByTestId("form-vehicle-mileage-unit")).toHaveCount(0);
    await expect(page.getByTestId("form-vehicle-mileage-time")).toHaveCount(0);
    await expect(page.getByTestId("form-vehicle-color")).toBeVisible();
    const vehicleFormGeometry = await vehicleForm.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      width: node.getBoundingClientRect().width,
    }));
    expect(vehicleFormGeometry.scrollHeight).toBeGreaterThan(vehicleFormGeometry.clientHeight);
    expect(vehicleFormGeometry.scrollWidth).toBeLessThanOrEqual(vehicleFormGeometry.clientWidth);
    expect(vehicleFormGeometry.width).toBeLessThanOrEqual(398);
    await vehicleForm.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect(page.getByTestId("vehicle-form-cancel")).toBeInViewport();
    await expect(page.getByTestId("vehicle-form-save")).toBeInViewport();
    await expect(page.getByTestId("vehicle-form-save")).toBeEnabled();
    await page.getByTestId("vehicle-form-save").click({ trial: true });
    await page.getByTestId("vehicle-form-cancel").click();
    await expect(page.getByTestId("vehicle-detail-page")).toBeVisible();

    const finalWidths = await page.evaluate(() => ({
      rootClient: document.documentElement.clientWidth,
      rootScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
    }));
    expect(finalWidths.rootClient).toBe(430);
    expect(Math.max(finalWidths.rootScroll, finalWidths.bodyScroll)).toBeLessThanOrEqual(430);
  });
}

test.describe("验证证据工作流", () => {
  test("OTP shows its phone, invalidates unreachable evidence, and re-verifies a new phone", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-001");
    const otp = page.getByTestId("customer-otp-evidence-card");
    await expect(otp).toContainText("+1");
    await expect(otp).toContainText("已验证");

    await otp.getByRole("button", { name: "标记联系不上" }).click();
    await page.getByLabel("作废原因").fill("号码无法接通");
    await page.getByRole("button", { name: "确认作废" }).click();
    await expect(otp).toContainText("需重新验证");

    await otp.getByRole("button", { name: "重新 OTP" }).click();
    await page.getByLabel("验证号码").fill("+18765550999");
    await page.getByRole("button", { name: "发送验证码" }).click();
    await page.getByLabel("验证码").fill("123456");
    await page.getByRole("button", { name: "确认验证" }).click();
    await expect(otp).toContainText("+1 876 555 0999");

    await page.reload();
    await expect(page.getByTestId("customer-otp-evidence-card")).toContainText("+1 876 555 0999");
  });

  test("driver-license viewer opens the exact synthetic evidence and signed agreement", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-001");
    const driverLicenseTrigger = page.getByRole("button", { name: "查看驾驶证" });
    await driverLicenseTrigger.click();
    await expect(page.getByTestId("evidence-asset-viewer")).toContainText("合成演示资料");
    await page.getByRole("button", { name: "关闭证据" }).click();
    await expect(driverLicenseTrigger).toBeFocused();

    await expect(page.getByTestId("customer-agreement-evidence-card")).toContainText("电子版");
    await page.getByRole("button", { name: "查看签署文件" }).click();
    await expect(page.getByTestId("evidence-pdf-frame")).toHaveAttribute("src", /signed\.pdf$/);
  });

  test("KYC does not permit completion without a driver-license image", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    await page.getByRole("button", { name: "补充驾驶证" }).click();
    await expect(page.getByTestId("kyc-profile-gender").locator('option[value="其他"]')).toHaveCount(1);
    await page.getByRole("button", { name: "提交并核验" }).click();
    await expect(page.getByRole("alert")).toContainText("请先上传驾驶证正面");
  });

  test("KYC seed preview exposes only four fields and requires explicit name transliteration confirmation", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-001");
    await page.getByRole("button", { name: "核对正式资料" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await expect(dialog.locator('[data-testid^="kyc-profile-"]')).toHaveCount(4);
    await expect(page.getByTestId("kyc-profile-name")).toHaveValue("Alicia Bennett");
    await expect(page.getByTestId("kyc-profile-birth-date")).toHaveValue("1988-03-22");
    await expect(page.getByTestId("kyc-profile-gender")).toHaveValue("女");
    await expect(page.getByTestId("kyc-profile-address")).toHaveValue("12 Constant Spring Road, Kingston 8, Jamaica");
    await expect(dialog).not.toContainText(/TRN|class|licen[cs]e number|issue date|expiry|collectorate|signature/i);

    await page.getByTestId("kyc-profile-name").fill("陈志远");
    await page.getByRole("button", { name: "确认写入正式资料" }).click();
    await expect(page.getByRole("alert")).toContainText("请先预览并确认对应音译");
    await page.getByRole("button", { name: "预览并确认姓名音译" }).click();
    const namePreview = page.getByTestId("kyc-name-transliteration-preview");
    await expect(namePreview).toContainText("陈志远");
    await expect(namePreview).toContainText("Chen Zhiyuan");
    await page.getByRole("button", { name: "确认写入正式资料" }).click();
    await expect(dialog.getByText(/可能重复客户：/)).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /可能重复客户/ })).toHaveCount(0);
    await expect(dialog.getByRole("status")).toContainText("已确认写入正式资料");
    await page.getByRole("button", { name: "关闭驾驶证核验" }).click();
    await expect(page.getByTestId("customer-formal-details")).toContainText("陈志远");
    await expect(page.getByTestId("customer-formal-details")).toContainText("Chen Zhiyuan");

    const saved = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, unknown>> } };
      const customer = envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-001");
      return customer && {
        nameSourceValue: customer.nameSourceValue,
        birthDate: customer.birthDate,
        gender: customer.gender,
        address: customer.address,
        trn: customer.trn,
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(saved).toEqual({
      nameSourceValue: "陈志远",
      birthDate: "1988-03-22",
      gender: "女",
      address: "12 Constant Spring Road, Kingston 8, Jamaica",
      trn: "110-044-556",
    });
    await page.reload();
    await expect(page.getByTestId("customer-formal-details")).toContainText("陈志远");
    await expect(page.getByTestId("customer-formal-details")).toContainText("110-044-556");
  });

  test("KYC arbitrary upload stays manual and does not update formal details before confirmation", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    const before = await page.getByTestId("customer-formal-details").innerText();
    await page.getByRole("button", { name: "补充驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await expect(dialog).toContainText("未启用 OCR");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await expect(page.getByTestId("kyc-profile-name")).toHaveValue("");
    await expect(page.getByTestId("kyc-profile-birth-date")).toHaveValue("");
    await expect(page.getByTestId("kyc-profile-gender")).toHaveValue("");
    await expect(page.getByTestId("kyc-profile-address")).toHaveValue("");
    await page.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("正式资料尚未更改");

    const afterEvidence = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      const customer = envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-003");
      const record = customer?.verificationArchive?.kycRecords?.at(-1);
      return {
        name: customer?.nameSourceValue,
        birthDate: customer?.birthDate,
        gender: customer?.gender,
        address: customer?.address,
        assetId: record?.frontAsset?.id,
        assetCreatedAt: record?.frontAsset?.createdAt,
        submittedAt: record?.submittedAt,
        verifiedAt: record?.verifiedAt,
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(afterEvidence.name).toBe("Marcia Reid");
    expect(afterEvidence.birthDate).toBeNull();
    expect(afterEvidence.gender).toBeNull();
    expect(afterEvidence.assetId).not.toBe("EVID-UAT-ALICIA-DL-FRONT");
    expect(afterEvidence.assetCreatedAt <= afterEvidence.submittedAt).toBe(true);

    await page.getByTestId("kyc-profile-name").fill("Marcia Reid");
    await page.getByTestId("kyc-profile-birth-date").fill("1991-04-05");
    await page.getByTestId("kyc-profile-gender").selectOption("女");
    await page.getByTestId("kyc-profile-address").fill("15 Hope Road, Kingston 6");
    await page.getByRole("button", { name: "确认写入正式资料" }).click();
    await expect(dialog.getByText(/可能重复客户：/)).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: /可能重复客户/ })).toHaveCount(0);
    await expect(dialog.getByRole("status")).toContainText("已确认写入正式资料");
    await page.getByRole("button", { name: "关闭驾驶证核验" }).click();
    await expect(page.getByTestId("customer-formal-details")).not.toHaveText(before);
    await expect(page.getByTestId("customer-formal-details")).toContainText("15 Hope Road, Kingston 6");
    await page.reload();
    await expect(page.getByTestId("customer-kyc-evidence-card")).toContainText("已核验");
    await page.getByRole("button", { name: "查看驾驶证" }).click();
    await expect(page.getByTestId("evidence-asset-viewer").locator("img")).toHaveAttribute("src", /^blob:/);
    await page.getByRole("button", { name: "关闭证据" }).click();
  });

  test("KYC submit response loss retries the same immutable payload and creates one record and audit", async ({ page }) => {
    await useIdentity(page, "superadmin", {
      failNext: { customerKycSubmitResponse: "演示 KYC 提交响应丢失" },
    });
    await page.goto("/customers/CUST-UAT-003");
    const before = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: Record<string, any> } | null;
      const state = envelope?.state;
      const customer = state?.customers?.find((entry: Record<string, any>) => entry.id === "CUST-UAT-003");
      return {
        records: customer?.verificationArchive?.kycRecords?.length ?? 0,
        submittedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_submitted").length ?? 0,
        verifiedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_verified").length ?? 0,
      };
    }, CUSTOMER_STORAGE_KEY);
    await page.getByRole("button", { name: "补充驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await dialog.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("alert")).toContainText("演示 KYC 提交响应丢失");

    const pending = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: Record<string, any> } | null;
      const state = envelope?.state;
      const customer = state?.customers?.find((entry: Record<string, any>) => entry.id === "CUST-UAT-003");
      const record = customer?.verificationArchive?.kycRecords?.at(-1);
      return {
        recordId: record?.id,
        verifiedAt: record?.verifiedAt,
        records: customer?.verificationArchive?.kycRecords?.length ?? 0,
        submittedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_submitted").length ?? 0,
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(pending.recordId).toBeTruthy();
    expect(pending.verifiedAt).toBeUndefined();
    expect(pending.records).toBe(before.records + 1);
    expect(pending.submittedAudits).toBe(before.submittedAudits + 1);

    await dialog.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("完成人工核验");
    const recovered = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: Record<string, any> } | null;
      const state = envelope?.state;
      const customer = state?.customers?.find((entry: Record<string, any>) => entry.id === "CUST-UAT-003");
      const record = customer?.verificationArchive?.kycRecords?.at(-1);
      return {
        recordId: record?.id,
        verifiedAt: record?.verifiedAt,
        records: customer?.verificationArchive?.kycRecords?.length ?? 0,
        submittedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_submitted").length ?? 0,
        verifiedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_verified").length ?? 0,
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(recovered).toEqual({
      recordId: pending.recordId,
      verifiedAt: expect.any(String),
      records: before.records + 1,
      submittedAudits: before.submittedAudits + 1,
      verifiedAudits: before.verifiedAudits + 1,
    });
  });

  test("KYC submit response loss followed by changed file and organization profile starts a new attempt", async ({ page }) => {
    await useIdentity(page, "superadmin", {
      failNext: { customerKycSubmitResponse: "演示企业 KYC 提交响应丢失" },
    });
    await page.goto("/customers/CUST-UAT-002");
    await page.getByRole("button", { name: "补录主要联系人驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await page.getByTestId("kyc-profile-name").fill("Dwayne Clarke");
    await page.getByTestId("kyc-profile-birth-date").fill("1987-09-14");
    await page.getByTestId("kyc-profile-gender").selectOption("男");
    await page.getByTestId("kyc-profile-address").fill("14 Contact Lane, Kingston");
    await dialog.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("alert")).toContainText("演示企业 KYC 提交响应丢失");

    const firstPending = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } } | null;
      const records = envelope?.state?.customers?.find((entry) => entry.id === "CUST-UAT-002")
        ?.verificationArchive?.kycRecords ?? [];
      return { count: records.length, id: records[0]?.id as string | undefined, verifiedAt: records[0]?.verifiedAt };
    }, CUSTOMER_STORAGE_KEY);
    expect(firstPending).toMatchObject({ count: 1, id: expect.any(String), verifiedAt: undefined });
    const firstPendingId = firstPending.id!;

    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/demo-paper-agreement-scan.png");
    await page.getByTestId("kyc-profile-address").fill("99 Changed Road, Kingston");
    await dialog.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("完成人工核验");

    const records = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>>; auditEvents?: Array<Record<string, any>> } } | null;
      const customer = envelope?.state?.customers?.find((entry) => entry.id === "CUST-UAT-002");
      return {
        records: customer?.verificationArchive?.kycRecords ?? [],
        audits: envelope?.state?.auditEvents?.filter((event) => event.customerId === "CUST-UAT-002" && event.eventType.startsWith("kyc_")) ?? [],
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(records.records).toHaveLength(2);
    expect(records.records[0].id).toBe(firstPendingId);
    expect(records.records[0].verifiedAt).toBeUndefined();
    expect(records.records[1]).toMatchObject({
      subjectProfile: { address: "99 Changed Road, Kingston" },
      verifiedAt: expect.any(String),
    });
    expect(records.records[1].frontAsset.id).not.toBe(records.records[0].frontAsset.id);
    expect(records.audits.filter((event: Record<string, any>) => event.eventType === "kyc_submitted")).toHaveLength(2);
    expect(records.audits.filter((event: Record<string, any>) => event.eventType === "kyc_verified")).toHaveLength(1);
  });

  test("KYC verify response loss retries the same submitted record without duplicate evidence or audits", async ({ page }) => {
    await useIdentity(page, "superadmin", {
      failNext: { customerKycVerifyResponse: "演示 KYC 核验响应丢失" },
    });
    await page.goto("/customers/CUST-UAT-003");
    const before = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: Record<string, any> } | null;
      const state = envelope?.state;
      const customer = state?.customers?.find((entry: Record<string, any>) => entry.id === "CUST-UAT-003");
      return {
        records: customer?.verificationArchive?.kycRecords?.length ?? 0,
        submittedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_submitted").length ?? 0,
        verifiedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_verified").length ?? 0,
      };
    }, CUSTOMER_STORAGE_KEY);
    await page.getByRole("button", { name: "补充驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await dialog.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("alert")).toContainText("演示 KYC 核验响应丢失");

    const persisted = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: Record<string, any> } | null;
      const state = envelope?.state;
      const customer = state?.customers?.find((entry: Record<string, any>) => entry.id === "CUST-UAT-003");
      const record = customer?.verificationArchive?.kycRecords?.at(-1);
      return {
        recordId: record?.id,
        verifiedAt: record?.verifiedAt,
        records: customer?.verificationArchive?.kycRecords?.length ?? 0,
        submittedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_submitted").length ?? 0,
        verifiedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_verified").length ?? 0,
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(persisted.recordId).toBeTruthy();
    expect(persisted.verifiedAt).toBeTruthy();
    expect(persisted.records).toBe(before.records + 1);
    expect(persisted.submittedAudits).toBe(before.submittedAudits + 1);
    expect(persisted.verifiedAudits).toBe(before.verifiedAudits + 1);

    await dialog.getByRole("button", { name: /^(?:继续人工核验|提交并核验)$/ }).click();
    await expect(dialog.getByRole("status")).toContainText("已完成人工核验");
    const retried = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: Record<string, any> } | null;
      const state = envelope?.state;
      const customer = state?.customers?.find((entry: Record<string, any>) => entry.id === "CUST-UAT-003");
      const record = customer?.verificationArchive?.kycRecords?.at(-1);
      return {
        recordId: record?.id,
        records: customer?.verificationArchive?.kycRecords?.length ?? 0,
        submittedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_submitted").length ?? 0,
        verifiedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_verified").length ?? 0,
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(retried).toEqual({
      recordId: persisted.recordId,
      records: persisted.records,
      submittedAudits: persisted.submittedAudits,
      verifiedAudits: persisted.verifiedAudits,
    });
  });

  test("KYC verify does not publish an old actor response after the authorized identity changes", async ({ page }) => {
    // 固定核验延迟：保证身份切换后的前台加载先于后台核验完成落定，断言不依赖竞态
    await useIdentity(page, "superadmin", { delayMs: { customerKycVerifyResponse: 1_500 } });
    await page.goto("/customers/CUST-UAT-003");
    await page.getByRole("button", { name: "补充驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await dialog.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("正在进行人工核验");
    await page.evaluate((identity) => {
      localStorage.setItem("wh_session", JSON.stringify({ identity, token: `offline-${identity.id}`, expiresAt: "2099-01-01T00:00:00.000Z" }));
      window.dispatchEvent(new StorageEvent("storage", { key: "wh_session" }));
    }, identities.frontdesk_admin);

    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } } | null;
      const customer = envelope?.state?.customers?.find((entry) => entry.id === "CUST-UAT-003");
      return Boolean(customer?.verificationArchive?.kycRecords?.at(-1)?.verifiedAt);
    }, CUSTOMER_STORAGE_KEY), { timeout: 3_000 }).toBe(true);
    await expect(page.getByTestId("customer-kyc-evidence-card")).not.toContainText("已核验");
  });

  test("KYC submit from an old actor may persist but never publishes or continues into verify", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    await page.getByRole("button", { name: "补充驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await dialog.getByRole("button", { name: "提交并核验" }).click();
    await page.waitForTimeout(150);
    await page.evaluate((identity) => {
      localStorage.setItem("wh_session", JSON.stringify({
        identity,
        token: `offline-${identity.id}`,
        expiresAt: "2099-01-01T00:00:00.000Z",
      }));
      window.dispatchEvent(new StorageEvent("storage", { key: "wh_session" }));
    }, identities.frontdesk_admin);
    await expect(dialog).toHaveCount(0);

    await expect.poll(() => page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: Record<string, any> } | null;
      const state = envelope?.state;
      const customer = state?.customers?.find((entry: Record<string, any>) => entry.id === "CUST-UAT-003");
      const records = customer?.verificationArchive?.kycRecords ?? [];
      return {
        records: records.length,
        verified: records.filter((record: Record<string, any>) => Boolean(record.verifiedAt)).length,
        submittedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_submitted").length ?? 0,
        verifiedAudits: state?.auditEvents?.filter((event: Record<string, any>) => event.customerId === "CUST-UAT-003" && event.eventType === "kyc_verified").length ?? 0,
      };
    }, CUSTOMER_STORAGE_KEY), { timeout: 3_000 }).toEqual({
      records: 1,
      verified: 0,
      submittedAudits: 1,
      verifiedAudits: 0,
    });
    await expect(page.getByTestId("customer-kyc-evidence-card")).toContainText("待补 KYC");
  });

  test("verification dialogs and viewer clear immediately on storage and popstate identity changes", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    const switchIdentity = async (
      identity: (typeof identities)[CustomerVehicleIdentity],
      eventType: "storage" | "popstate",
    ) => {
      await page.evaluate(({ nextIdentity, type }) => {
        localStorage.setItem("wh_session", JSON.stringify({
          identity: nextIdentity,
          token: `offline-${nextIdentity.id}`,
          expiresAt: "2099-01-01T00:00:00.000Z",
        }));
        if (type === "storage") window.dispatchEvent(new StorageEvent("storage", { key: "wh_session" }));
        else window.dispatchEvent(new PopStateEvent("popstate"));
      }, { nextIdentity: identity, type: eventType });
    };

    await page.getByRole("button", { name: "补充驾驶证" }).click();
    await page.getByTestId("kyc-verification-dialog").getByLabel("驾驶证正面（必填）")
      .setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await switchIdentity(identities.frontdesk_admin, "storage");
    await expect(page.getByTestId("kyc-verification-dialog")).toHaveCount(0);

    await switchIdentity(identities.superadmin, "storage");
    await page.getByRole("button", { name: "重新 OTP" }).click();
    await page.getByLabel("验证号码").fill("+18765550123");
    await switchIdentity(identities.frontdesk_admin, "storage");
    await expect(page.getByTestId("otp-verification-dialog")).toHaveCount(0);

    await switchIdentity(identities.superadmin, "storage");
    await page.getByRole("button", { name: "登记协议", exact: true }).click();
    await page.getByTestId("agreement-evidence-dialog").getByLabel("签署人").fill("Marcia Reid");
    await switchIdentity(identities.frontdesk_admin, "storage");
    await expect(page.getByTestId("agreement-evidence-dialog")).toHaveCount(0);

    await switchIdentity(identities.superadmin, "storage");
    await page.getByRole("button", { name: "补充驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await dialog.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("完成人工核验");
    await page.getByRole("button", { name: "关闭驾驶证核验" }).click();
    await page.evaluate(() => {
      const browser = window as typeof window & { __revokedEvidenceUrls?: string[] };
      browser.__revokedEvidenceUrls = [];
      const original = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => {
        browser.__revokedEvidenceUrls!.push(url);
        original(url);
      };
    });
    await page.getByRole("button", { name: "查看驾驶证" }).click();
    const viewer = page.getByTestId("evidence-asset-viewer");
    const viewerUrl = await viewer.locator("img").getAttribute("src");
    expect(viewerUrl).toMatch(/^blob:/);
    await switchIdentity(identities.frontdesk_admin, "popstate");
    await expect(viewer).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (
      (window as typeof window & { __revokedEvidenceUrls?: string[] }).__revokedEvidenceUrls ?? []
    ))).toContain(viewerUrl);
  });

  test("agreement paper path rejects partial location and persists a retrievable physical record", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    await page.getByRole("button", { name: "登记协议", exact: true }).click();
    const dialog = page.getByTestId("agreement-evidence-dialog");
    await dialog.getByLabel("纸质版").check();
    await dialog.getByLabel("纸质档案号").fill("PAPER-2026-031");
    await page.getByRole("button", { name: "确认登记纸质版协议" }).click();
    await expect(dialog.getByRole("alert")).toContainText("档案号和存放位置必须同时填写");
    await expect(dialog.getByLabel("纸质档案号")).toHaveValue("PAPER-2026-031");
    await dialog.getByLabel("存放位置").fill("前台档案柜 B-03");
    await page.getByRole("button", { name: "确认登记纸质版协议" }).click();
    const card = page.getByTestId("customer-agreement-evidence-card");
    await expect(card).toContainText("纸质版");
    await expect(card).toContainText("PAPER-2026-031");
    await expect(card).toContainText("前台档案柜 B-03");
    await page.reload();
    await expect(page.getByTestId("customer-agreement-evidence-card")).toContainText("前台档案柜 B-03");
    await page.getByRole("button", { name: /查看全部验证历史/ }).click();
    await expect(page.getByTestId("customer-verification-history")).toContainText("纸质版");
    await page.getByTestId("customer-tab-history").click();
    await expect(page.getByTestId("customer-audit-history")).toContainText("记录客户服务协议签署");
  });

  test("agreement electronic evidence is bounded in time, viewable from audit, and never duplicates Base64 in DOM", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    await page.getByRole("button", { name: "登记协议", exact: true }).click();
    const pad = page.getByTestId("agreement-signature-pad");
    const box = await pad.boundingBox();
    if (!box) throw new Error("签名板不可见");
    await page.mouse.move(box.x + 30, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 75, { steps: 4 });
    await page.mouse.up();
    await page.getByRole("button", { name: "确认登记电子版协议" }).click();
    const card = page.getByTestId("customer-agreement-evidence-card");
    await expect(card).toContainText("电子版");

    const timing = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      const customer = envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-003");
      const record = customer?.verificationArchive?.agreementRecords?.at(-1);
      return {
        signedAt: record?.signedAt,
        signatureCreatedAt: record?.signatureAsset?.createdAt,
        pdfCreatedAt: record?.signedDocumentAsset?.createdAt,
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(timing.signatureCreatedAt <= timing.signedAt).toBe(true);
    // agreement-pdf uses this metadata timestamp for its visible "Signed at" line,
    // so it must be the exact authoritative timestamp persisted on the record.
    expect(timing.pdfCreatedAt).toBe(timing.signedAt);

    await page.reload();
    await expect(card).toContainText("电子版");
    await card.getByRole("button", { name: "查看签署文件" }).click();
    await expect(page.getByTestId("evidence-pdf-frame")).toHaveAttribute("src", /^blob:/);
    await expect(page.locator('[src^="data:"], [href^="data:"]')).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("base64,");
    await page.getByRole("button", { name: "关闭证据" }).click();
    await page.getByTestId("customer-tab-history").click();
    const audit = page.getByTestId("customer-audit-history");
    await expect(audit).toContainText("协议形式");
    const auditEvidence = audit.locator("button").filter({ hasText: /^evidence-/ }).first();
    await expect(auditEvidence).toBeVisible();
    await auditEvidence.click();
    await expect(page.getByTestId("evidence-asset-viewer")).toBeVisible();
  });

  test("OTP dialog rejects an authorized identity switch without changing customer storage", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-001");
    await page.getByRole("button", { name: "标记联系不上" }).click();
    const before = await page.evaluate((storageKey) => localStorage.getItem(storageKey), CUSTOMER_STORAGE_KEY);
    await page.evaluate((identity) => {
      localStorage.setItem("wh_session", JSON.stringify({ identity, token: `offline-${identity.id}`, expiresAt: "2099-01-01T00:00:00.000Z" }));
    }, identities.frontdesk_admin);
    await page.getByLabel("作废原因").fill("号码无法接通");
    await page.getByRole("button", { name: "确认作废" }).click();
    await expect(page.getByTestId("otp-verification-dialog").getByRole("alert")).toContainText("会话已变化");
    const after = await page.evaluate((storageKey) => localStorage.getItem(storageKey), CUSTOMER_STORAGE_KEY);
    expect(after).toBe(before);
  });

  test("KYC dialog fits 430px, closes on Escape, and restores trigger focus", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    const trigger = page.getByRole("button", { name: "补充驾驶证" });
    await trigger.click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    const geometry = await dialog.evaluate((node) => ({ width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    expect(geometry.width).toBeLessThanOrEqual(398);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.goto("/customers/CUST-UAT-002");
    const organizationTrigger = page.getByRole("button", { name: "补录主要联系人驾驶证" });
    await organizationTrigger.click();
    const organizationDialog = page.getByTestId("kyc-verification-dialog");
    const organizationGeometry = await organizationDialog.evaluate((node) => ({
      width: node.getBoundingClientRect().width,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }));
    expect(organizationGeometry.width).toBeLessThanOrEqual(398);
    expect(organizationGeometry.scrollWidth).toBeLessThanOrEqual(organizationGeometry.clientWidth);
    await page.keyboard.press("Escape");
    await expect(organizationDialog).toHaveCount(0);
    await expect(organizationTrigger).toBeFocused();
  });

  test("organization contact KYC saves a mismatched snapshot as warning-only evidence", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-004");
    const card = page.getByTestId("customer-kyc-evidence-card");
    await card.getByRole("button", { name: "补录主要联系人驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await page.getByTestId("kyc-profile-name").fill("Alicia Bennett");
    await page.getByTestId("kyc-profile-birth-date").fill("1988-03-22");
    await page.getByTestId("kyc-profile-gender").selectOption("女");
    await page.getByTestId("kyc-profile-address").fill("12 Constant Spring Road, Kingston 8, Jamaica");
    await page.getByRole("button", { name: "提交并核验" }).click();

    await expect(dialog.getByRole("status")).toContainText("证件姓名与当前主要联系人姓名不同");
    await expect(dialog.getByRole("status")).toContainText("已保留证据并标记为需重新核验");
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "关闭驾驶证核验" }).click();
    await expect(card).toContainText("需重新核验");
    await expect(card).toContainText("Alicia Bennett");
    await expect(card).toContainText("历史证据已保留");
  });

  test("organization contact KYC derives normalized submission status from the returned scoped record", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-002");
    await page.getByRole("button", { name: "补录主要联系人驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await expect(page.getByTestId("kyc-profile-gender").locator('option[value="其他"]')).toHaveCount(0);
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await page.getByTestId("kyc-profile-name").fill("DWAYNE  CLARKE");
    await page.getByTestId("kyc-profile-birth-date").fill("1987-09-14");
    await page.getByTestId("kyc-profile-gender").selectOption("男");
    await page.getByTestId("kyc-profile-address").fill("14 Contact Lane, Kingston");
    await page.getByRole("button", { name: "提交并核验" }).click();

    await expect(dialog.getByRole("status")).toContainText("企业正式资料未更改");
    await expect(dialog.getByRole("status")).not.toContainText("需重新核验");
    await page.getByRole("button", { name: "关闭驾驶证核验" }).click();
    await expect(page.getByTestId("customer-kyc-evidence-card")).toContainText("已核验");
    const storedName = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      return envelope.state?.customers
        ?.find((entry) => entry.id === "CUST-UAT-002")
        ?.verificationArchive?.kycRecords?.at(-1)?.subjectProfile?.name;
    }, CUSTOMER_STORAGE_KEY);
    expect(storedName).toBe("DWAYNE CLARKE");
  });

  test("organization pending scoped KYC keeps its stored snapshot readonly and ignores tampered local fields", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-002");
    await page.getByRole("button", { name: "补录主要联系人驾驶证" }).click();
    let dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await page.getByTestId("kyc-profile-name").fill("Dwayne Clarke");
    await page.getByTestId("kyc-profile-birth-date").fill("1987-09-14");
    await page.getByTestId("kyc-profile-gender").selectOption("男");
    await page.getByTestId("kyc-profile-address").fill("14 Contact Lane, Kingston");
    await page.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("企业正式资料未更改");
    await page.getByRole("button", { name: "关闭驾驶证核验" }).click();

    await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state: { customers: Array<Record<string, any>> } };
      const customer = envelope.state.customers.find((entry) => entry.id === "CUST-UAT-002");
      const record = customer?.verificationArchive?.kycRecords?.at(-1);
      if (!record || record.subjectType !== "organization_primary_contact") throw new Error("pending scoped KYC fixture missing");
      delete record.verifiedAt;
      delete record.verifiedBy;
      localStorage.setItem(storageKey, JSON.stringify(envelope));
    }, CUSTOMER_STORAGE_KEY);
    await page.reload();
    const card = page.getByTestId("customer-kyc-evidence-card");
    await expect(card).toContainText("待核验");
    await card.getByRole("button", { name: "继续核验主要联系人驾驶证" }).click();
    dialog = page.getByTestId("kyc-verification-dialog");
    for (const field of [
      page.getByTestId("kyc-profile-name"),
      page.getByTestId("kyc-profile-birth-date"),
      page.getByTestId("kyc-profile-gender"),
      page.getByTestId("kyc-profile-address"),
    ]) {
      await expect(field).toBeDisabled();
    }
    await expect(page.getByTestId("kyc-profile-name")).toHaveValue("Dwayne Clarke");
    await expect(page.getByTestId("kyc-profile-birth-date")).toHaveValue("1987-09-14");
    await expect(page.getByTestId("kyc-profile-gender")).toHaveValue("男");
    await expect(page.getByTestId("kyc-profile-address")).toHaveValue("14 Contact Lane, Kingston");

    const nameField = page.getByTestId("kyc-profile-name");
    await nameField.evaluate((node) => { (node as HTMLInputElement).disabled = false; });
    await nameField.fill("");
    await page.getByRole("button", { name: "继续人工核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("企业正式资料未更改");
    await expect(dialog.getByRole("status")).not.toContainText("需重新核验");

    const persisted = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      return envelope.state?.customers
        ?.find((entry) => entry.id === "CUST-UAT-002")
        ?.verificationArchive?.kycRecords?.at(-1);
    }, CUSTOMER_STORAGE_KEY);
    expect(persisted).toMatchObject({
      subjectType: "organization_primary_contact",
      subjectProfile: {
        name: "Dwayne Clarke",
        birthDate: "1987-09-14",
        sex: "M",
        address: "14 Contact Lane, Kingston",
      },
    });
    expect(persisted.verifiedAt).toBeTruthy();
  });

  test("organization contact license stays scoped, survives reload, and becomes pending after contact rename", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    await expect(page.getByTestId("customer-pending-CUST-UAT-002")).toHaveText("3 项待补");
    await page.getByTestId("customer-open-CUST-UAT-001").click();
    await page.getByRole("button", { name: "标记联系不上" }).click();
    await page.getByLabel("作废原因").fill("测试准备企业旧证据历史");
    await page.getByRole("button", { name: "确认作废" }).click();
    await page.getByTestId("customer-detail-back").click();
    await expect.poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey) !== null, CUSTOMER_STORAGE_KEY)).toBe(true);
    await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state: { customers: Array<Record<string, any>> } };
      const organization = envelope.state.customers.find((entry) => entry.id === "CUST-UAT-002");
      const individual = envelope.state.customers.find((entry) => entry.id === "CUST-UAT-001");
      const legacyRecord = individual?.verificationArchive?.kycRecords?.[0];
      if (!organization || !legacyRecord) throw new Error("legacy organization KYC fixture missing");
      organization.verificationArchive.kycRecords.push({
        ...legacyRecord,
        id: "KYC-LEGACY-ORGANIZATION-UNSCOPED",
      });
      localStorage.setItem(storageKey, JSON.stringify(envelope));
    }, CUSTOMER_STORAGE_KEY);
    await page.reload();
    await expect(page.getByTestId("customer-pending-CUST-UAT-002")).toHaveText("3 项待补");
    await page.getByTestId("customer-open-CUST-UAT-002").click();

    const card = page.getByTestId("customer-kyc-evidence-card");
    await expect(card).toContainText("主要联系人驾驶证");
    await expect(card).toContainText("待补");
    await expect(card).not.toContainText("不适用");
    await expect(card.getByRole("button", { name: "补录主要联系人驾驶证" })).toBeVisible();

    await page.getByRole("button", { name: /查看全部验证历史/ }).click();
    const history = page.getByTestId("customer-verification-history");
    await expect(history).toContainText("主体待确认");
    await expect(history).toContainText("已核验");

    const before = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      const customer = envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-002");
      return {
        address: customer?.address,
        gender: customer?.gender,
        birthDate: customer?.birthDate,
        kycCount: customer?.verificationArchive?.kycRecords?.length,
      };
    }, CUSTOMER_STORAGE_KEY);

    await card.getByRole("button", { name: "补录主要联系人驾驶证" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await dialog.getByLabel("驾驶证正面（必填）").setInputFiles("public/seed-evidence/alicia-bennett-drivers-license-front.png");
    await page.getByTestId("kyc-profile-name").fill("Dwayne Clarke");
    await page.getByTestId("kyc-profile-birth-date").fill("1987-09-14");
    await page.getByTestId("kyc-profile-gender").selectOption("男");
    await page.getByTestId("kyc-profile-address").fill("14 Contact Lane, Kingston");
    await page.getByRole("button", { name: "提交并核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("主要联系人驾驶证证据已提交并完成人工核验");
    await expect(dialog.getByRole("button", { name: "确认写入正式资料" })).toHaveCount(0);
    await page.getByRole("button", { name: "关闭驾驶证核验" }).click();

    await expect(card).toContainText("已核验");
    await expect(card).toContainText("联系人姓名");
    await expect(card).toContainText("Dwayne Clarke");
    await expect(card).toContainText("出生日期");
    await expect(card).toContainText("1987-09-14");
    await expect(card).toContainText("性别");
    await expect(card).toContainText("男");
    await expect(card).toContainText("证件地址");
    await expect(card).toContainText("14 Contact Lane, Kingston");

    const afterVerify = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>>; auditEvents?: Array<Record<string, any>> } };
      const customer = envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-002");
      const record = customer?.verificationArchive?.kycRecords?.at(-1);
      return {
        formal: { address: customer?.address, gender: customer?.gender, birthDate: customer?.birthDate },
        kycCount: customer?.verificationArchive?.kycRecords?.length,
        record,
        audit: envelope.state?.auditEvents?.filter((event) => event.customerId === "CUST-UAT-002"),
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(afterVerify.formal).toEqual({ address: before.address, gender: before.gender, birthDate: before.birthDate });
    expect(afterVerify.kycCount).toBe(before.kycCount + 1);
    expect(afterVerify.record).toMatchObject({
      subjectType: "organization_primary_contact",
      subjectProfile: {
        name: "Dwayne Clarke",
        birthDate: "1987-09-14",
        sex: "M",
        address: "14 Contact Lane, Kingston",
      },
    });
    expect(JSON.stringify(afterVerify.audit)).toContain("提交主要联系人驾驶证证据");
    expect(JSON.stringify(afterVerify.audit)).toContain("完成主要联系人驾驶证核验");
    expect(JSON.stringify(afterVerify.audit)).not.toContain("14 Contact Lane, Kingston");
    expect(JSON.stringify(afterVerify.audit)).not.toContain("base64");

    await page.reload();
    await expect(card).toContainText("Dwayne Clarke");
    await card.getByRole("button", { name: "查看驾驶证" }).click();
    await expect(page.getByTestId("evidence-asset-viewer").locator("img")).toHaveAttribute("src", /^blob:/);
    await page.getByRole("button", { name: "关闭证据" }).click();
    await card.getByRole("button", { name: "重新核验主要联系人驾驶证" }).click();
    await expect(page.getByTestId("kyc-profile-name")).toHaveValue("Dwayne Clarke");
    await expect(page.getByTestId("kyc-profile-birth-date")).toHaveValue("1987-09-14");
    await expect(page.getByTestId("kyc-profile-gender")).toHaveValue("男");
    await expect(page.getByTestId("kyc-profile-address")).toHaveValue("14 Contact Lane, Kingston");
    await page.getByRole("button", { name: "关闭驾驶证核验" }).click();

    await page.getByTestId("customer-edit-btn").click();
    await page.getByTestId("form-customer-name").fill("陈志远");
    await page.getByTestId("customer-name-transliteration-confirm").click();
    await expect(page.getByTestId("customer-name-transliteration-preview")).toContainText("Chen Zhiyuan");
    await page.getByTestId("form-save").click();
    await expect(page.getByTestId("customer-duplicate-candidates")).toContainText("不阻断保存");
    await page.getByTestId("form-save").click();
    await expect(page.getByTestId("customer-form-dialog")).toHaveCount(0);
    await page.reload();
    await expect(card).toContainText("需重新核验");
    await page.getByRole("button", { name: /查看全部验证历史/ }).click();
    await expect(page.getByTestId("customer-verification-history")).toContainText("Dwayne Clarke");
    const afterRename = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      const customer = envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-002");
      return {
        formal: { address: customer?.address, gender: customer?.gender, birthDate: customer?.birthDate },
        kycCount: customer?.verificationArchive?.kycRecords?.length,
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(afterRename).toEqual({
      formal: { address: before.address, gender: before.gender, birthDate: before.birthDate },
      kycCount: afterVerify.kycCount,
    });
  });

  test("OTP failed request keeps input and retries without duplicate records", async ({ page }) => {
    await useIdentity(page, "superadmin", { failNext: { customerVehicleSave: "演示 OTP 保存失败" } });
    await page.goto("/customers/CUST-UAT-003");
    await page.getByRole("button", { name: "重新 OTP" }).click();
    await page.getByLabel("验证号码").fill("+18765550123");
    await page.getByRole("button", { name: "发送验证码" }).click();
    await expect(page.getByTestId("otp-verification-dialog").getByRole("alert")).toContainText("演示 OTP 保存失败");
    await expect(page.getByLabel("验证号码")).toHaveValue("+18765550123");
    await page.getByRole("button", { name: "发送验证码" }).click();
    await expect(page.getByText("纯 Mock 演示验证码")).toBeVisible();
    const count = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      return envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-003")?.verificationArchive?.otpRecords?.length;
    }, CUSTOMER_STORAGE_KEY);
    expect(count).toBe(1);
  });

  test("OTP request persists immediately and reopening continues the same pending record", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    const card = page.getByTestId("customer-otp-evidence-card");
    await card.getByRole("button", { name: "重新 OTP" }).click();
    await page.getByLabel("验证号码").fill("+18765550124");
    await page.getByRole("button", { name: "发送验证码" }).click();
    await expect(page.getByText("纯 Mock 演示验证码")).toBeVisible();
    await page.getByRole("button", { name: "关闭 OTP 验证" }).click();

    await expect(card).toContainText("+1 876 555 0124");
    await expect(card).toContainText("验证中");
    await card.getByRole("button", { name: "继续 OTP" }).click();
    await expect(page.getByLabel("验证号码")).toHaveValue("+1 876 555 0124");
    await page.getByLabel("验证码").fill("123456");
    await page.getByRole("button", { name: "确认验证" }).click();
    await expect(page.getByTestId("otp-verification-dialog")).toHaveCount(0);

    const records = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      return envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-003")?.verificationArchive?.otpRecords;
    }, CUSTOMER_STORAGE_KEY);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ phoneE164: "+18765550124" });
    expect(records[0].verifiedAt).toBeTruthy();
  });

  test("reopening a persisted pending KYC verifies that record without another upload", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-001");
    await page.getByRole("button", { name: "标记联系不上" }).click();
    await page.getByLabel("作废原因").fill("测试准备持久化 fresh state");
    await page.getByRole("button", { name: "确认作废" }).click();
    await expect(page.getByTestId("otp-verification-dialog")).toHaveCount(0);
    await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state: { customers: Array<Record<string, any>> } };
      const customer = envelope.state.customers.find((entry) => entry.id === "CUST-UAT-001");
      const record = customer?.verificationArchive?.kycRecords?.at(-1);
      if (!record) throw new Error("seed KYC record missing");
      delete record.verifiedAt;
      delete record.verifiedBy;
      localStorage.setItem(storageKey, JSON.stringify(envelope));
    }, CUSTOMER_STORAGE_KEY);
    await page.reload();

    const card = page.getByTestId("customer-kyc-evidence-card");
    await expect(card).toContainText("待人工核验");
    await card.getByRole("button", { name: "继续 KYC" }).click();
    const dialog = page.getByTestId("kyc-verification-dialog");
    await expect(dialog).toContainText("继续核验已提交的驾驶证证据");
    await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
    await page.getByRole("button", { name: "继续人工核验" }).click();
    await expect(dialog.getByRole("status")).toContainText("已完成人工核验");

    const records = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { customers?: Array<Record<string, any>> } };
      return envelope.state?.customers?.find((entry) => entry.id === "CUST-UAT-001")?.verificationArchive?.kycRecords;
    }, CUSTOMER_STORAGE_KEY);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe("KYC-UAT-ALICIA-DL-001");
    expect(records[0].verifiedAt).toBeTruthy();
  });
});

test.describe("验证与协议 + 风险状态（后补制）", () => {
  test("全待补客户详情页显示三项可信状态和对应补录操作", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();
    const section = page.getByTestId("customer-verification-section");
    await expect(section).toBeVisible();
    await expect(section.getByTestId("verification-row-otp")).toContainText("待补验证");
    await expect(section.getByTestId("verification-row-kyc")).toContainText("待补 KYC");
    await expect(section.getByTestId("verification-row-agreement")).toContainText("待签署");
    await expect(section).toContainText("所有状态都可追溯、可调取、可重新验证");
    await expect(section).toContainText("未补齐只提醒不阻止办理");
    await expect(section.getByRole("button", { name: "重新 OTP" })).toBeVisible();
    await expect(section.getByRole("button", { name: "补充驾驶证" })).toBeVisible();
    await expect(section.getByRole("button", { name: "登记协议", exact: true })).toBeVisible();

    const rowBoxes = await Promise.all([
      section.getByTestId("verification-row-otp").boundingBox(),
      section.getByTestId("verification-row-kyc").boundingBox(),
      section.getByTestId("verification-row-agreement").boundingBox(),
    ]);
    if (rowBoxes.some((box) => box === null)) throw new Error("验证与协议排版项不可见");
    const boxes = rowBoxes as Exclude<(typeof rowBoxes)[number], null>[];
    expect(Math.max(...boxes.map((box) => box.y)) - Math.min(...boxes.map((box) => box.y))).toBeLessThanOrEqual(1);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].x).toBeLessThan(boxes[2].x);
    const sectionBox = await section.boundingBox();
    if (!sectionBox) throw new Error("验证与协议区不可见");
    expect(sectionBox.height).toBeLessThan(320);
  });

  test("1024px 验证卡等宽，正式资料合并联系方式且个人没有额外联系人", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();

    const documentGeometry = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      rootScroll: document.documentElement.scrollWidth,
      bodyScroll: document.body.scrollWidth,
    }));
    expect(documentGeometry.viewportWidth).toBe(1024);
    expect(Math.max(documentGeometry.rootScroll, documentGeometry.bodyScroll)).toBeLessThanOrEqual(1024);

    const formalDetails = page.getByTestId("customer-formal-details");
    const formalBox = await formalDetails.boundingBox();
    const currentVehiclesBox = await page.getByTestId("customer-section-current-vehicles").boundingBox();
    if (!formalBox || !currentVehiclesBox) throw new Error("1024px 正式资料或车辆分区不可见");
    expect(formalBox.width).toBeGreaterThan(currentVehiclesBox.width * 1.8);
    await expect(formalDetails).toContainText("主要电话");
    await expect(formalDetails).toContainText("Email");
    await expect(page.getByTestId("customer-registration-time")).toBeVisible();
    await expect(page.getByTestId("customer-section-contacts")).toHaveCount(0);
    await expect(page.getByTestId("customer-section-bo-history")).toHaveCount(0);

    const section = page.getByTestId("customer-verification-section");
    const rowBoxes = await Promise.all([
      section.getByTestId("verification-row-otp").boundingBox(),
      section.getByTestId("verification-row-kyc").boundingBox(),
      section.getByTestId("verification-row-agreement").boundingBox(),
    ]);
    if (rowBoxes.some((box) => box === null)) {
      throw new Error("1024px 验证卡不可见");
    }
    const rows = rowBoxes as Exclude<(typeof rowBoxes)[number], null>[];
    expect(Math.max(...rows.map((box) => box.y)) - Math.min(...rows.map((box) => box.y))).toBeLessThanOrEqual(1);
    expect(Math.max(...rows.map((box) => box.width)) - Math.min(...rows.map((box) => box.width))).toBeLessThanOrEqual(1);
    await expect(section.getByRole("button", { name: "重新 OTP" })).toBeVisible();
    await expect(section.getByRole("button", { name: "补充驾驶证" })).toBeVisible();
    await expect(section.getByRole("button", { name: "登记协议", exact: true })).toBeVisible();
    const sectionBox = await section.boundingBox();
    if (!sectionBox) throw new Error("1024px 验证与协议区不可见");
    expect(sectionBox.height).toBeLessThan(320);
  });

  test("真实 v2 localStorage 迁移到 schema3，删除旧键、标出证据缺口且刷新不重复审计", async ({ page }) => {
    await useIdentity(page, "superadmin", undefined, { customerStorageSeed: genuineV2CustomerEnvelope() });
    await page.goto("/customers/CUST-E2E-V2-001");
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();
    await expect(page.getByTestId("customer-formal-details")).toContainText("Jason Wong");
    await expect(page.getByTestId("customer-section-notes")).toContainText("Preserve migrated note");
    await expect(page.getByTestId("customer-section-current-vehicles")).toContainText("991 ZZ");
    await expect(page.getByTestId("verification-row-otp")).toContainText("证据待补");
    await expect(page.getByTestId("verification-row-kyc")).toContainText("证据待补");
    await expect(page.getByTestId("verification-row-agreement")).toContainText("证据待补");
    await expect(page.getByTestId("verification-row-otp")).toContainText("旧完成状态没有可查号码或验证记录");
    await expect(page.getByTestId("verification-row-kyc")).toContainText("旧完成状态没有可查驾驶证照片");
    await expect(page.getByTestId("customer-otp-evidence-card").getByRole("button", { name: "重新 OTP" })).toBeVisible();
    await expect(page.getByTestId("customer-kyc-evidence-card").getByRole("button", { name: "补充驾驶证" })).toBeVisible();
    await expect(page.getByTestId("customer-agreement-evidence-card").getByRole("button", { name: "登记协议", exact: true })).toBeVisible();

    const firstMigration = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
        schemaVersion?: number;
        state?: { customers?: Array<Record<string, unknown>>; vehicles?: Array<Record<string, unknown>>; auditEvents?: Array<{ id: string }> };
      };
      const customer = envelope.state?.customers?.[0] ?? {};
      const vehicle = envelope.state?.vehicles?.[0] ?? {};
      return {
        schemaVersion: envelope.schemaVersion,
        removedCustomerKeys: ["source", "riskNote", "tags", "verification", "contacts", "orders", "paymentSummary", "communications", "tasks", "attachments", "changeHistory", "recentBusiness", "recentBusinessDate", "activeBusinessCount"].filter((key) => key in customer),
        removedVehicleKeys: ["recentService", "recentServiceDate", "linkedOrderCount", "totalAmount", "unpaidAmount", "serviceHistory", "changeHistory"].filter((key) => key in vehicle),
        evidenceGapKinds: ((customer.verificationArchive as { evidenceGaps?: Array<{ kind: string }> } | undefined)?.evidenceGaps ?? []).map((gap) => gap.kind),
        auditIds: envelope.state?.auditEvents?.map((event) => event.id) ?? [],
      };
    }, CUSTOMER_STORAGE_KEY);
    expect(firstMigration.schemaVersion).toBe(3);
    expect(firstMigration.removedCustomerKeys).toEqual([]);
    expect(firstMigration.removedVehicleKeys).toEqual([]);
    expect(firstMigration.evidenceGapKinds).toEqual(["otp", "kyc", "agreement"]);
    expect(firstMigration.auditIds.filter((id) => id === "MIGRATION-CUST-E2E-V2-001")).toHaveLength(1);

    await page.reload();
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();
    await expect(page.getByTestId("customer-formal-details")).toContainText("Jason Wong");
    const auditIdsAfterReload = await page.evaluate((storageKey) => {
      const envelope = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { state?: { auditEvents?: Array<{ id: string }> } };
      return envelope.state?.auditEvents?.map((event) => event.id) ?? [];
    }, CUSTOMER_STORAGE_KEY);
    expect(auditIdsAfterReload).toEqual(firstMigration.auditIds);
    expect(auditIdsAfterReload.filter((id) => id === "MIGRATION-CUST-E2E-V2-001")).toHaveLength(1);

    await page.getByTestId("customer-vehicle-link-VEH-E2E-V2-001").click();
    await expect(page.getByTestId("vehicle-detail-page")).toBeVisible();
    await expect(page.getByTestId("vehicle-section-tasks")).toContainText("VEH-TASK-V2-001");
    await expect(page.getByTestId("vehicle-section-tasks")).toContainText("Preserve migrated task");
    await expect(page.getByTestId("vehicle-section-parts-needs")).toContainText("PART-V2-001");
    await expect(page.getByTestId("vehicle-section-parts-needs")).toContainText("Filter");
  });

  test("个人客户单姓名栏确认陈志远，改字使确认失效，Jason Wong 明确报错且不生成单字王", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    await page.getByTestId("customer-open-CUST-UAT-003").click();
    await page.getByTestId("customer-edit-btn").click();
    await expect(page.getByTestId("form-customer-name")).toHaveCount(1);
    await expect(page.getByTestId("form-customer-name-zh")).toHaveCount(0);

    const name = page.getByTestId("form-customer-name");
    await name.fill("陈志远");
    await page.getByTestId("customer-name-transliteration-confirm").click();
    await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("Chen Zhiyuan");

    await name.fill("林美华");
    await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("确认后显示对应音译");
    await page.getByTestId("form-save").click();
    await expect(page.getByTestId("form-customer-name-error")).toContainText("请先确认姓名音译结果");

    await name.fill("Jason Wong");
    await page.getByTestId("customer-name-transliteration-confirm").click();
    const alert = page.getByTestId("form-save-error");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toHaveText("当前纯 Mock 音译库没有该完整姓名");
    await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("确认后显示对应音译");
    await expect(page.getByText("王", { exact: true })).toHaveCount(0);
  });

  test("添加风险条目后显示并可解除，等级与留痕正确", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();
    await expect(page.getByTestId("risk-empty")).toBeVisible();
    await page.getByTestId("risk-add-btn").click();
    const dialog = page.getByTestId("risk-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("risk-level").selectOption("blacklist");
    await page.getByTestId("risk-note").fill("测试：多次口头承诺不兑现");
    await page.getByTestId("risk-confirm").click();
    const section = page.getByTestId("customer-risk-section");
    await expect(section).toContainText("黑名单");
    await expect(section).toContainText("测试：多次口头承诺不兑现");
    // 客户端导航回列表（避免 init 清库）+ 稳定点
    await page.getByTestId("customer-detail-back").click();
    await page.getByTestId("customers-heading").waitFor();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_customer_vehicle_mock_v1") !== null)).toBe(true);
    await expect(page.getByTestId("customer-row-CUST-UAT-003")).toContainText("高风险");
    // 解除（点行进详情，客户端导航保住 Mock 数据）
    await page.getByTestId("customer-open-CUST-UAT-003").click();
    await page.getByTestId("customer-detail-page").waitFor();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("wh_customer_vehicle_mock_v1") !== null)).toBe(true);
    await page.locator('[data-testid^="risk-remove-"]').first().click();
    await expect(page.getByTestId("customer-risk-section")).toContainText("已解除 1 条");
  });

  test("汇总卡不再展示静态欠账，验证证据卡只保留有待补项的客户", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    await expect(page.getByTestId("customer-card-filter-debt")).toHaveCount(0);
    await expect(page.locator('[data-testid^="customer-debt-"]')).toHaveCount(0);
    const verificationCard = page.getByTestId("customer-card-filter-verification");
    await expect(verificationCard).toBeVisible();
    await verificationCard.click();
    const visibleRows = page.locator('[data-testid^="customer-row-"]');
    expect(await visibleRows.count()).toBeGreaterThan(0);
    for (const row of await visibleRows.all()) {
      await expect(row.locator('[data-testid^="customer-pending-"]')).toBeVisible();
    }
  });

  test("资料待补卡只显示有待补项的客户，再点一次恢复", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    const incompleteCard = page.getByTestId("customer-card-filter-incomplete");
    const expectedIncomplete = Number((await incompleteCard.locator("p").nth(1).textContent())?.trim() ?? "0");
    await incompleteCard.click();
    await expect(page.locator('[data-testid^="customer-row-"]')).toHaveCount(Math.min(expectedIncomplete, 20));
    await expect(page.getByTestId("customer-pagination")).toContainText(`共 ${expectedIncomplete} 条`);
    for (const badge of await page.locator('[data-testid^="customer-profile-"]:not([data-testid$="-mobile"])').all()) {
      await expect(badge).toContainText("待完善");
    }
    await incompleteCard.click();
    await expect(page.getByTestId("customer-row-CUST-UAT-001")).toBeVisible();
  });

  test("新建客户工作区按号码、证件、正式资料分阶段，不再显示可后补或额外字段", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    await page.getByTestId("create-customer-btn").click();
    await expect(page.getByTestId("customer-onboarding-dialog")).toBeVisible();
    await expect(page.getByTestId("onboarding-phone-step")).toBeVisible();
    await expect(page.getByTestId("onboarding-license-step")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("onboarding-profile-step")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("仅支持 JPEG、PNG，不支持 PDF", { exact: true })).toBeVisible();
    await expect(page.getByTestId("form-defer-hint")).toHaveCount(0);
    await expect(page.getByTestId("form-customer-source")).toHaveCount(0);
    await expect(page.getByTestId("form-customer-tags")).toHaveCount(0);
    await expect(page.getByTestId("form-customer-risk")).toHaveCount(0);
    await expect(page.getByTestId("onboarding-first-vehicle")).toHaveCount(0);
  });

  test("车辆详情照片档案展示证件与维修照片，车型字段无变速箱与登记到期", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page, "/vehicles");
    await page.getByTestId("vehicle-open-VEH-UAT-001").click();
    await expect(page).toHaveURL(/\/vehicles\/VEH-UAT-001$/);
    const photos = page.getByTestId("vehicle-section-photos");
    await expect(photos).toBeVisible();
    await expect(photos.locator("figure")).toHaveCount(3);
    await expect(photos).toContainText("注册证");
    await expect(photos).toContainText("适航证");
    await expect(photos).toContainText("维修照片");
    await expect(photos.locator('img').first()).toHaveAttribute("src", /seed-photos/);
    const reportPhotos = page.getByTestId("vehicle-section-inspection-report-photos");
    await expect(reportPhotos).toBeVisible();
    await expect(reportPhotos).toContainText("Inspection Report 现场照片");
    await expect(photos).not.toContainText("Inspection Report 现场照片");
    // 证件字段有，变速箱和登记到期没有
    const master = page.getByTestId("vehicle-section-master");
    await expect(master).toContainText("车架号");
    await expect(master).toContainText("发动机号");
    await expect(master).toContainText("车身类型");
    await expect(master).not.toContainText("变速箱");
    await expect(master).not.toContainText("登记到期");
  });

  test("挂账资格：签名登记立即生效，可取消，全程留痕", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-003");
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();
    const hero = page.getByTestId("customer-financial-hero");
    await expect(hero).toContainText("挂账资格");
    await expect(hero).toContainText("未登记");

    // 登记：不签名不给提交
    await page.getByTestId("customer-credit-toggle").click();
    const dialog = page.getByTestId("credit-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("credit-confirm").click();
    await expect(page.getByTestId("credit-error")).toContainText("手写签名");
    const pad = page.getByTestId("credit-signature");
    const box = await pad.boundingBox();
    if (!box) throw new Error("签名板不可见");
    await page.mouse.move(box.x + 30, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId("credit-confirm").click();
    await expect(hero).toContainText("登记");
    await expect(page.getByTestId("customer-credit-toggle")).toContainText("取消资格");

    // 取消：填原因
    await page.getByTestId("customer-credit-toggle").click();
    await page.getByTestId("credit-revoke-reason").fill("测试：月结逾期，暂停挂账");
    await page.getByTestId("credit-confirm").click();
    await expect(hero).toContainText("取消");
    await expect(page.getByTestId("customer-credit-toggle")).toContainText("开通挂账");
  });

  test("新建企业客户复用可跳过的主要联系人驾驶证步骤", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    await page.getByTestId("create-customer-btn").click();
    await page.getByTestId("onboarding-customer-type").selectOption("organization");
    await expect(page.getByTestId("onboarding-license-step")).toContainText("企业主要联系人驾驶证（选填）");
    await expect(page.getByTestId("onboarding-license-file")).toBeDisabled();
    await expect(page.getByTestId("onboarding-organization-name")).toBeDisabled();
    await expect(page.getByTestId("onboarding-primary-contact-role")).toBeDisabled();
    await expect(page.getByTestId("onboarding-name-source")).toBeDisabled();
    await page.getByTestId("onboarding-phone").fill("+1 876 555 0188");
    await page.getByTestId("onboarding-check-phone").click();
    await expect(page.getByTestId("onboarding-license-file")).toBeEnabled();
    await expect(page.getByTestId("onboarding-organization-name")).toBeEnabled();
    await expect(page.getByTestId("form-customer-source")).toHaveCount(0);
    await expect(page.getByTestId("form-customer-tags")).toHaveCount(0);
    await expect(page.getByTestId("form-customer-risk")).toHaveCount(0);
    await expect(page.getByTestId("form-customer-recent-business")).toHaveCount(0);
  });

  test("客户类型切换会重启号码流程并清除另一类型的草稿入口", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    await page.getByTestId("create-customer-btn").click();
    await page.getByTestId("onboarding-phone").fill("+1 876 555 9988");
    await page.getByTestId("onboarding-customer-type").selectOption("organization");
    await expect(page.getByTestId("onboarding-phone")).toHaveValue("");
    await expect(page.getByTestId("onboarding-organization-name")).toBeDisabled();
    await expect(page.getByTestId("onboarding-license-step")).toContainText("企业主要联系人驾驶证（选填）");
    await page.getByTestId("onboarding-phone").fill("+1 876 555 9987");
    await page.getByTestId("onboarding-customer-type").selectOption("individual");
    await expect(page.getByTestId("onboarding-phone")).toHaveValue("");
    await expect(page.getByTestId("onboarding-organization-name")).toHaveCount(0);
    await expect(page.getByTestId("onboarding-license-step")).toBeVisible();
    await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("确认后显示只读对应音译");
  });

  test("备注可随手新增与编辑", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await page.goto("/customers/CUST-UAT-001");
    await expect(page.getByTestId("customer-detail-page")).toBeVisible();
    const initialRevision = Number((await page.getByTestId("customer-revision").textContent())?.match(/\d+/)?.[0] ?? "0");
    await page.getByTestId("note-add").click();
    await page.getByTestId("note-new-input").fill("测试备注：习惯下午取车");
    await page.getByTestId("note-new-save").click();
    await expect.poll(async () => Number(
      (await page.getByTestId("customer-revision").textContent())?.match(/\d+/)?.[0] ?? "0",
    )).toBeGreaterThan(initialRevision);
    await expect(page.getByTestId("customer-section-notes")).toContainText("测试备注：习惯下午取车");
    await expect(page.getByTestId("note-edit-NOTE-UAT-001")).toBeEnabled();
    await page.getByTestId("note-edit-NOTE-UAT-001").click();
    await page.getByTestId("note-edit-input-NOTE-UAT-001").fill("编辑后：Prefers morning pickup（已确认）");
    await page.getByTestId("note-save-NOTE-UAT-001").click();
    await expect(page.getByTestId("customer-section-notes")).toContainText("编辑后：Prefers morning pickup（已确认）");
  });

  test("双语：编辑时单姓名栏确认后中文给英文、英文给中文", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    await page.getByTestId("customer-open-CUST-UAT-003").click();
    await page.getByTestId("customer-edit-btn").click();
    await expect(page.getByTestId("form-customer-name")).toHaveCount(1);
    await expect(page.getByTestId("form-customer-name-zh")).toHaveCount(0);
    const name = page.getByTestId("form-customer-name");
    await name.fill("陈志远");
    await page.getByTestId("customer-name-transliteration-confirm").click();
    await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("Chen Zhiyuan");
    await name.fill("Alicia Bennett");
    await page.getByTestId("customer-name-transliteration-confirm").click();
    await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("艾丽西亚·贝内特");
    await name.fill("赵明轩");
    await page.getByTestId("customer-name-transliteration-confirm").click();
    await expect(page.getByTestId("customer-name-transliteration-preview")).toHaveText("Zhao Mingxuan");
  });

  test("双语：车辆品牌车型中英互译，列表双语显示", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page, "/vehicles");
    await page.getByTestId("create-vehicle-btn").click();
    // 中文品牌 → 英文
    await page.getByTestId("form-vehicle-make-zh").fill("丰田");
    await expect(page.getByTestId("form-vehicle-make")).toHaveValue("Toyota");
    // 英文车型 → 中文
    await page.getByTestId("form-vehicle-model").fill("Corolla");
    await expect(page.getByTestId("form-vehicle-model-zh")).toHaveValue("卡罗拉");
    await page.keyboard.press("Escape");
    // 列表双语（VEH-UAT-001 本田 CR-V 种子）
    await page.getByTestId("search-input-vehicles").fill("8841 XM");
    await expect(page.getByTestId("vehicle-row-VEH-UAT-001")).toContainText("本田");
    await expect(page.getByTestId("vehicle-row-VEH-UAT-001")).toContainText("Honda");
  });

  test("欠账恢复：欠账卡筛选+行内红字+详情财务英雄区（新 BO 权威来源）", async ({ page }) => {
    await useIdentity(page, "superadmin");
    await openWorkspace(page);
    // 欠账卡：有数量有合计
    const debtCard = page.getByTestId("customer-card-filter-debt");
    await expect(debtCard).toBeVisible();
    await expect(debtCard).toContainText("合计 JMD");
    // 点击筛选：只剩欠账客户，行内红字（新 BO 口径：已交单未结清余额）
    await debtCard.click();
    await expect.poll(async () => page.locator('[data-testid^="customer-row-"]').count(), { timeout: 8000 }).toBeGreaterThan(0);
    // 搜索 Alicia 验证行内红字与详情财务英雄区
    await page.getByTestId("search-input-customers").fill("艾丽西亚");
    const firstRow = page.locator('[data-testid^="customer-row-"]').first();
    await expect(firstRow).toContainText("艾丽西亚·贝内特");
    await expect(page.getByTestId("customer-debt-CUST-UAT-001")).toContainText("JMD");
    await firstRow.click();
    await expect(page).toHaveURL(/\/customers\/CUST-UAT-001$/);
    const hero = page.getByTestId("customer-financial-hero");
    await expect(hero).toBeVisible();
    await expect(page.getByTestId("customer-debt-amount")).toContainText("JMD 78,000");
    await expect(page.getByTestId("customer-total-spend")).toContainText("JMD 78,000");
    await expect(hero).toContainText("挂账资格");
  });
});
