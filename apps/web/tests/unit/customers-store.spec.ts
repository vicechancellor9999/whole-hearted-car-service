import { expect, test } from "@playwright/test";
import {
  createMockCustomerVehicleStore,
} from "../../src/lib/api/mock-customers";
import {
  customerDisplayNameV3,
  deriveCustomerRiskLevel,
  deriveProfileCompleteness,
  searchCustomers,
  searchVehicles,
} from "../../src/lib/customers/selectors";
import { isCustomerEnvelopeV3 } from "../../src/lib/customers/migrations";
import { deriveOtpVerification } from "../../src/lib/customers/verification-domain";
import { SEED_EVIDENCE_ASSETS } from "../../src/lib/customers/seed-evidence";
import type { CustomerRecordV3 } from "../../src/lib/customers/types";
import type {
  CustomerDraftInput,
  CustomerRecord,
  PreviewCustomerUpdateInput,
  PreviewVehicleUpdateInput,
  VehicleDraftInput,
  VehicleRecord,
} from "../../src/lib/customers/types";
import type { EvidenceAsset } from "../../src/lib/customers/verification-types";

test("name preview receipts bind the actor and complete canonical result and are consumed by a successful save", () => {
  const store = createMockCustomerVehicleStore();
  const name = store.previewCustomerName(superadmin, "陈志远");
  expect(name).toMatchObject({
    sourceScript: "zh",
    sourceValue: "陈志远",
    nameZh: "陈志远",
    nameEn: "Chen Zhiyuan",
    method: "offline_pinyin",
    version: "customer-name-v1",
    status: "confirmed",
  });
  expect(name.confirmationToken).toMatch(/^[0-9a-f-]{20,}$/i);
  const duplicatePreview = store.previewCustomer(superadmin, {
    customerType: "individual",
    nameSourceValue: "陈志远",
    nameTransliterationToken: name.confirmationToken,
    primaryPhone: "+1 876 555 0998",
  });
  const created = store.createCustomer(superadmin, {
    ...duplicatePreview.input,
    previewToken: duplicatePreview.previewToken,
    confirmPossibleDuplicate: duplicatePreview.candidates.length > 0 ? true : undefined,
  });
  expect(created).toMatchObject({ nameSourceValue: "陈志远", nameZh: "陈志远", nameEn: "Chen Zhiyuan" });
  expect(() => store.previewCustomer(frontdeskAdmin, {
    customerType: "individual",
    nameSourceValue: "陈志远",
    nameTransliterationToken: name.confirmationToken,
    primaryPhone: "+1 876 555 0999",
  })).toThrow(/姓名确认/);
  expect(() => store.previewCustomer(superadmin, {
    customerType: "individual",
    nameSourceValue: "陈志远",
    nameTransliterationToken: name.confirmationToken,
    primaryPhone: "+1 876 555 0999",
  })).toThrow(/姓名确认/);
});

test("phone-only update keeps the confirmed name without reconfirming while a one-character name change invalidates the old receipt", () => {
  const store = createMockCustomerVehicleStore();
  const current = store.customer(superadmin, "CUST-UAT-001") as CustomerRecord & {
    nameSourceValue: string;
    nameEn: string;
  };
  const phonePreview = store.previewCustomerUpdate(superadmin, current.id, {
    customerType: current.customerType,
    nameSourceValue: current.nameSourceValue,
    primaryPhone: "+1 876 555 0188",
    expectedRevision: current.revision,
  });
  const updated = store.updateCustomer(superadmin, current.id, {
    ...phonePreview.input,
    expectedRevision: current.revision,
    previewToken: phonePreview.previewToken,
    confirmPossibleDuplicate: phonePreview.candidates.length > 0 ? true : undefined,
  });
  expect((updated as CustomerRecord & { nameEn: string }).nameEn).toBe(current.nameEn);
  expect(updated.phone).toBe("+18765550188");

  const stale = store.previewCustomerName(superadmin, "陈志远");
  expect(() => store.previewCustomerUpdate(superadmin, current.id, {
    customerType: current.customerType,
    nameSourceValue: "陈志原",
    nameTransliterationToken: stale.confirmationToken,
    expectedRevision: updated.revision,
  })).toThrow(/姓名确认/);
});

test("formal-profile selectors derive display name, risk, and completeness instead of storing editable substitutes", () => {
  const customer = createMockCustomerVehicleStore().workspace(superadmin).customers[0] as unknown as CustomerRecordV3;
  expect(customerDisplayNameV3(customer)).toBe("艾丽西亚·贝内特 / Alicia Bennett");
  expect(deriveCustomerRiskLevel(customer)).toBe("normal");
  expect(deriveProfileCompleteness(customer)).toBe("complete");
  expect(customer).not.toHaveProperty("riskLevel");
  expect(customer).not.toHaveProperty("profileCompleteness");
  expect(customer).not.toHaveProperty("tags");
  expect(customer).not.toHaveProperty("contacts");
  expect(customer).not.toHaveProperty("paymentSummary");
});

test("formal workspace exposes canonical bilingual search fields and omits customer and vehicle static business truth", () => {
  const workspace = createMockCustomerVehicleStore().workspace(superadmin) as unknown as {
    customers: Array<Record<string, unknown>>;
    vehicles: Array<Record<string, unknown>>;
  };
  const alicia = workspace.customers.find((customer) => customer.id === "CUST-UAT-001")!;
  expect(alicia).toMatchObject({
    nameSourceValue: "Alicia Bennett",
    nameZh: "艾丽西亚·贝内特",
    nameEn: "Alicia Bennett",
    phone: "+18765550101",
  });
  for (const key of [
    "source", "recentBusiness", "recentBusinessDate", "activeBusinessCount", "tags", "contacts",
    "riskNote", "riskLevel", "orders", "paymentSummary", "licensePhotoUrl", "profileCompleteness",
  ]) expect(alicia).not.toHaveProperty(key);
  const vehicle = workspace.vehicles.find((entry) => entry.id === "VEH-UAT-001")!;
  for (const key of ["recentService", "recentServiceDate", "linkedOrderCount", "totalAmount", "unpaidAmount", "serviceHistory"])
    expect(vehicle).not.toHaveProperty(key);
});

const superadmin = { actorId: "emp-001", role: "superadmin" };
const frontdeskAdmin = { actorId: "emp-003", role: "frontdesk_admin" };

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==";
const PDF_DATA_URL = "data:application/pdf;base64,JVBERi0xLjQK";

function verificationAsset(
  id: string,
  overrides: Partial<EvidenceAsset> = {},
): EvidenceAsset {
  return {
    id,
    fileName: `${id}.png`,
    url: PNG_DATA_URL,
    mimeType: "image/png",
    sizeBytes: 70,
    createdAt: "2026-08-13T12:00:00.000Z",
    createdBy: superadmin.actorId,
    ...overrides,
  };
}

function signedPdfAsset(id: string): EvidenceAsset {
  return verificationAsset(id, {
    fileName: `${id}.pdf`,
    url: PDF_DATA_URL,
    mimeType: "application/pdf",
    sizeBytes: 9,
  });
}

function expectStoreCode(operation: () => unknown, code: string, status = 400): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code, status });
}

function memoryStorage() {
  return {
    saved: null as string | null,
    writes: 0,
    failWrites: false,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) {
      if (this.failWrites) throw new Error("磁盘写入失败");
      this.writes += 1;
      this.saved = value;
    },
  };
}

type AgreementSigningPreview = { readonly token: string; readonly signedAt: string };
type AgreementSigningPreviewStore = ReturnType<typeof createMockCustomerVehicleStore> & {
  prepareCustomerAgreementSigning(
    access: { readonly actorId: string; readonly role: string },
    customerId: string,
    input: { readonly version: string; readonly signedBy: string },
  ): AgreementSigningPreview;
};

function agreementSigningStore(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
): AgreementSigningPreviewStore {
  return store as AgreementSigningPreviewStore;
}

function previewNewCustomer(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  access: typeof superadmin,
  input: Omit<CustomerDraftInput, "nameTransliterationToken"> & { nameSourceValue: string },
) {
  const name = store.previewCustomerName(access, input.nameSourceValue);
  return store.previewCustomer(access, { ...input, nameTransliterationToken: name.confirmationToken });
}

function editableCustomer(customer: CustomerRecord): CustomerDraftInput {
  return {
    customerType: customer.customerType,
    nameSourceValue: customer.nameSourceValue,
    organizationName: customer.organizationName,
    primaryContactRole: customer.primaryContactRole,
    salutation: customer.salutation,
    language: customer.language,
    primaryPhone: customer.phone,
    secondaryPhone: customer.secondaryPhone,
    whatsapp: customer.whatsapp,
    email: customer.email,
    preferredChannel: customer.preferredChannel,
    address: customer.address,
    gender: customer.gender,
    birthDate: customer.birthDate,
    trn: customer.trn,
    status: customer.status,
  };
}

function editableVehicle(vehicle: VehicleRecord): VehicleDraftInput {
  return {
    plate: vehicle.plate,
    vin: vehicle.vin,
    engineNumber: vehicle.engineNumber,
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    year: vehicle.year,
    color: vehicle.color,
    powertrain: vehicle.powertrain,
    bodyType: vehicle.bodyType,
    seating: vehicle.seating,
    ccRating: vehicle.ccRating,
    fuelType: vehicle.fuelType,
    mileage: vehicle.mileage,
    mileageUnit: vehicle.mileageUnit,
    mileageRecordedAt: vehicle.mileageRecordedAt,
    usage: vehicle.usage,
    specialNotes: vehicle.specialNotes,
    status: vehicle.status,
  };
}

function updateCustomerWithPreview(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  access: typeof superadmin,
  customerId: string,
  input: PreviewCustomerUpdateInput,
) {
  const preview = store.previewCustomerUpdate(access, customerId, input);
  return store.updateCustomer(access, customerId, {
    ...preview.input,
    expectedRevision: input.expectedRevision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: preview.candidates.length > 0 ? true : undefined,
  });
}

function updateVehicleWithPreview(
  store: ReturnType<typeof createMockCustomerVehicleStore>,
  access: typeof superadmin,
  vehicleId: string,
  input: PreviewVehicleUpdateInput,
) {
  const preview = store.previewVehicleUpdate(access, vehicleId, input);
  return store.updateVehicle(access, vehicleId, {
    ...preview.input,
    expectedRevision: input.expectedRevision,
    previewToken: preview.previewToken,
  });
}

function mutationAudits(store: ReturnType<typeof createMockCustomerVehicleStore>) {
  return store.audits(superadmin).filter((event) => event.eventType !== "migration");
}

test("Synthetic UAT 种子返回固定汇总、稳定 ID 和独立克隆", () => {
  const store = createMockCustomerVehicleStore();
  const first = store.workspace(superadmin);
  const second = createMockCustomerVehicleStore().workspace(superadmin);

  expect(first.sourceRevision).toBe(1);
  expect(first.summary).toEqual({
    totalCustomers: 300,
    activeCustomers: 254,
    totalVehicles: 324,
    activeVehicles: 75,
    activeRelationships: 324,
  });
  expect(first.customers.slice(0, 4).map((customer) => customer.id)).toEqual([
    "CUST-UAT-001",
    "CUST-UAT-002",
    "CUST-UAT-003",
    "CUST-UAT-004",
  ]);
  expect(first.vehicles.slice(0, 4).map((vehicle) => vehicle.id)).toEqual([
    "VEH-UAT-001",
    "VEH-UAT-002",
    "VEH-UAT-003",
    "VEH-UAT-004",
  ]);
  expect(first.relationships.slice(0, 6).map((relationship) => relationship.id)).toEqual([
    "REL-UAT-001",
    "REL-UAT-002",
    "REL-UAT-003",
    "REL-UAT-004",
    "REL-UAT-005",
    "REL-UAT-006",
  ]);
  expect(second).toEqual(first);

  (first.customers[0] as unknown as { nameEn: string }).nameEn = "mutated only in caller";
  first.vehicles[0].plate = "mutated only in caller";
  expect(store.workspace(superadmin).customers[0].nameEn).toBe("Alicia Bennett");
  expect(store.workspace(superadmin).vehicles[0].plate).toBe("7012 AB");
});

test("每条客户车辆关系均可跨引用，且历史关系保留起止时间", () => {
  const workspace = createMockCustomerVehicleStore().workspace(superadmin);
  const customerIds = new Set(workspace.customers.map((customer) => customer.id));
  const vehicleIds = new Set(workspace.vehicles.map((vehicle) => vehicle.id));

  for (const relationship of workspace.relationships) {
    expect(customerIds.has(relationship.customerId)).toBe(true);
    expect(vehicleIds.has(relationship.vehicleId)).toBe(true);
    expect(relationship.startedAt).toMatch(/^202\d-\d\d-\d\dT/);
    if (relationship.endedAt !== null) {
      expect(relationship.endedAt >= relationship.startedAt).toBe(true);
    }
  }
  expect(workspace.relationships.find((relationship) => relationship.id === "REL-UAT-003"))
    .toEqual(expect.objectContaining({
      vehicleId: "VEH-UAT-003",
      customerId: "CUST-UAT-003",
      startedAt: "2025-02-01T09:00:00.000Z",
      endedAt: "2026-01-31T18:00:00.000Z",
    }));
});

test("固定种子每辆车最多一个当前客户并保留换绑历史", () => {
  const workspace = createMockCustomerVehicleStore().workspace(superadmin);
  const vehicleRelationships = workspace.relationships
    .filter((relationship) => relationship.vehicleId === "VEH-UAT-003");

  expect(vehicleRelationships.filter((relationship) => relationship.endedAt === null)).toEqual([
    expect.objectContaining({ id: "REL-UAT-005", customerId: "CUST-UAT-002" }),
  ]);
  expect(vehicleRelationships.find((relationship) => relationship.id === "REL-UAT-004")).toEqual(
    expect.objectContaining({
      customerId: "CUST-UAT-001",
      endedAt: "2026-07-01T00:00:00.000Z",
    }),
  );
});

test("车辆预览拒绝绕过 UI 提交多个当前客户", () => {
  const store = createMockCustomerVehicleStore();

  expect(() => store.previewVehicle(superadmin, {
    make: "Honda",
    model: "Fit",
    year: 2025,
    relationships: [
      { customerId: "CUST-UAT-001", startedAt: "2026-08-10T09:00:00.000Z", endedAt: null },
      { customerId: "CUST-UAT-002", startedAt: "2026-08-10T09:00:00.000Z", endedAt: null },
    ],
  })).toThrow("一辆车只能绑定一个当前客户");
});

test("客户搜索覆盖姓名、机构、联系方式和关联车牌", () => {
  const workspace = createMockCustomerVehicleStore().workspace(superadmin);

  expect(searchCustomers(workspace, "alicia").map((customer) => customer.id))
    .toContain("CUST-UAT-001");
  expect(searchCustomers(workspace, "north coast").map((customer) => customer.id))
    .toEqual(["CUST-UAT-002"]);
  expect(searchCustomers(workspace, "555 0102").map((customer) => customer.id))
    .toContain("CUST-UAT-002");
  expect(searchCustomers(workspace, "+18765550102").map((customer) => customer.id))
    .toContain("CUST-UAT-002");
  expect(searchCustomers(workspace, "alicia.bennett@synthetic.example").map((customer) => customer.id))
    .toEqual(["CUST-UAT-001"]);
  expect(searchCustomers(workspace, "9154 dz").map((customer) => customer.id))
    .toEqual(["CUST-UAT-001", "CUST-UAT-002", "CUST-UAT-003"]);
  expect(searchCustomers(workspace, "rel-uat-004").map((customer) => customer.id))
    .toEqual(["CUST-UAT-001"]);
});

test("车辆搜索覆盖车牌、VIN、品牌车型及关联客户和电话", () => {
  const workspace = createMockCustomerVehicleStore().workspace(superadmin);

  expect(searchVehicles(workspace, "7012 ab").map((vehicle) => vehicle.id))
    .toContain("VEH-UAT-001");
  expect(searchVehicles(workspace, "1hgbh41jxmn100003").map((vehicle) => vehicle.id))
    .toEqual(["VEH-UAT-003"]);
  expect(searchVehicles(workspace, "Honda CR-V").map((vehicle) => vehicle.id))
    .toContain("VEH-UAT-001");
  expect(searchVehicles(workspace, "North Coast").map((vehicle) => vehicle.id))
    .toEqual(["VEH-UAT-002", "VEH-UAT-003"]);
  expect(searchVehicles(workspace, "555 0102").map((vehicle) => vehicle.id))
    .toEqual(expect.arrayContaining(["VEH-UAT-002", "VEH-UAT-003"]));
  expect(searchVehicles(workspace, "rel-uat-004").map((vehicle) => vehicle.id))
    .toEqual(["VEH-UAT-003"]);
});

test("客户写入边界拒绝个人客户伪造的企业分支字段", () => {
  const store = createMockCustomerVehicleStore();
  const name = store.previewCustomerName(superadmin, "陈志远");
  let caught: unknown;
  try {
    store.previewCustomer(superadmin, {
      customerType: "individual",
      nameSourceValue: "陈志远",
      nameTransliterationToken: name.confirmationToken,
      organizationName: "Hidden Fleet Ltd",
      primaryContactRole: "Hidden manager",
      primaryPhone: "+18765550994",
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code: "CUSTOMER_TYPE_FIELDS_INVALID", status: 400 });
  expect(String(caught)).not.toContain("Hidden Fleet Ltd");

  expect(() => store.previewCustomer(superadmin, {
    customerType: "organization",
    nameSourceValue: "陈志远",
    nameTransliterationToken: name.confirmationToken,
    primaryPhone: "+18765550994",
  })).toThrow("机构名必填");
});

test("客户保存原因不得携带伪装 data URL，且错误不回显敏感内容", () => {
  const storage = {
    saved: null as string | null,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.saved = value; },
  };
  const store = createMockCustomerVehicleStore({ storage });
  const customer = store.customer(superadmin, "CUST-UAT-001");
  const before = store.workspace(superadmin);
  let caught: unknown;
  try {
    store.previewCustomerUpdate(superadmin, customer.id, {
      customerType: "individual",
      nameSourceValue: customer.nameSourceValue,
      primaryPhone: customer.phone,
      reason: "Manager approved | \n data : image/png;base64,DO_NOT_ECHO",
      expectedRevision: customer.revision,
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code: "CUSTOMER_AUDIT_TEXT_INVALID", status: 400 });
  expect(String(caught)).not.toContain("DO_NOT_ECHO");
  expect(storage.saved).toBeNull();
  expect(store.workspace(superadmin)).toEqual(before);
});

test("风险与取消挂账原因不得绕过表单把 data URL 写入 raw", () => {
  const storage = {
    saved: null as string | null,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.saved = value; },
  };
  const store = createMockCustomerVehicleStore({ storage });
  const before = store.workspace(superadmin);
  let riskError: unknown;
  try {
    store.addCustomerRiskFlag(
      superadmin,
      "CUST-UAT-001",
      "attention",
      "Manual review | DATA : image/png;base64,RISK_PRIVATE",
    );
  } catch (error) {
    riskError = error;
  }
  expect(riskError).toMatchObject({ code: "CUSTOMER_AUDIT_TEXT_INVALID", status: 400 });
  expect(String(riskError)).not.toContain("RISK_PRIVATE");
  expect(storage.saved).toBeNull();
  expect(store.workspace(superadmin)).toEqual(before);

  store.grantCustomerCredit(superadmin, "CUST-UAT-001", "Signed at front desk", null, "LiJian");
  const grantedRaw = storage.saved;
  const granted = store.customer(superadmin, "CUST-UAT-001");
  let creditError: unknown;
  try {
    store.revokeCustomerCredit(
      superadmin,
      "CUST-UAT-001",
      "Overdue | \n data:application/pdf;base64,CREDIT_PRIVATE",
      "LiJian",
    );
  } catch (error) {
    creditError = error;
  }
  expect(creditError).toMatchObject({ code: "CUSTOMER_AUDIT_TEXT_INVALID", status: 400 });
  expect(String(creditError)).not.toContain("CREDIT_PRIVATE");
  expect(storage.saved).toBe(grantedRaw);
  expect(store.customer(superadmin, "CUST-UAT-001")).toEqual(granted);
});

test("strict v3 写前验证失败保留 raw、内存 revision 及姓名与重复预览凭据", () => {
  let now = "2000-01-01T00:00:00.000Z";
  const storage = {
    saved: null as string | null,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.saved = value; },
  };
  const store = createMockCustomerVehicleStore({ storage, clock: () => now });
  const before = store.workspace(superadmin);
  const existing = store.customer(superadmin, "CUST-UAT-001");
  const name = store.previewCustomerName(superadmin, "陈志远");
  const preview = store.previewCustomerUpdate(superadmin, existing.id, {
    customerType: "individual",
    nameSourceValue: "陈志远",
    nameTransliterationToken: name.confirmationToken,
    primaryPhone: existing.phone,
    expectedRevision: existing.revision,
  });
  const input = {
    ...preview.input,
    expectedRevision: existing.revision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: preview.candidates.length > 0 ? true : undefined,
  };

  let caught: unknown;
  try {
    store.updateCustomer(superadmin, existing.id, input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code: "CUSTOMER_VEHICLE_STATE_INVALID", status: 500 });
  expect(storage.saved).toBeNull();
  expect(store.workspace(superadmin)).toEqual(before);
  expect(store.customer(superadmin, existing.id).revision).toBe(existing.revision);

  now = "2026-08-13T12:00:00.000Z";
  const saved = store.updateCustomer(superadmin, existing.id, input);
  expect(saved).toMatchObject({ nameZh: "陈志远", nameEn: "Chen Zhiyuan", revision: existing.revision + 1 });
  expect(storage.saved).not.toBeNull();
});

test("完整目录读取只允许超级管理员和前台管理员", () => {
  const store = createMockCustomerVehicleStore();

  for (const access of [superadmin, frontdeskAdmin]) {
    expect(store.workspace(access).customers.length).toBe(300);
    expect(store.customer(access, "CUST-UAT-001").email).toBe("alicia.bennett@synthetic.example");
    expect(store.vehicle(access, "VEH-UAT-003").vin).toBe("1HGBH41JXMN100003");
  }
});

test("拒绝的完整目录读取在披露任何种子字段前失败", () => {
  const store = createMockCustomerVehicleStore();
  const deniedAccesses = [
    undefined,
    { actorId: "emp-004", role: "parts" },
    { actorId: "emp-005", role: "mechanic" },
  ];

  for (const access of deniedAccesses) {
    for (const read of [
      () => store.workspace(access),
      () => store.customer(access, "CUST-UAT-001"),
      () => store.vehicle(access, "VEH-UAT-003"),
    ]) {
      try {
        read();
        throw new Error("denied read unexpectedly returned a seed response");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toMatch(/^403 无权读取客户与车辆完整目录$/);
        expect(message).not.toMatch(/Alicia|0101|1HGBH41JXMN100003|风险|金额/);
      }
    }
  }

  for (const read of [
    () => store.workspace({ actorId: "broken", role: "" }),
    () => store.customer({ actorId: "broken", role: "" }, "CUST-UAT-001"),
    () => store.vehicle({ actorId: "broken", role: "" }, "VEH-UAT-003"),
  ]) {
    expect(read).toThrow(/^401 无效会话$/);
  }
});

test("客户预览规范化可选联系渠道，并仅返回非手机号重复候选", () => {
  const store = createMockCustomerVehicleStore();

  const preview = previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "  Alicia Bennett  ",
    primaryPhone: "+1 (876) 555-0997",
    whatsapp: " +1 876 555 0997 ",
    email: " ALICIA.BENNETT@SYNTHETIC.EXAMPLE ",
  });

  expect(preview.input).toMatchObject({
    customerType: "individual",
    nameSourceValue: "Alicia Bennett",
    organizationName: null,
    primaryPhone: "+18765550997",
    whatsapp: "+18765550997",
    email: "alicia.bennett@synthetic.example",
    status: "active",
    reason: null,
  });
  expect(preview.candidates).toEqual(expect.arrayContaining([{
    customerId: "CUST-UAT-001",
    reasons: ["email", "nameZh", "nameEn"],
  }]));
  expect(previewNewCustomer(store, superadmin, {
    customerType: "organization",
    nameSourceValue: "Dwayne Clarke",
    organizationName: "  NORTH COAST LOGISTICS LTD ",
    primaryPhone: "+18765550999",
  }).candidates).toEqual(expect.arrayContaining([{
    customerId: "CUST-UAT-002",
    reasons: ["nameZh", "nameEn", "organizationName"],
  }]));
  expect(preview.sourceRevision).toBe(1);
  expect(preview.previewToken).toBe("customer-preview-1");
});

test("组织客户也必须登记并确认唯一主要联系人，个人客户同样必须填写姓名", () => {
  const store = createMockCustomerVehicleStore();

  expect(() => store.previewCustomer(superadmin, {
    customerType: "individual",
    nameSourceValue: " ",
    email: "individual@example.test",
  })).toThrow("客户姓名必填");

  expect(() => store.previewCustomer(superadmin, {
    customerType: "organization",
    organizationName: "  Portside Imports Ltd  ",
    primaryPhone: "+1 876 000 0043",
    email: " BILLING@PORTSIDE.EXAMPLE.TEST ",
  })).toThrow("主要联系人姓名必填");

  const preview = previewNewCustomer(store, superadmin, {
    customerType: "organization",
    organizationName: "  Portside Imports Ltd  ",
    nameSourceValue: "赵明轩",
    primaryContactRole: "Fleet manager",
    primaryPhone: "+1 876 000 0043",
    email: " BILLING@PORTSIDE.EXAMPLE.TEST ",
  });
  expect(preview.input).toMatchObject({
    customerType: "organization",
    nameSourceValue: "赵明轩",
    organizationName: "Portside Imports Ltd",
    primaryPhone: "+18760000043",
    whatsapp: null,
    email: "billing@portside.example.test",
    status: "active",
    reason: null,
  });
  const created = store.createCustomer(superadmin, { ...preview.input, previewToken: preview.previewToken });
  expect(created).toEqual(expect.objectContaining({
    customerType: "organization",
    nameZh: "赵明轩",
    nameEn: "Zhao Mingxuan",
    primaryContactRole: "Fleet manager",
    organizationName: "Portside Imports Ltd",
    email: "billing@portside.example.test",
    phone: "+18760000043",
    revision: 1,
  }));
  expect(updateCustomerWithPreview(store, superadmin, created.id, {
    customerType: "organization",
    organizationName: "Portside Imports Ltd",
    primaryPhone: "+1 876 000 0043",
    email: "billing@portside.example.test",
    expectedRevision: 1,
  })).toEqual(created);
  expect(mutationAudits(store)).toHaveLength(1);
});

test("手机号必填（2026-08-17）：主要手机号留空不可建档，OTP 未验不阻塞且留提醒事实", () => {
  const cases = [
    {
      customerType: "individual" as const,
      nameSourceValue: "陈志远",
      expectedName: "陈志远 / Chen Zhiyuan",
    },
    {
      customerType: "organization" as const,
      organizationName: "Harbour No Contact Ltd",
      nameSourceValue: "赵明轩",
      expectedName: "Harbour No Contact Ltd",
    },
  ];

  for (const [index, input] of cases.entries()) {
    const store = createMockCustomerVehicleStore();
    const { expectedName, ...draft } = input;
    // 硬规则：主要手机号留空 → 400
    expect(() => previewNewCustomer(store, superadmin, {
      ...draft,
      primaryPhone: " ",
      secondaryPhone: null,
      whatsapp: "",
      email: null,
    })).toThrow("客户必须填写主要手机号（OTP 可稍后补验）");

    // 有手机号即可建档；OTP 未验证只留提醒事实
    const preview = previewNewCustomer(store, superadmin, {
      ...draft,
      primaryPhone: "+1 876 000 0050",
      secondaryPhone: null,
      whatsapp: "",
      email: null,
    });
    expect(preview.input).toMatchObject({
      primaryPhone: "+18760000050",
      secondaryPhone: null,
      whatsapp: null,
      email: null,
    });
    const created = store.createCustomer(superadmin, {
      ...preview.input,
      previewToken: preview.previewToken,
    });
    expect(created).toMatchObject({
      phone: "+18760000050",
      secondaryPhone: null,
      whatsapp: null,
      email: null,
    });
    expect(customerDisplayNameV3(created), `case ${index}`).toBe(expectedName);
    expect(deriveProfileCompleteness(created), `case ${index}`).toBe("complete");
    expect(deriveOtpVerification(created.verificationArchive, created.phone), `case ${index}`)
      .toEqual({ status: "unverified" });
  }
});

test("手机号跨客户冲突是不可确认覆盖的硬错误且不会进入软候选", () => {
  const store = createMockCustomerVehicleStore();
  expectStoreCode(() => previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "周雅雯",
    primaryPhone: "+18765550103",
  }), "CUSTOMER_PHONE_DUPLICATE", 409);

  expectStoreCode(() => previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "林浩然",
    primaryPhone: "+1 876 000 0051",
    whatsapp: "+1 876 555 0102",
  }), "CUSTOMER_PHONE_DUPLICATE", 409);
});

test("客户创建保留非手机号重复警告但无需确认，并仍绑定操作者、内容和一次性凭证", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const preview = previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "Alicia Bennett",
    primaryPhone: "+18765550931",
    email: "alicia.bennett@synthetic.example",
  });
  const save = { ...preview.input, previewToken: preview.previewToken };

  expect(preview.candidates.length).toBeGreaterThan(0);
  expect(preview.candidates.flatMap((candidate) => candidate.reasons)).toEqual(
    expect.arrayContaining(["nameZh", "nameEn", "email"]),
  );
  expect(preview.candidates.flatMap((candidate) => candidate.reasons))
    .not.toEqual(expect.arrayContaining(["phone", "whatsapp"]));
  expect(() => store.createCustomer(superadmin, {
    ...save,
    nameSourceValue: "艾丽西亚·贝内特",
  })).toThrow(/客户姓名确认已失效|预览内容已变化/);
  expect(() => store.createCustomer(frontdeskAdmin, {
    ...save,
  })).toThrow("预览操作者不一致，请重新预览");

  const created = store.createCustomer(superadmin, save);
  expect(created).toMatchObject({
    id: "CUST-UAT-301",
    customerType: "individual",
    nameZh: "艾丽西亚·贝内特",
    nameEn: "Alicia Bennett",
    organizationName: null,
    phone: "+18765550931",
    whatsapp: null,
    email: "alicia.bennett@synthetic.example",
    status: "active",
    revision: 1,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  expect(storage.saved).not.toBeNull();
  expect(isCustomerEnvelopeV3(JSON.parse(storage.saved!))).toBe(true);
  const reloaded = createMockCustomerVehicleStore({ storage });
  const createdAudit = reloaded.customerAuditHistory(superadmin, created.id)
    .find((event) => event.eventType === "customer_created");
  expect(createdAudit?.changes).toEqual(expect.arrayContaining([
    {
      field: "duplicateCandidateCustomerIds",
      before: null,
      after: [...new Set(preview.candidates.map((candidate) => candidate.customerId))].sort().join(","),
    },
    {
      field: "duplicateCandidateReasons",
      before: null,
      after: [...new Set(preview.candidates.flatMap((candidate) => candidate.reasons))].sort().join(","),
    },
  ]));
  expect(() => store.createCustomer(superadmin, {
    ...save,
  })).toThrow("请先预览或预览凭证无效，请重新预览");
});

test("新预览在源数据并发变化后失效", () => {
  const store = createMockCustomerVehicleStore();
  const stalePreview = previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "唐思远",
    primaryPhone: "+18765550999",
  });
  const freshPreview = previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "吴静怡",
    primaryPhone: "+18765550998",
  });

  store.createCustomer(superadmin, { ...freshPreview.input, previewToken: freshPreview.previewToken });
  expect(() => store.createCustomer(superadmin, {
    ...stalePreview.input,
    previewToken: stalePreview.previewToken,
  })).toThrow("源数据已变化，请重新预览");
});

test("客户更新以 expectedRevision 防并发，允许维护停用客户，审计完整且同值更新不产生写入", () => {
  const store = createMockCustomerVehicleStore();
  const before = store.customer(superadmin, "CUST-UAT-004");
  const updated = updateCustomerWithPreview(store, superadmin, "CUST-UAT-004", {
    customerType: "organization",
    nameSourceValue: " Rochelle Grant ",
    organizationName: " Seaview Villas Group ",
    primaryPhone: "+1 (876) 555-0199",
    whatsapp: null,
    email: " FRONTDESK@SEAVIEW.SYNTHETIC.EXAMPLE ",
    status: "inactive",
    reason: "补充前台联系电话",
    expectedRevision: 1,
  });

  expect(updated).toEqual({
    ...before,
    phone: "+18765550199",
    email: "frontdesk@seaview.synthetic.example",
    revision: 2,
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  expect(mutationAudits(store)).toEqual([{
    id: "audit-customer-2",
    customerId: "CUST-UAT-004",
    eventType: "customer_updated",
    actorId: "emp-001",
    occurredAt: "2026-08-09T00:00:00.000Z",
    reason: "补充前台联系电话",
    summary: "更新客户",
    changes: expect.arrayContaining([
      { field: "phone", before: "+18765550104", after: "+18765550199" },
    ]),
    evidenceAssetIds: [],
  }]);
  expect(updateCustomerWithPreview(store, superadmin, "CUST-UAT-004", {
    customerType: "organization",
    nameSourceValue: "Rochelle Grant",
    organizationName: "Seaview Villas Group",
    primaryPhone: "+18765550199",
    whatsapp: null,
    email: "frontdesk@seaview.synthetic.example",
    status: "inactive",
    reason: "ignored for no-op",
    expectedRevision: 2,
  })).toEqual(updated);
  expect(mutationAudits(store)).toHaveLength(1);
  expect(store.workspace(superadmin).sourceRevision).toBe(2);
  expect(() => updateCustomerWithPreview(store, superadmin, "CUST-UAT-004", {
    customerType: "organization",
    nameSourceValue: "Rochelle Grant",
    organizationName: "Seaview Villas Group",
    primaryPhone: "+18765550199",
    whatsapp: null,
    email: "frontdesk@seaview.synthetic.example",
    status: "active",
    expectedRevision: 1,
  })).toThrow("客户版本已变化，请重新加载");
  expect(() => updateCustomerWithPreview(store, superadmin, "CUST-UAT-404", {
    customerType: "individual", nameSourceValue: "陈志远", primaryPhone: "+18765550197", expectedRevision: 1,
  })).toThrow("客户不存在");
});

test("持久化失败不改变内存、revision、审计或可重试预览，成功后重载恢复", () => {
  const storage = {
    saved: null as string | null,
    failWrites: false,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) {
      if (this.failWrites) throw new Error("磁盘写入失败");
      this.saved = value;
    },
  };
  const store = createMockCustomerVehicleStore({ storage });
  const preview = previewNewCustomer(store, superadmin, {
    customerType: "organization",
    nameSourceValue: "孙可欣",
    organizationName: "Harbour Glass Ltd",
    primaryPhone: "+18765550996",
    reason: "新建 UAT 客户",
  });
  const before = store.workspace(superadmin);

  storage.failWrites = true;
  expect(() => store.createCustomer(superadmin, { ...preview.input, previewToken: preview.previewToken }))
    .toThrow("磁盘写入失败");
  expect(store.workspace(superadmin)).toEqual(before);
  expect(mutationAudits(store)).toEqual([]);

  storage.failWrites = false;
  store.createCustomer(superadmin, { ...preview.input, previewToken: preview.previewToken });
  const reloaded = createMockCustomerVehicleStore({ storage });
  expect(reloaded.customer(superadmin, "CUST-UAT-301")).toEqual(expect.objectContaining({
    nameZh: "孙可欣",
    nameEn: "Sun Kexin",
    organizationName: "Harbour Glass Ltd",
    phone: "+18765550996",
  }));
  expect(mutationAudits(reloaded)).toEqual([expect.objectContaining({
    eventType: "customer_created",
    actorId: "emp-001",
    reason: "新建 UAT 客户",
  })]);
  expect(() => store.createCustomer(superadmin, { ...preview.input, previewToken: preview.previewToken }))
    .toThrow("请先预览或预览凭证无效，请重新预览");
});

test("mutation 遇到并发损坏的非空持久化值时 fail closed 且保留预览供原路径重试", () => {
  const storage = {
    saved: null as string | null,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.saved = value; },
  };
  const store = createMockCustomerVehicleStore({ storage });
  const before = store.workspace(superadmin);
  const preview = previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "沈佳怡",
    primaryPhone: "+18765550995",
  });

  storage.saved = "{concurrent-corruption";
  expect(() => store.createCustomer(superadmin, {
    ...preview.input,
    previewToken: preview.previewToken,
  })).toThrow("持久化客户与车辆数据不符合 schema v3");
  expect(store.workspace(superadmin)).toEqual(before);
  expect(storage.saved).toBe("{concurrent-corruption");

  storage.saved = null;
  expect(store.createCustomer(superadmin, {
    ...preview.input,
    previewToken: preview.previewToken,
  })).toMatchObject({ nameZh: "沈佳怡", nameEn: "Shen Jiayi", revision: 1 });
});

test("客户写入口在读取种子前拒绝没有完整目录权限的会话", () => {
  const store = createMockCustomerVehicleStore();
  const denied = { actorId: "emp-004", role: "parts" };
  const draft = { customerType: "individual" as const, nameSourceValue: "陈志远", primaryPhone: "+18765550195" };

  expect(() => store.previewCustomer(denied, draft)).toThrow(/^403 无权读取客户与车辆完整目录$/);
  expect(() => store.createCustomer(denied, { ...draft, previewToken: "customer-preview-never" }))
    .toThrow(/^403 无权读取客户与车辆完整目录$/);
  expect(() => store.updateCustomer(denied, "CUST-UAT-001", { ...draft, expectedRevision: 1, previewToken: "forged" }))
    .toThrow(/^403 无权读取客户与车辆完整目录$/);
});

test("车辆预览规范化非空车牌，空车牌草稿可保存，重复车牌绝不能确认绕过", () => {
  const store = createMockCustomerVehicleStore();
  const draft = {
    plate: " ab 123 ",
    vin: "1HGBH41JXMN100001",
    make: " Toyota ",
    model: " Aqua ",
    year: 2018,
    relationships: [{
      customerId: "CUST-UAT-001",
      startedAt: "2026-08-09T00:00:00.000Z",
      endedAt: null,
    }],
  };

  const preview = store.previewVehicle(superadmin, draft);
  expect(preview).toMatchObject({
    input: {
      plate: "AB123",
      vin: "1HGBH41JXMN100001",
      make: "Toyota",
      model: "Aqua",
      year: 2018,
      status: "off_site",
      reason: null,
      relationships: [{
        relationshipId: null,
        customerId: "CUST-UAT-001",
        startedAt: "2026-08-09T00:00:00.000Z",
        endedAt: null,
      }],
    },
    existingVehicleId: null,
    canSave: true,
    sourceRevision: 1,
    previewToken: "vehicle-preview-1",
  });

  const blankPlatePreview = store.previewVehicle(superadmin, {
    ...draft,
    plate: null,
  });
  expect(blankPlatePreview.input.plate).toBeNull();
  expect(blankPlatePreview.canSave).toBe(true);
  expect(store.createVehicle(superadmin, {
    ...blankPlatePreview.input,
    previewToken: blankPlatePreview.previewToken,
  })).toEqual(expect.objectContaining({ plate: "", vin: "1HGBH41JXMN100001" }));

  const duplicate = store.previewVehicle(superadmin, {
    ...draft,
    plate: " 7012 ab ",
  });
  expect(duplicate).toEqual(expect.objectContaining({
    input: expect.objectContaining({ plate: "7012AB" }),
    existingVehicleId: "VEH-UAT-001",
    canSave: false,
  }));
  const attemptedDuplicateBypass = {
    ...duplicate.input,
    previewToken: duplicate.previewToken,
    confirmPossibleDuplicate: true,
  };
  expect(() => store.createVehicle(superadmin, attemptedDuplicateBypass)).toThrow("车牌已存在，不能重复建档");

  expect(() => store.previewVehicle(superadmin, { ...draft, make: " " })).toThrow("车辆品牌必填");
  expect(() => store.previewVehicle(superadmin, { ...draft, model: " " })).toThrow("车辆车型必填");
  expect(() => store.previewVehicle(superadmin, {
    ...draft,
    relationships: [{ ...draft.relationships[0], customerId: "CUST-UAT-404" }],
  })).toThrow("关联客户不存在");
});

test("车辆创建要求同一操作者的未篡改预览，成功后仅消费一次且并发变化使预览失效", () => {
  const store = createMockCustomerVehicleStore();
  const draft = {
    plate: "KX 721",
    vin: "VIN-SHARED-BY-DESIGN",
    make: "Honda",
    model: "Fit",
    year: 2017,
    relationships: [{ customerId: "CUST-UAT-001", startedAt: "2026-08-09T00:00:00.000Z", endedAt: null }],
  };
  const preview = store.previewVehicle(superadmin, draft);

  expect(() => store.createVehicle(frontdeskAdmin, {
    ...preview.input,
    previewToken: preview.previewToken,
  })).toThrow("预览操作者不一致，请重新预览");
  expect(() => store.createVehicle(superadmin, {
    ...preview.input,
    make: "Tampered",
    previewToken: preview.previewToken,
  })).toThrow("预览内容已变化，请重新预览");

  const created = store.createVehicle(superadmin, {
    ...preview.input,
    previewToken: preview.previewToken,
  });
  expect(created).toEqual(expect.objectContaining({
    id: "VEH-UAT-325",
    plate: "KX721",
    vin: "VIN-SHARED-BY-DESIGN",
    revision: 1,
  }));
  expect(store.workspace(superadmin).relationships.find((relationship) => relationship.vehicleId === created.id))
    .toEqual(expect.objectContaining({
      id: "REL-UAT-327",
      customerId: "CUST-UAT-001",
      endedAt: null,
    }));
  expect(() => store.createVehicle(superadmin, {
    ...preview.input,
    previewToken: preview.previewToken,
  })).toThrow("请先预览或预览凭证无效，请重新预览");

  const stale = store.previewVehicle(superadmin, { ...draft, plate: "KX 722" });
  const fresh = store.previewVehicle(superadmin, { ...draft, plate: "KX 723" });
  store.createVehicle(superadmin, { ...fresh.input, previewToken: fresh.previewToken });
  expect(() => store.createVehicle(superadmin, { ...stale.input, previewToken: stale.previewToken }))
    .toThrow("源数据已变化，请重新预览");
});

test("车辆换绑客户时只保留一个当前关系并保护全部历史", () => {
  const handoverAt = "2026-08-10T09:00:00.000Z";
  const store = createMockCustomerVehicleStore({ clock: () => handoverAt });
  const vehicle = store.vehicle(superadmin, "VEH-UAT-003");
  const beforeRelationships = store.workspace(superadmin).relationships
    .filter((relationship) => relationship.vehicleId === vehicle.id);
  const historicalBefore = beforeRelationships.filter((relationship) => relationship.endedAt !== null);

  const updated = updateVehicleWithPreview(store, superadmin, vehicle.id, {
    plate: vehicle.plate,
    vin: vehicle.vin,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    status: vehicle.status,
    expectedRevision: 1,
    reason: "车辆换绑至历史客户",
    relationships: [
      ...beforeRelationships.map((relationship) => ({
        relationshipId: relationship.id,
        customerId: relationship.customerId,
        startedAt: relationship.startedAt,
        endedAt: relationship.endedAt === null ? handoverAt : relationship.endedAt,
      })),
      {
        customerId: "CUST-UAT-003",
        startedAt: handoverAt,
        endedAt: null,
      },
    ],
  });
  expect(updated).toEqual(expect.objectContaining({ revision: 2 }));
  const relationshipsAfterUpdate = store.workspace(superadmin).relationships
    .filter((relationship) => relationship.vehicleId === vehicle.id);
  expect(relationshipsAfterUpdate.filter((relationship) => relationship.endedAt === null)).toEqual([
    expect.objectContaining({ customerId: "CUST-UAT-003", startedAt: handoverAt }),
  ]);
  expect(relationshipsAfterUpdate).toEqual(expect.arrayContaining([
    expect.objectContaining({ customerId: "CUST-UAT-002", endedAt: handoverAt }),
  ]));
  for (const historical of historicalBefore) {
    expect(relationshipsAfterUpdate.find((relationship) => relationship.id === historical.id)).toEqual(historical);
  }
  expect(mutationAudits(store)).toEqual([expect.objectContaining({
    eventType: "vehicle_updated",
    vehicleId: vehicle.id,
    beforeRelationships,
    afterRelationships: relationshipsAfterUpdate,
    reason: "车辆换绑至历史客户",
  })]);

  expect(() => updateVehicleWithPreview(store, superadmin, vehicle.id, {
    plate: vehicle.plate,
    vin: vehicle.vin,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    status: vehicle.status,
    expectedRevision: 2,
    relationships: relationshipsAfterUpdate.map((relationship) => ({
      relationshipId: relationship.id,
      customerId: relationship.customerId,
      startedAt: relationship.startedAt,
      endedAt: relationship.id === "REL-UAT-003" ? "2026-02-01T00:00:00.000Z" : relationship.endedAt,
    })),
  })).toThrow("车辆关联历史不得删除或改写");
});

test("车辆允许清除当前客户但不会删除任何历史关系", () => {
  const clearedAt = "2026-08-10T10:00:00.000Z";
  const store = createMockCustomerVehicleStore({ clock: () => clearedAt });
  const vehicle = store.vehicle(superadmin, "VEH-UAT-004");
  const beforeRelationships = store.workspace(superadmin).relationships
    .filter((relationship) => relationship.vehicleId === vehicle.id);

  updateVehicleWithPreview(store, superadmin, vehicle.id, {
    ...editableVehicle(vehicle),
    expectedRevision: vehicle.revision,
    reason: "车辆暂时无当前客户",
    relationships: beforeRelationships.map((relationship) => ({
      relationshipId: relationship.id,
      customerId: relationship.customerId,
      startedAt: relationship.startedAt,
      endedAt: relationship.endedAt === null ? clearedAt : relationship.endedAt,
    })),
  });

  const afterRelationships = store.workspace(superadmin).relationships
    .filter((relationship) => relationship.vehicleId === vehicle.id);
  expect(afterRelationships).toHaveLength(beforeRelationships.length);
  expect(afterRelationships.filter((relationship) => relationship.endedAt === null)).toEqual([]);
  expect(afterRelationships).toEqual([
    expect.objectContaining({ id: "REL-UAT-006", customerId: "CUST-UAT-004", endedAt: clearedAt }),
  ]);
});

test("车辆更新使用 expectedRevision，no-op 不写 revision 或审计且审计保留 before/after/reason", () => {
  const store = createMockCustomerVehicleStore();
  const before = store.vehicle(superadmin, "VEH-UAT-004");
  const updated = updateVehicleWithPreview(store, superadmin, before.id, {
    plate: " 0317 ev ",
    vin: before.vin,
    make: " Nissan ",
    model: " Versa Note ",
    year: before.year,
    status: before.status,
    expectedRevision: 1,
    reason: "修正车型名称",
  });
  expect(updated).toEqual({
    ...before,
    model: "Versa Note",
    plate: "0317EV",
    revision: 2,
    updatedAt: "2026-08-09T00:00:00.000Z",
  });
  expect(mutationAudits(store)).toEqual([expect.objectContaining({
    eventType: "vehicle_updated",
    vehicleId: before.id,
    actorId: "emp-001",
    reason: "修正车型名称",
    changes: expect.arrayContaining([
      { field: "plate", before: "0317 EV", after: "0317EV" },
      { field: "model", before: "Note", after: "Versa Note" },
    ]),
  })]);
  expect(updateVehicleWithPreview(store, superadmin, before.id, {
    plate: "0317EV",
    vin: before.vin,
    make: "Nissan",
    model: "Versa Note",
    year: before.year,
    status: before.status,
    expectedRevision: 2,
  })).toEqual(updated);
  expect(store.workspace(superadmin).sourceRevision).toBe(2);
  expect(mutationAudits(store)).toHaveLength(1);
  expect(() => updateVehicleWithPreview(store, superadmin, before.id, {
    plate: "0317EV", vin: before.vin, make: "Nissan", model: "Versa", year: before.year,
    expectedRevision: 1,
  })).toThrow("车辆版本已变化，请重新加载");
  expect(() => updateVehicleWithPreview(store, superadmin, "VEH-UAT-404", {
    plate: "NEW", make: "Honda", model: "Fit", year: 2020, expectedRevision: 1,
  })).toThrow("车辆不存在");
});

test("车辆持久化失败完全原子，预览可重试且成功后重载恢复车辆和审计", () => {
  const storage = {
    saved: null as string | null,
    failWrites: false,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) {
      if (this.failWrites) throw new Error("磁盘写入失败");
      this.saved = value;
    },
  };
  const store = createMockCustomerVehicleStore({ storage });
  const preview = store.previewVehicle(superadmin, {
    plate: "RZ 993",
    vin: "VIN-SHARED-BY-DESIGN",
    make: "Suzuki",
    model: "Swift",
    year: 2021,
    reason: "新建 UAT 车辆",
    relationships: [{ customerId: "CUST-UAT-002", startedAt: "2026-08-09T00:00:00.000Z", endedAt: null }],
  });
  const before = store.workspace(superadmin);

  storage.failWrites = true;
  expect(() => store.createVehicle(superadmin, { ...preview.input, previewToken: preview.previewToken }))
    .toThrow("磁盘写入失败");
  expect(store.workspace(superadmin)).toEqual(before);
  expect(mutationAudits(store)).toEqual([]);

  storage.failWrites = false;
  const created = store.createVehicle(superadmin, { ...preview.input, previewToken: preview.previewToken });
  const reloaded = createMockCustomerVehicleStore({ storage });
  expect(reloaded.vehicle(superadmin, created.id)).toEqual(created);
  expect(mutationAudits(reloaded)).toEqual([expect.objectContaining({
      vehicleId: created.id,
      eventType: "vehicle_created",
    actorId: "emp-001",
    reason: "新建 UAT 车辆",
    beforeRelationships: [],
    afterRelationships: [expect.objectContaining({
      vehicleId: created.id,
      customerId: "CUST-UAT-002",
      endedAt: null,
    })],
  })]);
});

test("共享持久化存储的第二个旧 revision 车辆创建被拒绝，不能覆盖首个唯一车牌写入", () => {
  const storage = {
    saved: null as string | null,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.saved = value; },
  };
  const firstStore = createMockCustomerVehicleStore({ storage });
  const secondStore = createMockCustomerVehicleStore({ storage });
  const draft = {
    plate: "MT 801",
    make: "Mazda",
    model: "Demio",
    year: 2020,
    relationships: [{ customerId: "CUST-UAT-001", startedAt: "2026-08-09T00:00:00.000Z", endedAt: null }],
  };
  const firstPreview = firstStore.previewVehicle(superadmin, draft);
  const stalePreview = secondStore.previewVehicle(frontdeskAdmin, draft);

  const firstVehicle = firstStore.createVehicle(superadmin, {
    ...firstPreview.input,
    previewToken: firstPreview.previewToken,
  });
  expect(() => secondStore.createVehicle(frontdeskAdmin, {
    ...stalePreview.input,
    previewToken: stalePreview.previewToken,
  })).toThrow("源数据已变化，请重新预览");

  const reloaded = createMockCustomerVehicleStore({ storage });
  expect(reloaded.vehicle(superadmin, firstVehicle.id)).toEqual(firstVehicle);
  expect(reloaded.workspace(superadmin).vehicles.filter((vehicle) => vehicle.plate === "MT801")).toHaveLength(1);
});

test("客户和车辆详情种子只公开正式资料与仍有真实操作路径的聚合", () => {
  const store = createMockCustomerVehicleStore();
  const customer = store.customer(superadmin, "CUST-UAT-001");
  const vehicle = store.vehicle(superadmin, "VEH-UAT-001");

  expect(customer).toMatchObject({
    salutation: "Ms",
    language: "English",
    preferredChannel: "whatsapp",
    nameZh: "艾丽西亚·贝内特",
    nameEn: "Alicia Bennett",
    phone: "+18765550101",
  });
  expect(customer.notes.map((entry) => entry.id)).toContain("NOTE-UAT-001");
  expect(customer.verificationArchive).toMatchObject({
    evidenceGaps: [],
    otpRecords: [expect.objectContaining({ id: "OTP-UAT-ALICIA-001" })],
    kycRecords: [expect.objectContaining({ id: "KYC-UAT-ALICIA-DL-001" })],
    agreementRecords: [expect.objectContaining({ id: "AGR-UAT-ALICIA-1.3" })],
  });
  for (const removed of ["contacts", "orders", "communications", "tasks", "attachments", "changeHistory", "paymentSummary"])
    expect(customer).not.toHaveProperty(removed);

  expect(vehicle).toMatchObject({
    engineNumber: "ENG-UAT-001",
    variant: "EX",
    color: "Silver",
    powertrain: "Petrol",
    mileage: 84200,
    mileageUnit: "km",
    usage: "Personal",
  });
  expect(vehicle.partsNeeds.map((entry) => entry.id)).toContain("PART-UAT-001");
  expect(vehicle.photos.map((entry) => entry.id)).toContain("PHOTO-UAT-001-REG");
  expect(vehicle.tasks).toEqual([]);
  expect(vehicle.attachments).toEqual([]);
  for (const removed of ["serviceHistory", "changeHistory", "linkedOrderCount", "totalAmount", "unpaidAmount"])
    expect(vehicle).not.toHaveProperty(removed);
});

test("直接 customer/vehicle 读取对全部嵌套字段返回深克隆", () => {
  const store = createMockCustomerVehicleStore();
  const customer = store.customer(superadmin, "CUST-UAT-001");
  const vehicle = store.vehicle(superadmin, "VEH-UAT-001");

  (customer.notes as unknown as Array<{ content: string }>)[0]!.content = "caller-mutated";
  (customer.verificationArchive.otpRecords as unknown as Array<{ phoneE164: string }>)[0]!.phoneE164 = "+18765550000";
  vehicle.photos[0]!.note = "caller-mutated";
  vehicle.partsNeeds[0]!.name = "caller-mutated";

  expect(store.customer(superadmin, customer.id)).toMatchObject({
    notes: [expect.objectContaining({ content: "Prefers morning pickup and WhatsApp confirmation." })],
    verificationArchive: {
      evidenceGaps: [],
      otpRecords: [expect.objectContaining({ id: "OTP-UAT-ALICIA-001", phoneE164: "+18765550101" })],
    },
  });
  expect(store.vehicle(superadmin, vehicle.id)).toMatchObject({
    photos: [expect.objectContaining({ note: "注册证（Registration Certificate）" }), expect.anything(), expect.anything()],
    partsNeeds: [expect.objectContaining({ name: "Timing belt kit" })],
  });
});

test("普通主档编辑保留正式档案聚合并写入 compact scalar audit", () => {
  const store = createMockCustomerVehicleStore();
  const customerBefore = store.customer(superadmin, "CUST-UAT-001");
  const customerPreview = store.previewCustomerUpdate(superadmin, customerBefore.id, {
    ...editableCustomer(customerBefore),
    address: "18 Updated Customer Road, Kingston 8",
    expectedRevision: customerBefore.revision,
  });
  const customerAfter = store.updateCustomer(superadmin, customerBefore.id, {
    ...customerPreview.input,
    expectedRevision: customerBefore.revision,
    previewToken: customerPreview.previewToken,
    confirmPossibleDuplicate: customerPreview.candidates.length > 0 ? true : undefined,
  });
  for (const field of ["riskFlags", "notes", "verificationArchive"] as const) {
    expect(customerAfter[field]).toEqual(customerBefore[field]);
  }

  const vehicleBefore = store.vehicle(superadmin, "VEH-UAT-001");
  const vehiclePreview = store.previewVehicleUpdate(superadmin, vehicleBefore.id, {
    ...editableVehicle(vehicleBefore),
    specialNotes: "Updated master note without touching aggregates.",
    expectedRevision: vehicleBefore.revision,
  });
  const vehicleAfter = store.updateVehicle(superadmin, vehicleBefore.id, {
    ...vehiclePreview.input,
    expectedRevision: vehicleBefore.revision,
    previewToken: vehiclePreview.previewToken,
  });
  for (const field of ["photos", "partsNeeds", "tasks", "attachments"] as const) {
    expect(vehicleAfter[field]).toEqual(vehicleBefore[field]);
  }

  const audits = mutationAudits(store);
  expect(audits[0]).toMatchObject({
    customerId: customerBefore.id,
    eventType: "customer_updated",
    changes: expect.arrayContaining([
      { field: "address", before: customerBefore.address, after: customerAfter.address },
    ]),
  });
  expect(audits[1]).toMatchObject({
    vehicleId: vehicleBefore.id,
    eventType: "vehicle_updated",
    changes: expect.arrayContaining([
      { field: "specialNotes", before: vehicleBefore.specialNotes, after: vehicleAfter.specialNotes },
    ]),
  });
});

test("客户编辑必须使用绑定 update、实体、revision、exact input 及操作者的预览，软候选无需确认", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const before = store.customer(superadmin, "CUST-UAT-004");
  const occupiedEmail = store.customer(superadmin, "CUST-UAT-001").email;
  const draft: PreviewCustomerUpdateInput = {
    ...editableCustomer(before),
    email: occupiedEmail,
    expectedRevision: before.revision,
    reason: "终审客户编辑预览",
  };
  const preview = store.previewCustomerUpdate(superadmin, before.id, draft);

  expect(preview.candidates).toEqual(expect.arrayContaining([expect.objectContaining({ customerId: "CUST-UAT-001" })]));
  expect(preview.candidates.some((candidate) => candidate.customerId === before.id)).toBe(false);
  expect(() => store.updateCustomer(superadmin, before.id, {
    ...preview.input,
    expectedRevision: before.revision,
    previewToken: "forged",
    confirmPossibleDuplicate: true,
  })).toThrow(/预览凭证无效/);
  expect(() => store.updateCustomer(frontdeskAdmin, before.id, {
    ...preview.input,
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: true,
  })).toThrow(/预览操作者不一致/);
  expect(() => store.updateCustomer(superadmin, before.id, {
    ...preview.input,
    organizationName: "Changed after preview",
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: true,
  })).toThrow(/预览内容已变化/);
  expect(() => store.updateCustomer(superadmin, "CUST-UAT-002", {
    ...preview.input,
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: true,
  })).toThrow(/预览实体不一致|客户版本已变化/);
  const updated = store.updateCustomer(superadmin, before.id, {
    ...preview.input,
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
  });
  expect(updated.email).toBe(occupiedEmail);
  expect(storage.saved).not.toBeNull();
  expect(isCustomerEnvelopeV3(JSON.parse(storage.saved!))).toBe(true);
  const reloaded = createMockCustomerVehicleStore({ storage });
  const updatedAudit = reloaded.customerAuditHistory(superadmin, updated.id)
    .find((event) => event.eventType === "customer_updated");
  expect(updatedAudit?.changes).toEqual(expect.arrayContaining([
    {
      field: "duplicateCandidateCustomerIds",
      before: null,
      after: [...new Set(preview.candidates.map((candidate) => candidate.customerId))].sort().join(","),
    },
    {
      field: "duplicateCandidateReasons",
      before: null,
      after: [...new Set(preview.candidates.flatMap((candidate) => candidate.reasons))].sort().join(","),
    },
  ]));
  expect(() => store.updateCustomer(superadmin, before.id, {
    ...preview.input,
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: true,
  })).toThrow(/预览凭证无效|版本已变化/);
});

test("客户编辑的三个来电字段对其他客户三个存量字段执行不可覆盖的九宫格硬查重", () => {
  const incomingFields = ["primaryPhone", "secondaryPhone", "whatsapp"] as const;
  const storedFields = ["phone", "secondaryPhone", "whatsapp"] as const;

  for (const incomingField of incomingFields) {
    for (const storedField of storedFields) {
      const store = createMockCustomerVehicleStore();
      const target = store.customer(superadmin, "CUST-UAT-004");
      const occupied = store.customer(superadmin, "CUST-UAT-001")[storedField];
      expect(occupied, `${storedField} fixture`).toBeTruthy();

      expectStoreCode(() => store.previewCustomerUpdate(superadmin, target.id, {
        ...editableCustomer(target),
        [incomingField]: occupied,
        expectedRevision: target.revision,
      }), "CUSTOMER_PHONE_DUPLICATE", 409);
    }
  }
});

test("客户新建预览的三个来电字段对其他客户三个存量字段执行不可覆盖的九宫格硬查重", () => {
  const incomingFields = ["primaryPhone", "secondaryPhone", "whatsapp"] as const;
  const storedFields = ["phone", "secondaryPhone", "whatsapp"] as const;

  for (const incomingField of incomingFields) {
    for (const storedField of storedFields) {
      const store = createMockCustomerVehicleStore();
      const occupied = store.customer(superadmin, "CUST-UAT-001")[storedField];
      expect(occupied, `${storedField} fixture`).toBeTruthy();

      expectStoreCode(() => previewNewCustomer(store, superadmin, {
        customerType: "individual",
        nameSourceValue: "陈志远",
        // 手机号必填（2026-08-17）：基础主号兜底，冲突字段单独注入
        primaryPhone: incomingField === "primaryPhone" ? occupied : "+1 876 000 0060",
        email: `${incomingField}-${storedField}@phone-grid.example.test`,
        [incomingField]: occupied,
      }), "CUSTOMER_PHONE_DUPLICATE", 409);
    }
  }
});

test("客户最终创建在预览后号码被占用时以手机号硬冲突拒绝并保留预览", () => {
  const store = createMockCustomerVehicleStore();
  const claimedAfterPreview = "+1 876 000 0888";
  const preview = previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "陈志远",
    primaryPhone: claimedAfterPreview,
  });
  const claimant = store.customer(superadmin, "CUST-UAT-003");
  updateCustomerWithPreview(store, superadmin, claimant.id, {
    ...editableCustomer(claimant),
    primaryPhone: claimedAfterPreview,
    expectedRevision: claimant.revision,
  });

  expectStoreCode(() => store.createCustomer(superadmin, {
    ...preview.input,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: true,
  }), "CUSTOMER_PHONE_DUPLICATE", 409);
});

test("同一客户可在自己的三个号码字段内部复用同一个号码", () => {
  const store = createMockCustomerVehicleStore();
  const createdPreview = previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "陈志远",
    primaryPhone: "+18760000939",
  });
  const target = store.createCustomer(superadmin, {
    ...createdPreview.input,
    previewToken: createdPreview.previewToken,
    confirmPossibleDuplicate: true,
  });
  expect(target.phone).toBeTruthy();
  const updated = updateCustomerWithPreview(store, superadmin, target.id, {
    ...editableCustomer(target),
    secondaryPhone: target.phone,
    whatsapp: target.phone,
    expectedRevision: target.revision,
  });
  expect(updated).toMatchObject({
    phone: target.phone,
    secondaryPhone: target.phone,
    whatsapp: target.phone,
  });
});

test("历史重复号码不阻断无关编辑或原主的内部字段复用，也不降级为软候选", () => {
  const store = createMockCustomerVehicleStore();
  const target = store.customer(superadmin, "CUST-UAT-001");
  expect(target.phone).toBe(store.customer(superadmin, "CUST-BULK-001").phone);

  const preview = store.previewCustomerUpdate(superadmin, target.id, {
    ...editableCustomer(target),
    status: "inactive",
    expectedRevision: target.revision,
  });
  const candidateReasons = preview.candidates.flatMap((candidate) => candidate.reasons);
  expect(candidateReasons).not.toContain("phone");
  expect(candidateReasons).not.toContain("whatsapp");

  const updated = store.updateCustomer(superadmin, target.id, {
    ...preview.input,
    expectedRevision: target.revision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: preview.candidates.length > 0 ? true : undefined,
  });
  expect(updated.status).toBe("inactive");
  expect(updated.phone).toBe(target.phone);
  expect(updated.whatsapp).toBe(target.whatsapp);

  const reusePreview = store.previewCustomerUpdate(superadmin, updated.id, {
    ...editableCustomer(updated),
    secondaryPhone: updated.phone,
    expectedRevision: updated.revision,
  });
  const reused = store.updateCustomer(superadmin, updated.id, {
    ...reusePreview.input,
    expectedRevision: updated.revision,
    previewToken: reusePreview.previewToken,
  });
  expect(reused.secondaryPhone).toBe(updated.phone);
});

test("客户最终 PATCH 在预览后号码被占用时仍以手机号硬冲突拒绝 confirm 覆盖", () => {
  const store = createMockCustomerVehicleStore();
  const target = store.customer(superadmin, "CUST-UAT-004");
  const claimedAfterPreview = "+1 876 000 0999";
  const preview = store.previewCustomerUpdate(superadmin, target.id, {
    ...editableCustomer(target),
    primaryPhone: claimedAfterPreview,
    expectedRevision: target.revision,
  });

  const claimant = store.customer(superadmin, "CUST-UAT-003");
  updateCustomerWithPreview(store, superadmin, claimant.id, {
    ...editableCustomer(claimant),
    primaryPhone: claimedAfterPreview,
    expectedRevision: claimant.revision,
  });

  expectStoreCode(() => store.updateCustomer(superadmin, target.id, {
    ...preview.input,
    expectedRevision: target.revision,
    previewToken: preview.previewToken,
    confirmPossibleDuplicate: true,
  }), "CUSTOMER_PHONE_DUPLICATE", 409);
});

test("客户编辑预览在 draft 或候选源 revision 变化后不可复用", () => {
  const store = createMockCustomerVehicleStore();
  const before = store.customer(superadmin, "CUST-UAT-003");
  const staleDraft: PreviewCustomerUpdateInput = {
    ...editableCustomer(before),
    primaryPhone: "+1 876 000 0061", // 2026-08-17：手机号必填（CUST-UAT-003 种子无号，补一个再走编辑流）
    expectedRevision: before.revision,
  };
  const stale = store.previewCustomerUpdate(superadmin, before.id, staleDraft);
  const createPreview = previewNewCustomer(store, superadmin, {
    customerType: "individual",
    nameSourceValue: "魏子涵",
    primaryPhone: "+18765550988",
  });
  store.createCustomer(superadmin, { ...createPreview.input, previewToken: createPreview.previewToken });

  expect(() => store.updateCustomer(superadmin, before.id, {
    ...stale.input,
    expectedRevision: before.revision,
    previewToken: stale.previewToken,
  })).toThrow(/源数据已变化/);
});

test("车辆编辑预览排除自身车牌并绑定 update、实体、revision、exact input 与操作者", () => {
  const store = createMockCustomerVehicleStore();
  const before = store.vehicle(superadmin, "VEH-UAT-001");
  const draft: PreviewVehicleUpdateInput = {
    ...editableVehicle(before),
    model: "CR-V Touring",
    expectedRevision: before.revision,
  };
  const preview = store.previewVehicleUpdate(superadmin, before.id, draft);
  expect(preview).toMatchObject({ existingVehicleId: null, canSave: true });

  expect(() => store.updateVehicle(superadmin, before.id, {
    ...preview.input,
    model: "Tampered",
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
  })).toThrow(/预览内容已变化/);
  expect(() => store.updateVehicle(frontdeskAdmin, before.id, {
    ...preview.input,
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
  })).toThrow(/预览操作者不一致/);
  expect(() => store.updateVehicle(superadmin, "VEH-UAT-002", {
    ...preview.input,
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
  })).toThrow(/预览实体不一致|车辆版本已变化/);

  const duplicatePreview = store.previewVehicleUpdate(superadmin, before.id, {
    ...draft,
    plate: "4789 cp",
  });
  expect(duplicatePreview).toMatchObject({ existingVehicleId: "VEH-UAT-002", canSave: false });
  expect(() => store.updateVehicle(superadmin, before.id, {
    ...duplicatePreview.input,
    expectedRevision: before.revision,
    previewToken: duplicatePreview.previewToken,
  })).toThrow(/车牌已存在/);

  const updated = store.updateVehicle(superadmin, before.id, {
    ...preview.input,
    expectedRevision: before.revision,
    previewToken: preview.previewToken,
  });
  expect(updated).toMatchObject({ model: "CR-V Touring", revision: 2 });
});

test("车辆审计深拷贝新增、结束与重新激活关系，失败写入保持关系和审计原子", () => {
  const storage = {
    saved: null as string | null,
    failWrites: false,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) {
      if (this.failWrites) throw new Error("磁盘写入失败");
      this.saved = value;
    },
  };
  const store = createMockCustomerVehicleStore({ storage });
  const initial = store.vehicle(superadmin, "VEH-UAT-001");
  const initialRelationship = store.workspace(superadmin).relationships.find((entry) => entry.id === "REL-UAT-001")!;
  const endedAt = "2026-08-09T12:00:00.000Z";
  const endDraft: PreviewVehicleUpdateInput = {
    ...editableVehicle(initial),
    expectedRevision: initial.revision,
    relationships: [{
      relationshipId: initialRelationship.id,
      customerId: initialRelationship.customerId,
      startedAt: initialRelationship.startedAt,
      endedAt,
    }],
  };
  const endPreview = store.previewVehicleUpdate(superadmin, initial.id, endDraft);
  store.updateVehicle(superadmin, initial.id, {
    ...endPreview.input,
    expectedRevision: initial.revision,
    previewToken: endPreview.previewToken,
  });

  const afterEnd = store.vehicle(superadmin, initial.id);
  const reactivateDraft: PreviewVehicleUpdateInput = {
    ...editableVehicle(afterEnd),
    expectedRevision: afterEnd.revision,
    relationships: [
      { relationshipId: initialRelationship.id, customerId: initialRelationship.customerId, startedAt: initialRelationship.startedAt, endedAt },
      { customerId: initialRelationship.customerId, startedAt: "2026-08-10T09:00:00.000Z", endedAt: null },
    ],
  };
  const reactivatePreview = store.previewVehicleUpdate(superadmin, initial.id, reactivateDraft);
  const beforeFailureWorkspace = store.workspace(superadmin);
  const beforeFailureAudits = mutationAudits(store);
  storage.failWrites = true;
  expect(() => store.updateVehicle(superadmin, initial.id, {
    ...reactivatePreview.input,
    expectedRevision: afterEnd.revision,
    previewToken: reactivatePreview.previewToken,
  })).toThrow("磁盘写入失败");
  expect(store.workspace(superadmin)).toEqual(beforeFailureWorkspace);
  expect(mutationAudits(store)).toEqual(beforeFailureAudits);

  storage.failWrites = false;
  store.updateVehicle(superadmin, initial.id, {
    ...reactivatePreview.input,
    expectedRevision: afterEnd.revision,
    previewToken: reactivatePreview.previewToken,
  });
  const vehicleAudits = mutationAudits(store).filter((entry) => "vehicleId" in entry);
  expect(vehicleAudits).toHaveLength(2);
  expect(vehicleAudits[0]).toMatchObject({
    beforeRelationships: [expect.objectContaining({ id: "REL-UAT-001", endedAt: null })],
    afterRelationships: [expect.objectContaining({ id: "REL-UAT-001", endedAt })],
  });
  expect(vehicleAudits[1]).toMatchObject({
    beforeRelationships: [expect.objectContaining({ id: "REL-UAT-001", endedAt })],
    afterRelationships: expect.arrayContaining([
      expect.objectContaining({ id: "REL-UAT-001", endedAt }),
      expect.objectContaining({ customerId: "CUST-UAT-001", startedAt: "2026-08-10T09:00:00.000Z", endedAt: null }),
    ]),
  });

  const mutableAudit = vehicleAudits[1]!;
  mutableAudit.afterRelationships[0].endedAt = null;
  expect(mutationAudits(store)[1]).toMatchObject({
    afterRelationships: expect.arrayContaining([expect.objectContaining({ id: "REL-UAT-001", endedAt })]),
  });
});

test("所有公开 preview/mutation 在鉴权后执行运行时 schema 与严格 ISO 校验", () => {
  const store = createMockCustomerVehicleStore();
  const badCustomerBodies: Array<[unknown, RegExp]> = [
    [null, /客户输入必须是对象/],
    [{ customerType: "vip", nameSourceValue: "陈志远", email: "bad@example.test" }, /客户类型无效/],
    [{ customerType: "individual", nameSourceValue: "陈志远", email: "bad@example.test", status: "paused" }, /客户状态无效/],
    [{ customerType: "individual", nameSourceValue: "陈志远", email: "bad@example.test", preferredChannel: "fax" }, /首选联系渠道无效/],
    [{ customerType: "individual", nameSourceValue: 42, email: "bad@example.test" }, /nameSourceValue必须是字符串或 null/],
    [{ customerType: "individual", nameSourceValue: "陈志远", email: "bad@example.test", gender: 1 }, /gender必须是字符串或 null/],
  ];
  for (const [body, message] of badCustomerBodies) {
    expect(() => store.previewCustomer(superadmin, body as CustomerDraftInput)).toThrow(message);
    expect(() => store.previewCustomer(undefined, body as CustomerDraftInput)).toThrow(/^403 /);
  }

  const badVehicleBodies: Array<[unknown, RegExp]> = [
    [null, /车辆输入必须是对象/],
    [{ make: "Honda", model: "Fit", year: 2020, status: "inactive" }, /车辆状态无效/],
    [{ make: "Honda", model: "Fit", year: 2020, mileageUnit: "yards" }, /里程单位无效/],
    [{ make: "Honda", model: "Fit", year: 2020, mileageRecordedAt: "yesterday" }, /里程记录时间必须是严格 ISO 时间/],
    [{ make: "Honda", model: "Fit", year: 2020, relationships: {} }, /车辆关系必须是数组/],
    [{ make: "Honda", model: "Fit", year: 2020, relationships: [{ customerId: "CUST-UAT-001", startedAt: "2026-08-09", endedAt: null }] }, /关联开始时间必须是严格 ISO 时间/],
    [{ make: "Honda", model: "Fit", year: 2020, relationships: [{ customerId: "CUST-UAT-001", startedAt: "2026-08-10T00:00:00.000Z", endedAt: "2026-08-09T00:00:00.000Z" }] }, /关联结束时间不能早于开始时间/],
  ];
  for (const [body, message] of badVehicleBodies) {
    expect(() => store.previewVehicle(superadmin, body as VehicleDraftInput)).toThrow(message);
    expect(() => store.previewVehicle(undefined, body as VehicleDraftInput)).toThrow(/^403 /);
  }
});

test("schema v3 持久化状态拒绝同一车辆存在多个当前客户且不回种", () => {
  const storage = {
    saved: null as string | null,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.saved = value; },
  };
  const writer = createMockCustomerVehicleStore({ storage });
  const preview = previewNewCustomer(writer, superadmin, {
    customerType: "individual",
    nameSourceValue: "宋雨桐",
    primaryPhone: "+1 876 000 0062",
    email: "invalid-v2@example.test",
  });
  writer.createCustomer(superadmin, { ...preview.input, previewToken: preview.previewToken });
  const envelope = JSON.parse(storage.saved!) as {
    schemaVersion: number;
    state: { relationships: Array<{ id: string; endedAt: string | null }> };
  };
  envelope.state.relationships.find((entry) => entry.id === "REL-UAT-004")!.endedAt = null;
  envelope.state.relationships.find((entry) => entry.id === "REL-UAT-005")!.endedAt = null;
  storage.saved = JSON.stringify(envelope);
  const corruptRaw = storage.saved;

  expect(() => createMockCustomerVehicleStore({ storage }).workspace(superadmin))
    .toThrow("持久化客户与车辆数据不符合 schema v3");
  expect(storage.saved).toBe(corruptRaw);
});

test("损坏的 legacy envelope fail closed 且不回种", () => {
  const raw = JSON.stringify({
    schemaVersion: 1,
    state: {
      sourceRevision: 999,
      customers: [{ id: "CORRUPT-CUSTOMER", customerType: "vip", tags: "not-an-array" }],
      vehicles: [{ id: "CORRUPT-VEHICLE", status: "teleported" }],
      relationships: [{ id: "CORRUPT-REL", startedAt: "not-a-date" }],
      auditRecords: [{ entityType: "vehicle", beforeRelationships: "not-an-array" }],
    },
  });
  const storage = {
    getItem: () => raw,
    setItem: () => undefined,
  };
  expect(() => createMockCustomerVehicleStore({ storage }).workspace(superadmin))
    .toThrow("持久化客户与车辆数据不符合 schema v3");
  expect(storage.getItem()).toBe(raw);
});

test("持久化 envelope 拒绝规范化后重复的非空车牌且不回种", () => {
  const storage = {
    saved: null as string | null,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.saved = value; },
  };
  const writer = createMockCustomerVehicleStore({ storage });
  const preview = previewNewCustomer(writer, superadmin, {
    customerType: "individual",
    nameSourceValue: "高俊熙",
    primaryPhone: "+1 876 000 0063",
    email: "envelope-writer@example.test",
  });
  writer.createCustomer(superadmin, {
    ...preview.input,
    previewToken: preview.previewToken,
  });
  const envelope = JSON.parse(storage.saved!) as {
    state: { vehicles: VehicleRecord[] };
  };
  envelope.state.vehicles[0].plate = "7012 AB";
  envelope.state.vehicles[1].plate = "7012AB";
  storage.saved = JSON.stringify(envelope);
  const corruptRaw = storage.saved;

  expect(() => createMockCustomerVehicleStore({ storage }).workspace(superadmin))
    .toThrow("持久化客户与车辆数据不符合 schema v3");
  expect(storage.saved).toBe(corruptRaw);
});

test("共享存储冲突后 losing store 的下一次 workspace/detail 重读 winner persisted state", () => {
  const storage = {
    saved: null as string | null,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.saved = value; },
  };
  const winner = createMockCustomerVehicleStore({ storage });
  const loser = createMockCustomerVehicleStore({ storage });
  const winnerPreview = previewNewCustomer(winner, superadmin, {
    customerType: "individual", nameSourceValue: "冯诗涵", primaryPhone: "+1 876 000 0064", email: "winner@example.test",
  });
  const loserPreview = previewNewCustomer(loser, frontdeskAdmin, {
    customerType: "individual", nameSourceValue: "罗浩宇", primaryPhone: "+1 876 000 0065", email: "loser@example.test",
  });
  const created = winner.createCustomer(superadmin, {
    ...winnerPreview.input,
    previewToken: winnerPreview.previewToken,
  });

  expect(() => loser.createCustomer(frontdeskAdmin, {
    ...loserPreview.input,
    previewToken: loserPreview.previewToken,
  })).toThrow(/源数据已变化/);
  expect(loser.workspace(frontdeskAdmin).customers.map((entry) => entry.id)).toContain(created.id);
  expect(loser.customer(frontdeskAdmin, created.id)).toEqual(created);
});

test("OTP request stores one canonical record and immediate or reloaded retries are byte-stable", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const requested = store.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "(876) 555-0122",
    clientMutationId: "otp-request-canonical-1",
  });
  const rawAfterRequest = storage.saved;
  const writesAfterRequest = storage.writes;
  const retried = store.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+1 876 555 0122",
    clientMutationId: "otp-request-canonical-1",
  });
  expect(retried).toEqual(requested);
  expect(storage.saved).toBe(rawAfterRequest);
  expect(storage.writes).toBe(writesAfterRequest);
  expect(requested.verificationArchive.otpRecords).toEqual([{
    id: expect.any(String),
    phoneE164: "+18765550122",
    requestedAt: "2026-08-09T00:00:00.000Z",
  }]);

  const reloaded = createMockCustomerVehicleStore({ storage });
  const retriedAfterReload = reloaded.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+18765550122",
    clientMutationId: "otp-request-canonical-1",
  });
  expect(retriedAfterReload).toEqual(requested);
  expect(storage.saved).toBe(rawAfterRequest);
  expect(storage.writes).toBe(writesAfterRequest);
  expect(reloaded.customerAuditHistory(superadmin, "CUST-UAT-003").filter((event) => event.eventType === "otp_requested"))
    .toHaveLength(1);
});

test("existing-customer OTP rejects a number owned only by another customer before writing", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const target = store.customer(superadmin, "CUST-UAT-003");
  const occupied = store.customer(superadmin, "CUST-UAT-002").phone;
  expect(occupied).toBeTruthy();

  expectStoreCode(() => store.requestCustomerOtp(superadmin, target.id, {
    phoneE164: occupied!,
    clientMutationId: "otp-request-other-owner",
  }), "CUSTOMER_PHONE_DUPLICATE", 409);
  expect(storage.saved).toBeNull();
  expect(store.customer(superadmin, target.id)).toEqual(target);
});

test("existing-customer OTP allows re-verification of any number already owned by that customer", () => {
  const ownedFields = ["phone", "secondaryPhone", "whatsapp"] as const;
  for (const field of ownedFields) {
    const store = createMockCustomerVehicleStore();
    const target = store.customer(superadmin, "CUST-UAT-001");
    const ownedPhone = target[field];
    expect(ownedPhone, `${field} fixture`).toBeTruthy();
    if (field === "phone") {
      expect(ownedPhone).toBe(store.customer(superadmin, "CUST-BULK-001").phone);
    }
    const requested = store.requestCustomerOtp(superadmin, target.id, {
      phoneE164: ownedPhone!,
      clientMutationId: `otp-request-own-${field}`,
    });
    const otpRecord = requested.verificationArchive.otpRecords.at(-1)!;
    const verified = store.verifyCustomerOtp(superadmin, target.id, {
      otpRecordId: otpRecord.id,
      code: "123456",
      clientMutationId: `otp-verify-own-${field}`,
    });
    expect(verified.phone, field).toBe(ownedPhone);
    expect(verified.verificationArchive.otpRecords.at(-1), field).toMatchObject({
      id: otpRecord.id,
      phoneE164: ownedPhone,
      verifiedBy: superadmin.actorId,
    });
  }
});

test("OTP verify rechecks a newly claimed number and leaves the target customer unchanged on conflict", () => {
  const store = createMockCustomerVehicleStore();
  const target = store.customer(superadmin, "CUST-UAT-003");
  const requestedPhone = "+1 876 555 0187";
  const requested = store.requestCustomerOtp(superadmin, target.id, {
    phoneE164: requestedPhone,
    clientMutationId: "otp-request-before-race",
  });
  const otpRecordId = requested.verificationArchive.otpRecords.at(-1)!.id;

  const claimant = store.customer(superadmin, "CUST-UAT-004");
  updateCustomerWithPreview(store, superadmin, claimant.id, {
    ...editableCustomer(claimant),
    primaryPhone: requestedPhone,
    expectedRevision: claimant.revision,
  });
  const targetBeforeVerify = store.customer(superadmin, target.id);

  expectStoreCode(() => store.verifyCustomerOtp(superadmin, target.id, {
    otpRecordId,
    code: "123456",
    clientMutationId: "otp-verify-after-race",
  }), "CUSTOMER_PHONE_DUPLICATE", 409);
  expect(store.customer(superadmin, target.id)).toEqual(targetBeforeVerify);
});

test("missing or invalid OTP phone and a wrong code leave records, audit, receipts, revisions, and raw unchanged", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const before = store.customer(superadmin, "CUST-UAT-003");

  expectStoreCode(() => store.requestCustomerOtp(superadmin, before.id, {
    phoneE164: " ",
    clientMutationId: "otp-request-empty",
  }), "OTP_PHONE_REQUIRED");
  expectStoreCode(() => store.requestCustomerOtp(superadmin, before.id, {
    phoneE164: "876-CALL-NOW",
    clientMutationId: "otp-request-invalid",
  }), "OTP_PHONE_INVALID");
  expect(storage.saved).toBeNull();
  expect(store.customer(superadmin, before.id)).toEqual(before);

  const requested = store.requestCustomerOtp(superadmin, before.id, {
    phoneE164: "+18765550123",
    clientMutationId: "otp-request-for-code-test",
  });
  const otpRecordId = requested.verificationArchive.otpRecords.at(-1)!.id;
  const rawBeforeWrongCode = storage.saved;
  const beforeWrongCode = store.customer(superadmin, before.id);
  const auditBeforeWrongCode = store.customerAuditHistory(superadmin, before.id);
  expectStoreCode(() => store.verifyCustomerOtp(superadmin, before.id, {
    otpRecordId,
    code: "654321",
    clientMutationId: "otp-verify-wrong",
  }), "OTP_CODE_INVALID");
  expect(storage.saved).toBe(rawBeforeWrongCode);
  expect(store.customer(superadmin, before.id)).toEqual(beforeWrongCode);
  expect(store.customerAuditHistory(superadmin, before.id)).toEqual(auditBeforeWrongCode);
  const corrected = store.verifyCustomerOtp(superadmin, before.id, {
    otpRecordId,
    code: "123456",
    clientMutationId: "otp-verify-wrong",
  });
  expect(corrected.verificationArchive.otpRecords.find((record) => record.id === otpRecordId))
    .toMatchObject({ verifiedBy: superadmin.actorId });
});

test("OTP verification atomically adopts its exact requested phone and later formal editing preserves historical OTP", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const before = store.customer(superadmin, "CUST-UAT-003");
  const requested = store.requestCustomerOtp(superadmin, before.id, {
    phoneE164: "+1 876 555 0124",
    clientMutationId: "otp-request-new-primary",
  });
  const otpRecordId = requested.verificationArchive.otpRecords.at(-1)!.id;
  const verified = store.verifyCustomerOtp(superadmin, before.id, {
    otpRecordId,
    code: "123456",
    clientMutationId: "otp-verify-new-primary",
  });
  expect(verified.phone).toBe("+18765550124");
  expect(verified.verificationArchive.otpRecords.at(-1)).toMatchObject({
    id: otpRecordId,
    phoneE164: "+18765550124",
    verifiedBy: superadmin.actorId,
  });
  expect(deriveOtpVerification(verified.verificationArchive, verified.phone).status).toBe("verified");
  expect(store.customerAuditHistory(superadmin, before.id).find((event) => event.eventType === "otp_verified"))
    .toMatchObject({
      changes: expect.arrayContaining([
        { field: "phone", before: null, after: "+18765550124" },
      ]),
    });

  const edited = updateCustomerWithPreview(store, superadmin, before.id, {
    ...editableCustomer(verified),
    primaryPhone: "+18765550125",
    expectedRevision: verified.revision,
  });
  expect(edited.verificationArchive.otpRecords).toEqual(verified.verificationArchive.otpRecords);
  expect(deriveOtpVerification(edited.verificationArchive, edited.phone).status).toBe("needs_reverification");
});

test("OTP invalidation requires a verified live record, records actor and safe reason, and permits a fresh request", () => {
  const store = createMockCustomerVehicleStore();
  const pending = store.requestCustomerOtp(frontdeskAdmin, "CUST-UAT-003", {
    phoneE164: "+18765550126",
    clientMutationId: "otp-request-unreachable",
  });
  const otpRecordId = pending.verificationArchive.otpRecords.at(-1)!.id;
  expectStoreCode(() => store.invalidateCustomerOtp(frontdeskAdmin, pending.id, {
    otpRecordId,
    reason: "号码无法接通",
    clientMutationId: "otp-invalidate-pending",
  }), "OTP_RECORD_NOT_VERIFIED", 409);

  const verified = store.verifyCustomerOtp(frontdeskAdmin, pending.id, {
    otpRecordId,
    code: "123456",
    clientMutationId: "otp-verify-unreachable",
  });
  const invalidated = store.invalidateCustomerOtp(frontdeskAdmin, pending.id, {
    otpRecordId,
    reason: "  号码无法接通  ",
    clientMutationId: "otp-invalidate-verified",
  });
  expect(invalidated.verificationArchive.otpRecords).toHaveLength(verified.verificationArchive.otpRecords.length);
  expect(invalidated.verificationArchive.otpRecords.at(-1)).toMatchObject({
    id: otpRecordId,
    invalidatedBy: frontdeskAdmin.actorId,
    invalidationReason: "号码无法接通",
  });
  expect(deriveOtpVerification(invalidated.verificationArchive, invalidated.phone).status)
    .toBe("needs_reverification");
  expectStoreCode(() => store.invalidateCustomerOtp(frontdeskAdmin, pending.id, {
    otpRecordId,
    reason: "retry",
    clientMutationId: "otp-invalidate-again",
  }), "OTP_RECORD_INVALIDATED", 409);

  const fresh = store.requestCustomerOtp(frontdeskAdmin, pending.id, {
    phoneE164: "+18765550127",
    clientMutationId: "otp-request-after-invalidation",
  });
  expect(fresh.verificationArchive.otpRecords).toHaveLength(invalidated.verificationArchive.otpRecords.length + 1);
  expect(fresh.verificationArchive.otpRecords.at(-1)).toMatchObject({ phoneE164: "+18765550127" });
  expect(fresh.verificationArchive.otpRecords.at(-2)).toEqual(invalidated.verificationArchive.otpRecords.at(-1));
});

test("KYC submit and verify require real driver's-license image evidence and reject malformed assets atomically", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const customerId = "CUST-UAT-003";
  expectStoreCode(() => store.verifyCustomerKyc(superadmin, customerId, {
    kycRecordId: "KYC-MISSING",
    clientMutationId: "kyc-verify-missing",
  }), "KYC_EVIDENCE_REQUIRED", 409);
  expect(storage.saved).toBeNull();

  const invalidAssets = [
    verificationAsset("kyc-pdf", {
      fileName: "license.pdf", url: PDF_DATA_URL, mimeType: "application/pdf", sizeBytes: 9,
    }),
    verificationAsset("kyc-fake-signature", {
      url: "data:image/png;base64,bm90IGEgcG5n", sizeBytes: 9,
    }),
    verificationAsset("kyc-size-mismatch", { sizeBytes: 1 }),
  ];
  for (const [index, frontAsset] of invalidAssets.entries()) {
    const raw = storage.saved;
    expectStoreCode(() => store.submitCustomerKyc(superadmin, customerId, {
      frontAsset,
      clientMutationId: `kyc-submit-invalid-${index}`,
    }), "EVIDENCE_ASSET_INVALID");
    expect(storage.saved).toBe(raw);
  }

  const frontAsset = verificationAsset("kyc-front-valid");
  const backAsset = verificationAsset("kyc-back-valid");
  const submitted = store.submitCustomerKyc(superadmin, customerId, {
    frontAsset,
    backAsset,
    clientMutationId: "kyc-submit-valid",
  });
  const record = submitted.verificationArchive.kycRecords.at(-1)!;
  expect(record).toMatchObject({ documentType: "drivers_license", frontAsset, backAsset });
  const verified = store.verifyCustomerKyc(superadmin, customerId, {
    kycRecordId: record.id,
    clientMutationId: "kyc-verify-valid",
  });
  expect(verified.verificationArchive.kycRecords.at(-1)).toMatchObject({
    id: record.id,
    verifiedBy: superadmin.actorId,
  });
});

test("KYC verify response loss retries the persisted record with the same mutation without duplicate writes", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({
    storage,
    faults: {
      failNext: { customerKycVerifyResponse: "演示 KYC 核验响应丢失" },
    },
  });
  const customerId = "CUST-UAT-003";
  const before = store.customer(superadmin, customerId);
  const beforeRecordCount = before.verificationArchive.kycRecords.length;
  const submitted = store.submitCustomerKyc(superadmin, customerId, {
    frontAsset: verificationAsset("kyc-response-loss-front"),
    clientMutationId: "kyc-response-loss-submit",
  });
  const record = submitted.verificationArchive.kycRecords.at(-1)!;
  expect(storage.writes).toBe(1);

  const verifyInput = {
    kycRecordId: record.id,
    clientMutationId: "kyc-response-loss-verify",
  };
  expect(() => store.verifyCustomerKyc(superadmin, customerId, verifyInput))
    .toThrow("演示 KYC 核验响应丢失");

  const persisted = store.customer(superadmin, customerId);
  expect(persisted.verificationArchive.kycRecords).toHaveLength(beforeRecordCount + 1);
  expect(persisted.verificationArchive.kycRecords.at(-1)).toMatchObject({
    id: record.id,
    verifiedBy: superadmin.actorId,
  });
  expect(storage.writes).toBe(2);
  expect(store.customerAuditHistory(superadmin, customerId)
    .filter((event) => event.eventType === "kyc_submitted")).toHaveLength(1);
  expect(store.customerAuditHistory(superadmin, customerId)
    .filter((event) => event.eventType === "kyc_verified")).toHaveLength(1);

  const retried = store.verifyCustomerKyc(superadmin, customerId, verifyInput);
  expect(retried.verificationArchive.kycRecords).toHaveLength(beforeRecordCount + 1);
  expect(retried.verificationArchive.kycRecords.at(-1)).toMatchObject({
    id: record.id,
    verifiedBy: superadmin.actorId,
  });
  expect(storage.writes).toBe(2);
  expect(store.customerAuditHistory(superadmin, customerId)
    .filter((event) => event.eventType === "kyc_submitted")).toHaveLength(1);
  expect(store.customerAuditHistory(superadmin, customerId)
    .filter((event) => event.eventType === "kyc_verified")).toHaveLength(1);

  expectStoreCode(() => store.verifyCustomerKyc(superadmin, customerId, {
    kycRecordId: record.id,
    clientMutationId: "kyc-response-loss-different-verify",
  }), "KYC_RECORD_NOT_PENDING", 409);
});

test("KYC submit response loss replays only the same canonical evidence and profile without duplicate writes", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({
    storage,
    faults: {
      failNext: { customerKycSubmitResponse: "演示 KYC 提交响应丢失" },
    },
  });
  const customerId = "CUST-UAT-003";
  const before = store.customer(superadmin, customerId);
  const beforeAudits = store.customerAuditHistory(superadmin, customerId);
  const submitInput = {
    frontAsset: verificationAsset("kyc-submit-loss-front"),
    backAsset: verificationAsset("kyc-submit-loss-back"),
    clientMutationId: "kyc-submit-loss-mutation",
  };

  expect(() => store.submitCustomerKyc(superadmin, customerId, submitInput))
    .toThrow("演示 KYC 提交响应丢失");
  const persisted = store.customer(superadmin, customerId);
  const persistedRecord = persisted.verificationArchive.kycRecords.at(-1)!;
  expect(persisted.verificationArchive.kycRecords).toHaveLength(
    before.verificationArchive.kycRecords.length + 1,
  );
  expect(persistedRecord).toMatchObject({
    frontAsset: submitInput.frontAsset,
    backAsset: submitInput.backAsset,
  });
  expect(store.customerAuditHistory(superadmin, customerId)
    .filter((event) => event.eventType === "kyc_submitted")).toHaveLength(
    beforeAudits.filter((event) => event.eventType === "kyc_submitted").length + 1,
  );
  const writesAfterPersist = storage.writes;
  const auditsAfterPersist = store.customerAuditHistory(superadmin, customerId);

  const replayed = store.submitCustomerKyc(superadmin, customerId, submitInput);
  expect(replayed.verificationArchive.kycRecords.at(-1)?.id).toBe(persistedRecord.id);
  expect(replayed.verificationArchive.kycRecords).toHaveLength(
    before.verificationArchive.kycRecords.length + 1,
  );
  expect(storage.writes).toBe(writesAfterPersist);
  expect(store.customerAuditHistory(superadmin, customerId)).toEqual(auditsAfterPersist);

  const stateBeforeEvidenceConflict = store.customer(superadmin, customerId);
  expectStoreCode(() => store.submitCustomerKyc(superadmin, customerId, {
    ...submitInput,
    backAsset: verificationAsset("kyc-submit-loss-changed-back"),
  }), "CUSTOMER_IDEMPOTENCY_CONFLICT", 409);
  expect(storage.writes).toBe(writesAfterPersist);
  expect(store.customer(superadmin, customerId)).toEqual(stateBeforeEvidenceConflict);
  expect(store.customerAuditHistory(superadmin, customerId)).toEqual(auditsAfterPersist);

  const organizationId = "CUST-UAT-002";
  const organizationProfile = {
    name: "  Dwayne   Clarke  ",
    birthDate: "1987-09-14",
    sex: "M" as const,
    address: "  14 Contact Lane,   Kingston  ",
  };
  const organizationInput = {
    subjectType: "organization_primary_contact" as const,
    subjectProfile: organizationProfile,
    frontAsset: verificationAsset("kyc-submit-org-profile-front"),
    clientMutationId: "kyc-submit-org-profile-mutation",
  };
  const organizationSubmitted = store.submitCustomerKyc(superadmin, organizationId, organizationInput);
  const writesAfterOrganization = storage.writes;
  const organizationAudits = store.customerAuditHistory(superadmin, organizationId);
  expect(store.submitCustomerKyc(superadmin, organizationId, {
    ...organizationInput,
    subjectProfile: {
      ...organizationProfile,
      name: "Dwayne Clarke",
      address: "14 Contact Lane, Kingston",
    },
  })).toEqual(organizationSubmitted);
  expect(storage.writes).toBe(writesAfterOrganization);

  const organizationBeforeConflict = store.customer(superadmin, organizationId);
  expectStoreCode(() => store.submitCustomerKyc(superadmin, organizationId, {
    ...organizationInput,
    subjectProfile: { ...organizationProfile, address: "99 Changed Road, Kingston" },
  }), "CUSTOMER_IDEMPOTENCY_CONFLICT", 409);
  expect(storage.writes).toBe(writesAfterOrganization);
  expect(store.customer(superadmin, organizationId)).toEqual(organizationBeforeConflict);
  expect(store.customerAuditHistory(superadmin, organizationId)).toEqual(organizationAudits);
});

test("existing-customer KYC enforces the strict customer/organization subject union and safe scoped audits", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage, clock: () => "2026-08-14T13:00:00.000Z" });
  const organization = store.customer(superadmin, "CUST-UAT-002");
  expect(organization.customerType).toBe("organization");
  const before = store.customer(superadmin, organization.id);

  expect(() => store.submitCustomerKyc(superadmin, organization.id, {
    frontAsset: verificationAsset("org-unscoped-license"),
    clientMutationId: "org-unscoped-submit",
  })).toThrow();
  expect(store.customer(superadmin, organization.id)).toEqual(before);
  expect(storage.saved).toBeNull();

  const individual = store.customer(superadmin, "CUST-UAT-003");
  expect(() => store.submitCustomerKyc(superadmin, individual.id, {
    subjectType: "organization_primary_contact",
    subjectProfile: {
      name: "Marcia Reid",
      birthDate: "1980-01-02",
      sex: "F",
      address: "Individual Address",
    },
    frontAsset: verificationAsset("individual-scoped-license"),
    clientMutationId: "individual-scoped-submit",
  })).toThrow();

  const profile = {
    name: `  ${organization.nameSourceValue}  `,
    birthDate: "1988-06-07",
    sex: "M" as const,
    address: "  14 Contact Lane, Kingston  ",
  };
  const submitted = store.submitCustomerKyc(superadmin, organization.id, {
    subjectType: "organization_primary_contact",
    subjectProfile: profile,
    frontAsset: verificationAsset("org-scoped-license"),
    clientMutationId: "org-scoped-submit",
  });
  const record = submitted.verificationArchive.kycRecords.at(-1)!;
  expect(record).toMatchObject({
    subjectType: "organization_primary_contact",
    subjectProfile: {
      name: organization.nameSourceValue,
      birthDate: "1988-06-07",
      sex: "M",
      address: "14 Contact Lane, Kingston",
    },
  });
  const verified = store.verifyCustomerKyc(superadmin, organization.id, {
    kycRecordId: record.id,
    clientMutationId: "org-scoped-verify",
  });
  expect(verified.verificationArchive.kycRecords.at(-1)).toMatchObject({
    subjectType: "organization_primary_contact",
    verifiedBy: superadmin.actorId,
  });
  const audits = store.customerAuditHistory(superadmin, organization.id)
    .filter((event) => event.eventType === "kyc_submitted" || event.eventType === "kyc_verified");
  expect(audits.map((event) => event.summary)).toEqual([
    "提交主要联系人驾驶证证据",
    "完成主要联系人驾驶证核验",
  ]);
  const serialized = JSON.stringify(audits);
  expect(serialized).not.toContain("企业驾驶证");
  for (const value of Object.values(profile)) expect(serialized).not.toContain(value.trim());
  expect(serialized).not.toMatch(/data:image|base64/i);
  expect(audits.flatMap((event) => event.changes).map((change) => change.field))
    .toEqual(expect.arrayContaining(["kycRecordId", "subjectType", "submittedAt", "verifiedAt"]));

  const rawAfterSuccess = storage.saved;
  expect(() => store.submitCustomerKyc(superadmin, organization.id, {
    subjectType: "organization_primary_contact",
    subjectProfile: profile,
    frontAsset: verificationAsset("org-extra-key-license"),
    clientMutationId: "org-extra-key-submit",
    unknown: "data:image/png;base64,PRIVATE",
  } as never)).toThrow();
  expect(storage.saved).toBe(rawAfterSuccess);
});

test("verification evidence rejects unsafe or malformed metadata and duplicate customer evidence IDs before persist", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const customerId = "CUST-UAT-003";
  const unsafeAssets = [
    verificationAsset("data:image/png;base64,PRIVATE_ID"),
    verificationAsset("unsafe-file-name", { fileName: "data:image/png;base64,PRIVATE_FILENAME" }),
    verificationAsset("unsafe-created-by", { createdBy: "data:image/png;base64,PRIVATE_ACTOR" }),
    verificationAsset("invalid-created-at", { createdAt: "yesterday" }),
  ];
  for (const [index, frontAsset] of unsafeAssets.entries()) {
    const raw = storage.saved;
    expectStoreCode(() => store.submitCustomerKyc(superadmin, customerId, {
      frontAsset,
      clientMutationId: `unsafe-evidence-${index}`,
    }), "EVIDENCE_ASSET_INVALID");
    expect(storage.saved).toBe(raw);
  }

  const firstAsset = verificationAsset("customer-owned-evidence-id");
  store.submitCustomerKyc(superadmin, customerId, {
    frontAsset: firstAsset,
    clientMutationId: "evidence-id-first-use",
  });
  const rawAfterFirst = storage.saved;
  expectStoreCode(() => store.signCustomerAgreement(superadmin, customerId, {
    medium: "paper",
    version: "1.3",
    signedBy: "Marcia Reid",
    paperScanAsset: verificationAsset(firstAsset.id),
    clientMutationId: "evidence-id-reused",
  }), "EVIDENCE_ASSET_INVALID", 409);
  expect(storage.saved).toBe(rawAfterFirst);
});

test("existing-customer evidence asset IDs are globally unique across customers, request branches, and vehicle attachments", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage, clock: () => "2026-08-14T14:00:00.000Z" });
  const customerId = "CUST-UAT-003";

  const expectGlobalCollision = (operation: () => unknown) => {
    const beforeCustomer = store.customer(superadmin, customerId);
    const beforeAudits = store.customerAuditHistory(superadmin, customerId);
    const beforeRaw = storage.saved;
    const beforeWrites = storage.writes;
    let caught: unknown;
    try {
      operation();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "EVIDENCE_ASSET_INVALID", status: 409 });
    expect(String(caught)).not.toMatch(/CUST-UAT-001|Alicia Bennett|North Coast Logistics/);
    expect(storage.saved).toBe(beforeRaw);
    expect(storage.writes).toBe(beforeWrites);
    expect(store.customer(superadmin, customerId)).toEqual(beforeCustomer);
    expect(store.customerAuditHistory(superadmin, customerId)).toEqual(beforeAudits);
  };

  expectGlobalCollision(() => store.submitCustomerKyc(superadmin, customerId, {
    frontAsset: { ...SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront },
    clientMutationId: "global-evidence-kyc-front",
  }));
  expectGlobalCollision(() => store.submitCustomerKyc(superadmin, customerId, {
    frontAsset: verificationAsset("global-evidence-unique-front"),
    backAsset: { ...SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront },
    clientMutationId: "global-evidence-kyc-back",
  }));
  expectGlobalCollision(() => store.submitCustomerKyc(superadmin, customerId, {
    frontAsset: verificationAsset("global-evidence-incoming-duplicate"),
    backAsset: verificationAsset("global-evidence-incoming-duplicate"),
    clientMutationId: "global-evidence-kyc-incoming-duplicate",
  }));
  expectGlobalCollision(() => store.signCustomerAgreement(superadmin, customerId, {
    medium: "paper",
    version: "1.3",
    signedBy: "Marcia Reid",
    paperScanAsset: { ...SEED_EVIDENCE_ASSETS.aliciaAgreementSignature },
    clientMutationId: "global-evidence-paper-scan",
  }));

  const paperSuccessInput = {
    medium: "paper" as const,
    version: "1.3",
    signedBy: "Marcia Reid",
    paperScanAsset: verificationAsset("global-evidence-paper-success"),
    clientMutationId: "global-evidence-paper-success",
  };
  const paperSigned = store.signCustomerAgreement(superadmin, customerId, paperSuccessInput);
  const writesAfterPaper = storage.writes;
  const auditsAfterPaper = store.customerAuditHistory(superadmin, customerId);
  expect(store.signCustomerAgreement(superadmin, customerId, paperSuccessInput)).toEqual(paperSigned);
  expect(storage.writes).toBe(writesAfterPaper);
  expect(store.customerAuditHistory(superadmin, customerId)).toEqual(auditsAfterPaper);

  const ownerSigning = store.prepareCustomerAgreementSigning(superadmin, "CUST-UAT-004", {
    version: "1.3",
    signedBy: "Rochelle Grant",
  });
  const ownerSigned = store.signCustomerAgreement(superadmin, "CUST-UAT-004", {
    medium: "electronic",
    version: "1.3",
    signedBy: "Rochelle Grant",
    signatureAsset: verificationAsset("global-evidence-owner-signature", { createdAt: ownerSigning.signedAt }),
    signedDocumentAsset: { ...signedPdfAsset("global-evidence-owner-pdf"), createdAt: ownerSigning.signedAt },
    signingToken: ownerSigning.token,
    clientMutationId: "global-evidence-owner-sign",
  });
  const ownerAgreement = ownerSigned.verificationArchive.agreementRecords.at(-1)!;
  if (ownerAgreement.medium !== "electronic") throw new Error("expected electronic agreement");

  const signatureCollisionSigning = store.prepareCustomerAgreementSigning(superadmin, customerId, {
    version: "1.3",
    signedBy: "Marcia Reid",
  });
  expectGlobalCollision(() => store.signCustomerAgreement(superadmin, customerId, {
    medium: "electronic" as const,
    version: "1.3",
    signedBy: "Marcia Reid",
    signatureAsset: ownerAgreement.signatureAsset,
    signedDocumentAsset: { ...signedPdfAsset("global-evidence-new-pdf"), createdAt: signatureCollisionSigning.signedAt },
    signingToken: signatureCollisionSigning.token,
    clientMutationId: "global-evidence-electronic-signature",
  }));

  const incomingCollisionSigning = store.prepareCustomerAgreementSigning(superadmin, customerId, {
    version: "1.3",
    signedBy: "Marcia Reid",
  });
  expectGlobalCollision(() => store.signCustomerAgreement(superadmin, customerId, {
    medium: "electronic",
    version: "1.3",
    signedBy: "Marcia Reid",
    signatureAsset: verificationAsset("global-evidence-electronic-duplicate", { createdAt: incomingCollisionSigning.signedAt }),
    signedDocumentAsset: { ...signedPdfAsset("global-evidence-electronic-duplicate"), createdAt: incomingCollisionSigning.signedAt },
    signingToken: incomingCollisionSigning.token,
    clientMutationId: "global-evidence-electronic-incoming-duplicate",
  }));

  const retryableSigning = store.prepareCustomerAgreementSigning(superadmin, customerId, {
    version: "1.3",
    signedBy: "Marcia Reid",
  });
  const retryableCollisionInput = {
    medium: "electronic" as const,
    version: "1.3",
    signedBy: "Marcia Reid",
    signatureAsset: verificationAsset("global-evidence-new-signature", { createdAt: retryableSigning.signedAt }),
    signedDocumentAsset: ownerAgreement.signedDocumentAsset,
    signingToken: retryableSigning.token,
    clientMutationId: "global-evidence-electronic-pdf",
  };
  expectGlobalCollision(() => store.signCustomerAgreement(superadmin, customerId, retryableCollisionInput));
  const successInput = {
    ...retryableCollisionInput,
    signatureAsset: verificationAsset("global-evidence-success-signature", { createdAt: retryableSigning.signedAt }),
    signedDocumentAsset: { ...signedPdfAsset("global-evidence-success-pdf"), createdAt: retryableSigning.signedAt },
  };
  const signed = store.signCustomerAgreement(superadmin, customerId, successInput);
  const writesAfterSuccess = storage.writes;
  const auditsAfterSuccess = store.customerAuditHistory(superadmin, customerId);
  expect(store.signCustomerAgreement(superadmin, customerId, successInput)).toEqual(signed);
  expect(storage.writes).toBe(writesAfterSuccess);
  expect(store.customerAuditHistory(superadmin, customerId)).toEqual(auditsAfterSuccess);

  const stateStorage = memoryStorage();
  const stateStore = createMockCustomerVehicleStore({ storage: stateStorage });
  stateStore.requestCustomerOtp(superadmin, customerId, {
    phoneE164: "+18765550195",
    clientMutationId: "global-evidence-state-seed",
  });
  const envelope = JSON.parse(stateStorage.saved!) as { state: { vehicles: Array<{ attachments: EvidenceAsset[] }> } };
  envelope.state.vehicles[0].attachments.push(verificationAsset("global-evidence-vehicle-attachment"));
  const vehicleCollisionStorage = memoryStorage();
  const vehicleCollisionStore = createMockCustomerVehicleStore({
    storage: vehicleCollisionStorage,
    initialState: envelope.state as never,
  });
  const vehicleBefore = vehicleCollisionStore.customer(superadmin, customerId);
  const vehicleAuditsBefore = vehicleCollisionStore.customerAuditHistory(superadmin, customerId);
  expectStoreCode(() => vehicleCollisionStore.submitCustomerKyc(superadmin, customerId, {
    frontAsset: verificationAsset("global-evidence-vehicle-attachment"),
    clientMutationId: "global-evidence-vehicle-collision",
  }), "EVIDENCE_ASSET_INVALID", 409);
  expect(vehicleCollisionStorage.writes).toBe(0);
  expect(vehicleCollisionStore.customer(superadmin, customerId)).toEqual(vehicleBefore);
  expect(vehicleCollisionStore.customerAuditHistory(superadmin, customerId)).toEqual(vehicleAuditsBefore);
});

test("verification request bodies reject unknown branch fields at runtime", () => {
  const store = createMockCustomerVehicleStore();
  expectStoreCode(() => store.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+18765550144",
    clientMutationId: "otp-request-extra-field",
    secret: "data:image/png;base64,PRIVATE_BODY",
  } as never), "CUSTOMER_VERIFICATION_INPUT_INVALID");
  expectStoreCode(() => store.signCustomerAgreement(superadmin, "CUST-UAT-003", {
    medium: "paper",
    version: "1.3",
    signedBy: "Marcia Reid",
    physicalRecordNumber: "PAPER-EXTRA-001",
    physicalStorageLocation: "Cabinet A",
    clientMutationId: "agreement-extra-field",
    unexpectedAssetUrl: "data:image/png;base64,PRIVATE_BODY",
  } as never), "CUSTOMER_VERIFICATION_INPUT_INVALID");
});

test("verification writes reject data-bearing actors and agreement archive text before persist", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  expect(() => store.requestCustomerOtp({
    actorId: "data:image/png;base64,PRIVATE_ACTOR",
    role: "superadmin",
  }, "CUST-UAT-003", {
    phoneE164: "+18765550146",
    clientMutationId: "unsafe-actor",
  })).toThrow(/^401 无效会话$/);
  expect(storage.saved).toBeNull();

  for (const [index, unsafeText] of [
    "data:application/pdf;base64,PRIVATE_VERSION",
    "reviewed | data : image/png;base64,PRIVATE_TEXT",
  ].entries()) {
    const raw = storage.saved;
    expectStoreCode(() => store.signCustomerAgreement(superadmin, "CUST-UAT-003", {
      medium: "paper",
      version: index === 0 ? unsafeText : "1.3",
      signedBy: index === 1 ? unsafeText : "Marcia Reid",
      physicalRecordNumber: "PAPER-SAFE-001",
      physicalStorageLocation: "Cabinet A-01",
      clientMutationId: `agreement-unsafe-text-${index}`,
    }), "AGREEMENT_INPUT_INVALID");
    expect(storage.saved).toBe(raw);
  }

  expectStoreCode(() => store.signCustomerAgreement(superadmin, "CUST-UAT-003", {
    medium: "paper",
    version: "1.3",
    signedBy: "Marcia Reid",
    physicalRecordNumber: "data:application/pdf;base64,PRIVATE_RECORD",
    physicalStorageLocation: "Cabinet A-01",
    clientMutationId: "agreement-unsafe-physical-text",
  }), "AGREEMENT_INPUT_INVALID");
  expect(storage.saved).toBeNull();
});

test("electronic and paper agreement signing enforce their distinct evidence rules", () => {
  const store = createMockCustomerVehicleStore();
  const customerId = "CUST-UAT-003";
  expectStoreCode(() => store.signCustomerAgreement(superadmin, customerId, {
    medium: "electronic",
    version: "1.3",
    signedBy: "Marcia Reid",
    clientMutationId: "agreement-electronic-missing",
  } as never), "AGREEMENT_EVIDENCE_REQUIRED");
  expectStoreCode(() => store.signCustomerAgreement(superadmin, customerId, {
    medium: "paper",
    version: "1.3",
    signedBy: "Marcia Reid",
    clientMutationId: "agreement-paper-missing",
  }), "AGREEMENT_EVIDENCE_REQUIRED");
  expectStoreCode(() => store.signCustomerAgreement(superadmin, customerId, {
    medium: "paper",
    version: "1.3",
    signedBy: "Marcia Reid",
    paperScanAsset: verificationAsset("paper-partial-scan"),
    physicalRecordNumber: "PAPER-2026-001",
    clientMutationId: "agreement-paper-partial-metadata",
  }), "AGREEMENT_EVIDENCE_REQUIRED");

  const signingPreview = store.prepareCustomerAgreementSigning(superadmin, customerId, {
    version: "1.3",
    signedBy: "Marcia Reid",
  });
  const electronic = store.signCustomerAgreement(superadmin, customerId, {
    medium: "electronic",
    version: "1.3",
    signedBy: "Marcia Reid",
    signatureAsset: verificationAsset("agreement-signature", { createdAt: signingPreview.signedAt }),
    signedDocumentAsset: {
      ...signedPdfAsset("agreement-signed-pdf"),
      createdAt: signingPreview.signedAt,
    },
    signingToken: signingPreview.token,
    clientMutationId: "agreement-electronic-valid",
  });
  expect(electronic.verificationArchive.agreementRecords.at(-1)).toMatchObject({
    medium: "electronic",
    version: "1.3",
    recordedBy: superadmin.actorId,
  });
  const paper = store.signCustomerAgreement(superadmin, customerId, {
    medium: "paper",
    version: "1.4",
    signedBy: "Marcia Reid",
    physicalRecordNumber: "PAPER-2026-002",
    physicalStorageLocation: "Front desk cabinet A-03",
    clientMutationId: "agreement-paper-valid",
  });
  expect(paper.verificationArchive.agreementRecords.at(-1)).toMatchObject({
    medium: "paper",
    version: "1.4",
    physicalRecordNumber: "PAPER-2026-002",
    physicalStorageLocation: "Front desk cabinet A-03",
  });
});

test("electronic agreement signing preview is zero-write and binds an authoritative timestamp", () => {
  const storage = memoryStorage();
  const signedAt = "2026-08-13T13:15:00.000Z";
  const store = agreementSigningStore(createMockCustomerVehicleStore({ storage, clock: () => signedAt }));
  const before = store.customer(superadmin, "CUST-UAT-003");
  const auditBefore = store.customerAuditHistory(superadmin, "CUST-UAT-003");

  const preview = store.prepareCustomerAgreementSigning(superadmin, "CUST-UAT-003", {
    version: "1.3",
    signedBy: "Marcia Reid",
  });

  expect(preview.signedAt).toBe(signedAt);
  expect(preview.token).toMatch(/^[0-9a-f-]{20,}$/i);
  expect(storage.saved).toBeNull();
  expect(storage.writes).toBe(0);
  expect(store.customer(superadmin, "CUST-UAT-003")).toEqual(before);
  expect(store.customerAuditHistory(superadmin, "CUST-UAT-003")).toEqual(auditBefore);
});

test("electronic signing receipt rejects forged or cross-bound inputs and exact timestamp mismatches", () => {
  const signedAt = "2026-08-13T13:20:00.000Z";
  const store = agreementSigningStore(createMockCustomerVehicleStore({ clock: () => signedAt }));
  const preview = store.prepareCustomerAgreementSigning(superadmin, "CUST-UAT-003", {
    version: "1.3",
    signedBy: "Marcia Reid",
  });
  const input = {
    medium: "electronic" as const,
    version: "1.3",
    signedBy: "Marcia Reid",
    signatureAsset: verificationAsset("receipt-signature", { createdAt: signedAt }),
    signedDocumentAsset: signedPdfAsset("receipt-pdf"),
    signingToken: preview.token,
    clientMutationId: "receipt-valid",
  };
  input.signedDocumentAsset = { ...input.signedDocumentAsset, createdAt: signedAt };

  for (const [label, access, customerId, overrides] of [
    ["actor", frontdeskAdmin, "CUST-UAT-003", {}],
    ["customer", superadmin, "CUST-UAT-002", {}],
    ["version", superadmin, "CUST-UAT-003", { version: "1.4" }],
    ["signedBy", superadmin, "CUST-UAT-003", { signedBy: "Another Person" }],
    ["token", superadmin, "CUST-UAT-003", { signingToken: "forged-token-value-000000" }],
    ["signature-time", superadmin, "CUST-UAT-003", {
      signatureAsset: { ...input.signatureAsset, createdAt: "2026-08-13T13:19:59.000Z" },
    }],
    ["pdf-time", superadmin, "CUST-UAT-003", {
      signedDocumentAsset: { ...input.signedDocumentAsset, createdAt: "2026-08-13T13:19:59.000Z" },
    }],
  ] as const) {
    expectStoreCode(() => store.signCustomerAgreement(access, customerId, {
      ...input,
      ...overrides,
      clientMutationId: `receipt-invalid-${label}`,
    } as never), "AGREEMENT_SIGNING_TOKEN_INVALID", 409);
  }

  store.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+18765550188",
    clientMutationId: "receipt-revision-change",
  });
  expectStoreCode(() => store.signCustomerAgreement(superadmin, "CUST-UAT-003", {
    ...input,
    clientMutationId: "receipt-stale-revision",
  } as never), "AGREEMENT_SIGNING_TOKEN_INVALID", 409);
});

test("electronic signing receipt survives a write failure, is consumed on success, and preserves idempotent retry", () => {
  const storage = memoryStorage();
  const signedAt = "2026-08-13T13:25:00.000Z";
  const store = agreementSigningStore(createMockCustomerVehicleStore({ storage, clock: () => signedAt }));
  const preview = store.prepareCustomerAgreementSigning(superadmin, "CUST-UAT-003", {
    version: "1.3",
    signedBy: "Marcia Reid",
  });
  const input = {
    medium: "electronic" as const,
    version: "1.3",
    signedBy: "Marcia Reid",
    signatureAsset: verificationAsset("atomic-signature", { createdAt: signedAt }),
    signedDocumentAsset: signedPdfAsset("atomic-pdf"),
    signingToken: preview.token,
    clientMutationId: "atomic-electronic-sign",
  };
  input.signedDocumentAsset = { ...input.signedDocumentAsset, createdAt: signedAt };

  storage.failWrites = true;
  expect(() => store.signCustomerAgreement(superadmin, "CUST-UAT-003", input as never)).toThrow("磁盘写入失败");
  expect(storage.saved).toBeNull();
  storage.failWrites = false;

  const signed = store.signCustomerAgreement(superadmin, "CUST-UAT-003", input as never);
  expect(signed.verificationArchive.agreementRecords.at(-1)).toMatchObject({
    medium: "electronic",
    signedAt,
    signatureAsset: { createdAt: signedAt },
    signedDocumentAsset: { createdAt: signedAt },
  });
  expect(store.signCustomerAgreement(superadmin, "CUST-UAT-003", input as never)).toEqual(signed);
  expectStoreCode(() => store.signCustomerAgreement(superadmin, "CUST-UAT-003", {
    ...input,
    clientMutationId: "atomic-token-reuse",
  } as never), "AGREEMENT_SIGNING_TOKEN_INVALID", 409);
});

test("electronic agreement audit separates receipt signedAt from later commit occurredAt", () => {
  const times = ["2026-08-13T13:30:00.000Z", "2026-08-13T13:31:00.000Z"];
  const store = agreementSigningStore(createMockCustomerVehicleStore({ clock: () => times.shift()! }));
  const preview = store.prepareCustomerAgreementSigning(superadmin, "CUST-UAT-003", {
    version: "1.3",
    signedBy: "Marcia Reid",
  });
  store.signCustomerAgreement(superadmin, "CUST-UAT-003", {
    medium: "electronic",
    version: "1.3",
    signedBy: "Marcia Reid",
    signatureAsset: verificationAsset("audit-time-signature", { createdAt: preview.signedAt }),
    signedDocumentAsset: { ...signedPdfAsset("audit-time-pdf"), createdAt: preview.signedAt },
    signingToken: preview.token,
    clientMutationId: "audit-time-electronic-sign",
  });
  const event = store.customerAuditHistory(superadmin, "CUST-UAT-003")[0];
  expect(event.occurredAt).toBe("2026-08-13T13:31:00.000Z");
  expect(event.changes.find((change) => change.field === "signedAt")?.after).toBe(preview.signedAt);
});

test("agreement signing preview rejects a clock older than the customer or latest agreement without writing", () => {
  for (const [customerId, oldTime] of [
    ["CUST-UAT-003", "2026-08-03T09:59:59.000Z"],
    ["CUST-UAT-001", "2026-05-16T09:59:59.000Z"],
  ] as const) {
    const storage = memoryStorage();
    const store = agreementSigningStore(createMockCustomerVehicleStore({ storage, clock: () => oldTime }));
    expectStoreCode(() => store.prepareCustomerAgreementSigning(superadmin, customerId, {
      version: "1.3",
      signedBy: customerId === "CUST-UAT-001" ? "Alicia Bennett" : "Marcia Reid",
    }), "AGREEMENT_SIGNING_TIME_INVALID", 409);
    expect(storage.saved).toBeNull();
    expect(storage.writes).toBe(0);
  }
});

test("electronic signing rejects a commit clock rollback without consuming its receipt", () => {
  const times = [
    "2026-08-13T13:35:00.000Z",
    "2026-08-13T13:34:59.000Z",
    "2026-08-13T13:36:00.000Z",
  ];
  const storage = memoryStorage();
  const store = agreementSigningStore(createMockCustomerVehicleStore({
    storage,
    clock: () => times.shift()!,
  }));
  const preview = store.prepareCustomerAgreementSigning(superadmin, "CUST-UAT-003", {
    version: "1.3",
    signedBy: "Marcia Reid",
  });
  const input = {
    medium: "electronic" as const,
    version: "1.3",
    signedBy: "Marcia Reid",
    signatureAsset: verificationAsset("rollback-signature", { createdAt: preview.signedAt }),
    signedDocumentAsset: { ...signedPdfAsset("rollback-pdf"), createdAt: preview.signedAt },
    signingToken: preview.token,
    clientMutationId: "rollback-electronic-sign",
  };
  expectStoreCode(() => store.signCustomerAgreement(superadmin, "CUST-UAT-003", input),
    "AGREEMENT_SIGNING_TIME_INVALID", 409);
  expect(storage.saved).toBeNull();
  const signed = store.signCustomerAgreement(superadmin, "CUST-UAT-003", input);
  expect(signed.verificationArchive.agreementRecords.at(-1)?.signedAt).toBe(preview.signedAt);
  expect(signed.updatedAt).toBe("2026-08-13T13:36:00.000Z");
});

test("paper agreement scan succeeds when both physical metadata keys are absent", () => {
  const store = createMockCustomerVehicleStore();
  const input = {
    medium: "paper",
    version: "1.3",
    signedBy: "Marcia Reid",
    paperScanAsset: verificationAsset("paper-scan-without-physical-metadata"),
    clientMutationId: "agreement-paper-scan-without-physical-metadata",
  } as const;
  expect(Object.prototype.hasOwnProperty.call(input, "physicalRecordNumber")).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(input, "physicalStorageLocation")).toBe(false);

  const customer = store.signCustomerAgreement(superadmin, "CUST-UAT-003", input);
  const agreement = customer.verificationArchive.agreementRecords.at(-1);
  expect(agreement).toMatchObject({
    medium: "paper",
    version: "1.3",
    paperScanAsset: { id: "paper-scan-without-physical-metadata" },
  });
  expect(agreement).not.toHaveProperty("physicalRecordNumber");
  expect(agreement).not.toHaveProperty("physicalStorageLocation");
});

test("paper agreement scan rejects explicitly present blank physical metadata atomically", () => {
  const invalidPhysicalMetadata = [
    { physicalRecordNumber: " " },
    { physicalStorageLocation: "\t" },
    { physicalRecordNumber: " ", physicalStorageLocation: "\n" },
  ] as const;

  for (const [index, metadata] of invalidPhysicalMetadata.entries()) {
    const storage = memoryStorage();
    const store = createMockCustomerVehicleStore({ storage });
    const customerId = "CUST-UAT-003";
    const before = store.customer(superadmin, customerId);
    const auditBefore = store.customerAuditHistory(superadmin, customerId);
    expectStoreCode(() => store.signCustomerAgreement(superadmin, customerId, {
      medium: "paper",
      version: "1.3",
      signedBy: "Marcia Reid",
      paperScanAsset: verificationAsset(`paper-blank-physical-${index}`),
      ...metadata,
      clientMutationId: `agreement-paper-blank-physical-${index}`,
    }), "AGREEMENT_EVIDENCE_REQUIRED");
    expect(storage.saved).toBeNull();
    expect(store.customer(superadmin, customerId)).toEqual(before);
    expect(store.customerAuditHistory(superadmin, customerId)).toEqual(auditBefore);
  }
});

test("verification idempotency survives reload, rejects another customer path without PII, and stays atomic on write failure", () => {
  const storage = memoryStorage();
  const first = createMockCustomerVehicleStore({ storage });
  const requested = first.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+18765550128",
    clientMutationId: "shared-idempotency-key",
  });
  const raw = storage.saved;
  const reloaded = createMockCustomerVehicleStore({ storage });
  expect(reloaded.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+18765550128",
    clientMutationId: "shared-idempotency-key",
  })).toEqual(requested);
  let conflict: unknown;
  try {
    reloaded.requestCustomerOtp(superadmin, "CUST-UAT-004", {
      phoneE164: "+18765550129",
      clientMutationId: "shared-idempotency-key",
    });
  } catch (error) {
    conflict = error;
  }
  expect(conflict).toMatchObject({ code: "CUSTOMER_IDEMPOTENCY_CONFLICT", status: 409 });
  expect(String(conflict)).not.toMatch(/Marcia|Seaview|0103|0104|CUST-UAT-003/);
  let missingPathConflict: unknown;
  try {
    reloaded.requestCustomerOtp(superadmin, "CUST-NOT-PRESENT", {
      phoneE164: "+18765550129",
      clientMutationId: "shared-idempotency-key",
    });
  } catch (error) {
    missingPathConflict = error;
  }
  expect(missingPathConflict).toMatchObject({ code: "CUSTOMER_IDEMPOTENCY_CONFLICT", status: 409 });
  expect(String(missingPathConflict)).toBe(String(conflict));
  expect(String(missingPathConflict)).not.toContain("CUST-NOT-PRESENT");
  expect(storage.saved).toBe(raw);

  const beforeFailure = reloaded.customer(superadmin, "CUST-UAT-003");
  const auditsBeforeFailure = reloaded.customerAuditHistory(superadmin, "CUST-UAT-003");
  const writesBeforeFailure = storage.writes;
  storage.failWrites = true;
  expect(() => reloaded.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+18765550130",
    clientMutationId: "otp-request-write-failure",
  })).toThrow("磁盘写入失败");
  expect(storage.saved).toBe(raw);
  expect(reloaded.customer(superadmin, "CUST-UAT-003")).toEqual(beforeFailure);
  expect(reloaded.customerAuditHistory(superadmin, "CUST-UAT-003")).toEqual(auditsBeforeFailure);
  expect(storage.writes).toBe(writesBeforeFailure);

  storage.failWrites = false;
  const recovered = reloaded.requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+18765550130",
    clientMutationId: "otp-request-write-failure",
  });
  expect(recovered.revision).toBe(beforeFailure.revision + 1);
  expect(recovered.verificationArchive.otpRecords).toHaveLength(
    beforeFailure.verificationArchive.otpRecords.length + 1,
  );
  expect(storage.writes).toBe(writesBeforeFailure + 1);
  const rawAfterRecovery = storage.saved;
  expect(createMockCustomerVehicleStore({ storage }).requestCustomerOtp(superadmin, "CUST-UAT-003", {
    phoneE164: "+18765550130",
    clientMutationId: "otp-request-write-failure",
  })).toEqual(recovered);
  expect(storage.saved).toBe(rawAfterRecovery);
  expect(storage.writes).toBe(writesBeforeFailure + 1);
});

test("verification retry rejects a stale persisted result after a later customer mutation", () => {
  const storage = memoryStorage();
  const store = createMockCustomerVehicleStore({ storage });
  const customerId = "CUST-UAT-003";
  store.requestCustomerOtp(superadmin, customerId, {
    phoneE164: "+18765550147",
    clientMutationId: "otp-result-a",
  });
  const later = store.requestCustomerOtp(superadmin, customerId, {
    phoneE164: "+18765550148",
    clientMutationId: "otp-result-b",
  });
  const rawAfterLaterMutation = storage.saved;
  const writesAfterLaterMutation = storage.writes;

  expectStoreCode(() => store.requestCustomerOtp(superadmin, customerId, {
    phoneE164: "+18765550147",
    clientMutationId: "otp-result-a",
  }), "CUSTOMER_IDEMPOTENCY_RESULT_STALE", 409);
  expect(store.customer(superadmin, customerId)).toEqual(later);
  expect(storage.saved).toBe(rawAfterLaterMutation);
  expect(storage.writes).toBe(writesAfterLaterMutation);
});

test("verification audits stay compact, reference only owned evidence IDs, and audit history is filtered, ordered, authorized, and cloned", () => {
  let tick = 0;
  const times = [
    "2026-08-13T12:00:00.000Z",
    "2026-08-13T12:00:01.000Z",
    "2026-08-13T12:00:02.000Z",
  ];
  const store = createMockCustomerVehicleStore({ clock: () => times[Math.min(tick++, times.length - 1)]! });
  const customerId = "CUST-UAT-003";
  const requested = store.requestCustomerOtp(superadmin, customerId, {
    phoneE164: "+18765550131",
    clientMutationId: "audit-otp-request",
  });
  store.verifyCustomerOtp(superadmin, customerId, {
    otpRecordId: requested.verificationArchive.otpRecords.at(-1)!.id,
    code: "123456",
    clientMutationId: "audit-otp-verify",
  });
  const frontAsset = verificationAsset("audit-kyc-front");
  store.submitCustomerKyc(superadmin, customerId, {
    frontAsset,
    clientMutationId: "audit-kyc-submit",
  });

  const history = store.customerAuditHistory(superadmin, customerId);
  expect(history.slice(0, 3).map((event) => event.occurredAt)).toEqual([
    "2026-08-13T12:00:02.000Z",
    "2026-08-13T12:00:01.000Z",
    "2026-08-13T12:00:00.000Z",
  ]);
  expect(history.at(-1)).toMatchObject({ eventType: "migration", occurredAt: "2026-08-09T00:00:00.000Z" });
  expect(history.every((event) => event.customerId === customerId)).toBe(true);
  expect(history.find((event) => event.eventType === "kyc_submitted")?.evidenceAssetIds).toEqual([frontAsset.id]);
  const archive = store.customer(superadmin, customerId).verificationArchive;
  const ownedEvidenceIds = new Set([
    ...archive.kycRecords.flatMap((record) => [record.frontAsset.id, ...(record.backAsset ? [record.backAsset.id] : [])]),
    ...archive.agreementRecords.flatMap((record) => record.medium === "electronic"
      ? [record.signatureAsset.id, record.signedDocumentAsset.id]
      : record.paperScanAsset ? [record.paperScanAsset.id] : []),
  ]);
  for (const evidenceAssetId of history.flatMap((event) => event.evidenceAssetIds)) {
    expect(ownedEvidenceIds.has(evidenceAssetId)).toBe(true);
  }
  const serialized = JSON.stringify(history);
  expect(serialized).not.toContain("data:image");
  expect(serialized).not.toContain("data:application/pdf");
  expect(serialized).not.toContain("123456");
  expect(serialized).not.toContain("verificationArchive");

  (history[0].evidenceAssetIds as string[]).push("caller-only");
  expect(store.customerAuditHistory(superadmin, customerId)[0].evidenceAssetIds).not.toContain("caller-only");
  expect(() => store.customerAuditHistory({ actorId: "emp-004", role: "parts" }, customerId))
    .toThrow(/^403 无权读取客户与车辆完整目录$/);
});

test("verification methods authorize before malformed bodies or customer lookup and require non-empty mutation IDs", () => {
  const store = createMockCustomerVehicleStore();
  const denied = { actorId: "emp-004", role: "parts" };
  for (const operation of [
    () => store.requestCustomerOtp(denied, "CUST-UAT-SECRET", null as never),
    () => store.verifyCustomerOtp(denied, "CUST-UAT-SECRET", null as never),
    () => store.invalidateCustomerOtp(denied, "CUST-UAT-SECRET", null as never),
    () => store.submitCustomerKyc(denied, "CUST-UAT-SECRET", null as never),
    () => store.verifyCustomerKyc(denied, "CUST-UAT-SECRET", null as never),
    () => store.signCustomerAgreement(denied, "CUST-UAT-SECRET", null as never),
    () => store.customerAuditHistory(denied, "CUST-UAT-SECRET"),
  ]) expect(operation).toThrow(/^403 无权读取客户与车辆完整目录$/);

  expectStoreCode(() => store.requestCustomerOtp(superadmin, "CUST-UAT-404", {
    phoneE164: "+18765550132",
    clientMutationId: " ",
  }), "CUSTOMER_MUTATION_ID_REQUIRED");
  expectStoreCode(() => store.requestCustomerOtp(superadmin, "CUST-UAT-404", {
    phoneE164: "+18765550132",
    clientMutationId: "missing-customer",
  }), "CUSTOMER_NOT_FOUND", 404);
});
