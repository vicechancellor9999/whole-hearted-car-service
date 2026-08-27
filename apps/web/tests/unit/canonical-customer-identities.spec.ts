import { expect, test } from "@playwright/test";
import {
  CANONICAL_CUSTOMERS,
  CANONICAL_OPERATIONS,
  CANONICAL_RELATIONSHIPS,
  CANONICAL_VEHICLES,
  canonicalCustomerById,
  canonicalVehicleById,
  operationIdentityForSequence,
} from "../../src/lib/customers/canonical-identities";
import { generateBulkCustomers, generateBulkOrderSeeds, generateBulkVehicles } from "../../src/lib/api/mock-bulk-seed";
import { transliterateCustomerName } from "../../src/lib/customers/name-transliteration";
import {
  ORDER_DEMO_SEED,
  ORDER_DEMO_SEED_META,
  assertCanonicalSeedIdentity,
  createSeedOrder,
  type SeedInput,
} from "../../src/lib/orders/seed";

test("every operation identity references a canonical customer and vehicle", () => {
  const customerIds = new Set(CANONICAL_CUSTOMERS.map((item) => item.id));
  const vehicleIds = new Set(CANONICAL_VEHICLES.map((item) => item.id));

  for (const operation of CANONICAL_OPERATIONS) {
    expect(customerIds.has(operation.customerId), operation.orderId).toBe(true);
    expect(vehicleIds.has(operation.vehicleId), operation.orderId).toBe(true);
  }
});

test("canonical catalogs have stable cardinality and unique operation keys", () => {
  expect(CANONICAL_CUSTOMERS).toHaveLength(300);
  expect(CANONICAL_VEHICLES).toHaveLength(324);
  expect(CANONICAL_OPERATIONS).toHaveLength(300);
  expect(new Set(CANONICAL_OPERATIONS.map((item) => item.sequence)).size).toBe(300);
  expect(new Set(CANONICAL_OPERATIONS.map((item) => item.orderId)).size).toBe(300);
  expect(new Set(CANONICAL_OPERATIONS.map((item) => item.customerId)).size).toBe(287);
  expect(new Set(CANONICAL_OPERATIONS.map((item) => item.vehicleId)).size).toBe(287);
  expect(CANONICAL_RELATIONSHIPS).toHaveLength(326);
  expect(new Set(CANONICAL_RELATIONSHIPS.map((item) => item.id)).size).toBe(326);
});

test("Alicia owns exactly the fourteen reserved demo operations", () => {
  const alicia = CANONICAL_OPERATIONS.filter(
    (item) => item.customerId === "CUST-UAT-001",
  );
  expect(alicia.map((item) => item.orderId)).toEqual(
    Array.from({ length: 14 }, (_, index) => `order-demo-${index + 11}`),
  );
  expect(new Set(alicia.map((item) => item.vehicleId))).toEqual(
    new Set(["VEH-UAT-001"]),
  );
});

test("preserves the first ten identity anchors while normalizing bilingual names", () => {
  const anchors = [
    [1, "order-demo-01", "CUST-BULK-001", "VEH-BULK-001", "陈美玲", "Chen Meiling", "+1 876-555-0101", "8765 JZ", "丰田海狮", "Toyota Hiace"],
    [2, "order-demo-02", "CUST-BULK-002", "VEH-BULK-002", "戴维·布莱克", "David Blake", "+1 876-555-0102", "4321 AB", "日产奇骏", "Nissan X-Trail"],
    [3, "order-demo-03", "CUST-BULK-003", "VEH-BULK-003", "王小梅", "Wang Xiaomei", "+1 876-555-0103", "P 1234", "本田飞度", "Honda Fit"],
    [4, "order-demo-04", "CUST-BULK-004", "VEH-BULK-004", "安东尼·格兰特", "Anthony Grant", "+1 876-555-0104", "7788 KM", "铃木雨燕", "Suzuki Swift"],
    [5, "order-demo-05", "CUST-BULK-005", "VEH-BULK-005", "李志强", "Li Zhiqiang", "+1 876-555-0105", "CC 9087", "丰田卡罗拉", "Toyota Corolla"],
    [6, "order-demo-06", "CUST-BULK-006", "VEH-BULK-006", "克里斯托弗·杨", "Christopher Young", "+1 876-555-0106", "9123 HG", "三菱L200", "Mitsubishi L200"],
    [7, "order-demo-07", "CUST-BULK-007", "VEH-BULK-007", "格雷斯·约翰逊", "Grace Johnson", "+1 876-555-0107", "5678 DR", "起亚狮跑", "Kia Sportage"],
    [8, "order-demo-08", "CUST-BULK-008", "VEH-BULK-008", "彼得·摩根", "Peter Morgan", "+1 876-555-0108", "EQ 5501", "小松挖掘机", "Komatsu Excavator"],
    [9, "order-demo-09", "CUST-BULK-009", "VEH-BULK-009", "莎拉·威廉姆斯", "Sarah Williams", "+1 876-555-0109", "PA 6654", "马自达CX-5", "Mazda CX-5"],
    [10, "order-demo-10", "CUST-BULK-010", "VEH-BULK-010", "迈克尔·史密斯", "Michael Smith", "+1 876-555-0110", "BS 2048", "现代途胜", "Hyundai Tucson"],
  ] as const;
  anchors.forEach(([sequence, orderId, customerId, vehicleId, nameZh, nameEn, phone, plate, modelZh, modelEn]) => {
    const operation = operationIdentityForSequence(sequence);
    const seed = ORDER_DEMO_SEED.find((item) => item.id === orderId)!;
    expect(operation).toEqual({ sequence, orderId, customerId, vehicleId });
    expect(canonicalCustomerById(operation.customerId).contactName).toMatchObject({ nameZh, nameEn });
    expect(canonicalCustomerById(operation.customerId).phone).toBe(phone);
    expect(canonicalVehicleById(operation.vehicleId)).toMatchObject({ plate, modelZh, modelEn });
    expect(seed.customer).toEqual({ id: customerId, nameZh, nameEn, phone });
    expect(seed.vehicle).toEqual({ id: vehicleId, plate, modelZh, modelEn });
  });
});

test("retains Alicia's historical VEH-UAT-003 relationship", () => {
  expect(CANONICAL_RELATIONSHIPS).toContainEqual({
    id: "REL-UAT-004",
    customerId: "CUST-UAT-001",
    vehicleId: "VEH-UAT-003",
    startedAt: "2026-02-01T09:00:00.000Z",
    endedAt: "2026-07-01T00:00:00.000Z",
  });
});

test("locks all six UAT relationship anchors", () => {
  expect(CANONICAL_RELATIONSHIPS.filter((item) => item.id.startsWith("REL-UAT-"))).toEqual([
    { id: "REL-UAT-001", customerId: "CUST-UAT-001", vehicleId: "VEH-UAT-001", startedAt: "2025-01-14T09:00:00.000Z", endedAt: null },
    { id: "REL-UAT-002", customerId: "CUST-UAT-002", vehicleId: "VEH-UAT-002", startedAt: "2025-03-20T09:00:00.000Z", endedAt: null },
    { id: "REL-UAT-003", customerId: "CUST-UAT-003", vehicleId: "VEH-UAT-003", startedAt: "2025-02-01T09:00:00.000Z", endedAt: "2026-01-31T18:00:00.000Z" },
    { id: "REL-UAT-004", customerId: "CUST-UAT-001", vehicleId: "VEH-UAT-003", startedAt: "2026-02-01T09:00:00.000Z", endedAt: "2026-07-01T00:00:00.000Z" },
    { id: "REL-UAT-005", customerId: "CUST-UAT-002", vehicleId: "VEH-UAT-003", startedAt: "2026-07-01T00:00:00.000Z", endedAt: null },
    { id: "REL-UAT-006", customerId: "CUST-UAT-004", vehicleId: "VEH-UAT-004", startedAt: "2025-07-19T09:00:00.000Z", endedAt: null },
  ]);
});

test("relationships reference canonical identities and never overlap for one vehicle", () => {
  const customers = new Set(CANONICAL_CUSTOMERS.map((item) => item.id));
  const vehicles = new Set(CANONICAL_VEHICLES.map((item) => item.id));
  for (const relationship of CANONICAL_RELATIONSHIPS) {
    expect(customers.has(relationship.customerId)).toBe(true);
    expect(vehicles.has(relationship.vehicleId)).toBe(true);
    expect(Date.parse(relationship.startedAt)).not.toBeNaN();
    if (relationship.endedAt !== null) {
      expect(Date.parse(relationship.endedAt)).toBeGreaterThan(Date.parse(relationship.startedAt));
    }
  }
  for (const vehicleId of vehicles) {
    const relationships = CANONICAL_RELATIONSHIPS
      .filter((item) => item.vehicleId === vehicleId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    relationships.slice(1).forEach((relationship, index) => {
      const preceding = relationships[index]!;
      expect(preceding.endedAt === null || preceding.endedAt <= relationship.startedAt).toBe(true);
    });
  }
});

test("every bilingual canonical personal name is produced by one approved rule", () => {
  for (const customer of CANONICAL_CUSTOMERS) {
    const name = customer.contactName;
    expect(transliterateCustomerName(name.sourceValue)).toEqual(name);
  }
});

test("catalog identity tuples are deeply immutable", () => {
  const customer = canonicalCustomerById("CUST-BULK-001");
  const originalName = customer.contactName.nameEn;
  expect(Object.isFrozen(customer)).toBe(true);
  expect(Object.isFrozen(customer.contactName)).toBe(true);
  expect(() => {
    (customer.contactName as { nameEn: string }).nameEn = "tampered";
  }).toThrow(TypeError);
  expect(customer.contactName.nameEn).toBe(originalName);
});

test("does not declare an independent demo customer directory", () => {
  expect(ORDER_DEMO_SEED_META).not.toHaveProperty("kind", "independent_demo");
});

test("bulk profile generators consume canonical kind, organization, and vehicle ownership facts", () => {
  const customers = generateBulkCustomers(296);
  for (const customer of customers) {
    const canonical = canonicalCustomerById(customer.id);
    expect(customer.customerType).toBe(canonical.kind);
    expect(customer.organizationName).toBe(canonical.organizationName);
    expect(customer.name).toBe(canonical.contactName.nameEn);
    expect(customer.nameZh).toBe(canonical.kind === "organization" ? null : canonical.contactName.nameZh);
    expect(customer.phone).toBe(canonical.phone);
    expect(customer.email).toBe(canonical.email);
  }

  const vehicles = generateBulkVehicles(320, customers.map((customer) => customer.id));
  for (const vehicle of vehicles) {
    const canonical = canonicalVehicleById(vehicle.id);
    expect(vehicle.customerId).toBe(canonical.currentCustomerId);
    expect(vehicle.plate).toBe(canonical.plate);
    expect([vehicle.makeZh, vehicle.modelZh].filter(Boolean).join(" ")).toBe(canonical.modelZh ?? "");
    expect(`${vehicle.make}${vehicle.model ? ` ${vehicle.model}` : ""}`).toBe(canonical.modelEn);
  }
  expect(() => generateBulkVehicles(1, [])).toThrow("missing canonical vehicle customer: CUST-BULK-001");
  expect(() => generateBulkVehicles(1, ["CUST-UAT-001"])).toThrow("unexpected customer id");
});

test("all order snapshots are exact canonical identities and mismatches fail fast", () => {
  for (const order of ORDER_DEMO_SEED) {
    const sequence = Number(order.id.replace("order-demo-", ""));
    const operation = operationIdentityForSequence(sequence);
    const customer = canonicalCustomerById(operation.customerId);
    const vehicle = canonicalVehicleById(operation.vehicleId);
    expect(order.id).toBe(operation.orderId);
    expect(order.customer).toEqual({
      id: customer.id,
      nameZh: customer.contactName.nameZh ?? customer.contactName.nameEn,
      nameEn: customer.contactName.nameEn,
      phone: customer.phone ?? "",
    });
    expect(order.vehicle).toEqual({
      id: vehicle.id,
      plate: vehicle.plate,
      ...(vehicle.modelZh ? { modelZh: vehicle.modelZh } : {}),
      modelEn: vehicle.modelEn,
    });
  }
  expect(() => assertCanonicalSeedIdentity({
    sequence: 1,
    customerId: "CUST-BULK-001",
    vehicleId: "VEH-BULK-001",
    customerNameZh: "陈美玲",
    customerNameEn: "Meiling Chen",
    phone: "+1 876-555-0101",
    plate: "8765 JZ",
    modelZh: "丰田海狮",
    modelEn: "Toyota Hiace",
  })).toThrow("canonical seed identity mismatch: customerNameEn");
});

test("shared Alicia vehicle receives its deterministic generated initial team without a hard-coded t1 override", () => {
  const reserved = generateBulkOrderSeeds(14);
  expect(new Set(reserved.map((seed) => seed.vehicleId))).toEqual(new Set(["VEH-UAT-001"]));
  expect(new Set(reserved.map((seed) => seed.teamId))).toEqual(new Set(["t2"]));
  expect(reserved[0]?.teamId).not.toBe("t1");
});

test("createSeedOrder preserves explicit payments and refunds without net-paid fallback", () => {
  const operation = operationIdentityForSequence(11);
  const customer = canonicalCustomerById(operation.customerId);
  const vehicle = canonicalVehicleById(operation.vehicleId);
  const input: SeedInput = {
    sequence: 11,
    customerId: customer.id,
    vehicleId: vehicle.id,
    customerNameZh: customer.contactName.nameZh,
    customerNameEn: customer.contactName.nameEn,
    phone: customer.phone ?? "",
    plate: vehicle.plate,
    modelZh: vehicle.modelZh,
    modelEn: vehicle.modelEn,
    laborName: "测试维修项目",
    laborJmd: 12_345,
    netPaidJmd: 99_999,
    payments: [{ id: "payment-explicit", amountJmd: 12_000 }],
    refunds: [{ id: "refund-explicit", amountJmd: 345 }],
    updatedBy: "test",
    updatedAt: "2026-08-09T16:00:00-05:00",
  };
  const order = createSeedOrder(input);
  expect(order.payments).toEqual(input.payments);
  expect(order.refunds).toEqual(input.refunds);
  expect(order.payments).toHaveLength(1);
  expect(order.refunds).toHaveLength(1);
  expect(order.payments[0]).not.toBe(input.payments![0]);
  expect(order.refunds[0]).not.toBe(input.refunds![0]);
  order.payments[0]!.amountJmd = 7_777;
  order.refunds[0]!.amountJmd = 222;
  expect(input.payments![0]!.amountJmd).toBe(12_000);
  expect(input.refunds![0]!.amountJmd).toBe(345);
  input.payments![0]!.amountJmd = 6_666;
  input.refunds![0]!.amountJmd = 111;
  expect(order.payments[0]!.amountJmd).toBe(7_777);
  expect(order.refunds[0]!.amountJmd).toBe(222);
  expect(() => createSeedOrder({ ...input, plate: "tampered" })).toThrow("canonical seed identity mismatch: plate");
});
