import {
  transliterateCustomerName,
  type CustomerNameResult,
} from "./name-transliteration";
import { APPROVED_FULL_NAME_PAIRS } from "./name-dictionary";

export interface CanonicalCustomerIdentity {
  readonly id: string;
  readonly kind: "individual" | "organization";
  readonly organizationName: string | null;
  readonly contactName: CustomerNameResult;
  readonly phone: string | null;
  readonly email: string | null;
}

export interface CanonicalVehicleIdentity {
  readonly id: string;
  readonly currentCustomerId: string;
  readonly plate: string;
  readonly modelZh: string | null;
  readonly modelEn: string;
}

export interface CanonicalOperationIdentity {
  readonly sequence: number;
  readonly orderId: string;
  readonly customerId: string;
  readonly vehicleId: string;
}

export interface CanonicalRelationshipIdentity {
  readonly id: string;
  readonly customerId: string;
  readonly vehicleId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

const BULK_CUSTOMER_COUNT = 296;
const BULK_VEHICLE_COUNT = 320;
const BULK_OPERATION_COUNT = 300;
const bulkId = (prefix: "CUST" | "VEH", index: number) => `${prefix}-BULK-${String(index).padStart(3, "0")}`;
const operationId = (sequence: number) => `order-demo-${String(sequence).padStart(2, "0")}`;

const FIRST_TEN = [
  ["陈美玲", "+1 876-555-0101", "8765 JZ", "丰田海狮", "Toyota Hiace"],
  ["戴维·布莱克", "+1 876-555-0102", "4321 AB", "日产奇骏", "Nissan X-Trail"],
  ["王小梅", "+1 876-555-0103", "P 1234", "本田飞度", "Honda Fit"],
  ["安东尼·格兰特", "+1 876-555-0104", "7788 KM", "铃木雨燕", "Suzuki Swift"],
  ["李志强", "+1 876-555-0105", "CC 9087", "丰田卡罗拉", "Toyota Corolla"],
  ["克里斯托弗·杨", "+1 876-555-0106", "9123 HG", "三菱L200", "Mitsubishi L200"],
  ["格雷斯·约翰逊", "+1 876-555-0107", "5678 DR", "起亚狮跑", "Kia Sportage"],
  ["彼得·摩根", "+1 876-555-0108", "EQ 5501", "小松挖掘机", "Komatsu Excavator"],
  ["莎拉·威廉姆斯", "+1 876-555-0109", "PA 6654", "马自达CX-5", "Mazda CX-5"],
  ["迈克尔·史密斯", "+1 876-555-0110", "BS 2048", "现代途胜", "Hyundai Tucson"],
] as const;

const GENERIC_MODELS = [
  ["丰田 卡罗拉", "Toyota Corolla"], ["丰田 Axio", "Toyota Axio"], ["丰田 海狮", "Toyota Hiace"],
  ["本田 CR-V", "Honda CR-V"], ["本田 飞度", "Honda Fit"], ["日产 Note", "Nissan Note"],
  ["铃木 雨燕", "Suzuki Swift"], ["马自达 Demio", "Mazda Demio"], ["现代 途胜", "Hyundai Tucson"],
] as const;

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function frozenCustomer(value: CanonicalCustomerIdentity): CanonicalCustomerIdentity {
  return frozen({
    ...value,
    contactName: frozen({ ...value.contactName }),
  });
}

function approvedName(index: number): CustomerNameResult {
  return transliterateCustomerName(APPROVED_FULL_NAME_PAIRS[index % APPROVED_FULL_NAME_PAIRS.length]!.zh);
}

const bulkCustomers = Array.from({ length: BULK_CUSTOMER_COUNT }, (_, offset) => {
  const index = offset + 1;
  const anchor = FIRST_TEN[offset];
  const contactName = anchor ? transliterateCustomerName(anchor[0]) : approvedName(offset + 10);
  const kind = index % 4 === 0 ? "organization" as const : "individual" as const;
  return frozenCustomer({
    id: bulkId("CUST", index),
    kind,
    organizationName: kind === "organization" ? `Synthetic bulk organization ${index}` : null,
    contactName,
    phone: anchor?.[1] ?? `+1 876 ${300 + ((index * 37) % 600)} ${String(1000 + ((index * 7919) % 9000))}`,
    email: `bulk${index}@synthetic.example`,
  });
});

const uatCustomers = [
  frozenCustomer({ id: "CUST-UAT-001", kind: "individual" as const, organizationName: null, contactName: transliterateCustomerName("艾丽西亚·贝内特"), phone: "+1 876 555 0101", email: "alicia.bennett@synthetic.example" }),
  frozenCustomer({ id: "CUST-UAT-002", kind: "organization" as const, organizationName: "North Coast Logistics Ltd", contactName: transliterateCustomerName("Dwayne Clarke"), phone: "+1 876 555 0102", email: "service@northcoast.synthetic.example" }),
  frozenCustomer({ id: "CUST-UAT-003", kind: "individual" as const, organizationName: null, contactName: transliterateCustomerName("Marcia Reid"), phone: null, email: "marcia.reid@synthetic.example" }),
  frozenCustomer({ id: "CUST-UAT-004", kind: "organization" as const, organizationName: "Seaview Villas Group", contactName: transliterateCustomerName("Rochelle Grant"), phone: "+1 876 555 0104", email: "frontdesk@seaview.synthetic.example" }),
] as const;

export const CANONICAL_CUSTOMERS: readonly CanonicalCustomerIdentity[] = Object.freeze([...uatCustomers, ...bulkCustomers]);

const bulkVehicles = Array.from({ length: BULK_VEHICLE_COUNT }, (_, offset) => {
  const index = offset + 1;
  const anchor = FIRST_TEN[offset];
  const model = GENERIC_MODELS[offset % GENERIC_MODELS.length]!;
  return frozen({
    id: bulkId("VEH", index),
    currentCustomerId: bulkId("CUST", ((offset % BULK_CUSTOMER_COUNT) + 1)),
    plate: anchor?.[2] ?? `${1000 + ((index * 4079) % 9000)} ${"ABCDEFGHJKLMNPQRSTUVWXYZ"[index % 23]}${"ABCDEFGHJKLMNPQRSTUVWXYZ"[(index * 7) % 23]}`,
    modelZh: anchor?.[3] ?? model[0],
    modelEn: anchor?.[4] ?? model[1],
  });
});

const uatVehicles = [
  frozen({ id: "VEH-UAT-001", currentCustomerId: "CUST-UAT-001", plate: "7012 AB", modelZh: "本田 CR-V", modelEn: "Honda CR-V" }),
  frozen({ id: "VEH-UAT-002", currentCustomerId: "CUST-UAT-002", plate: "4789 CP", modelZh: "丰田 海狮", modelEn: "Toyota HiAce" }),
  frozen({ id: "VEH-UAT-003", currentCustomerId: "CUST-UAT-002", plate: "9154 DZ", modelZh: null, modelEn: "BMW X5" }),
  frozen({ id: "VEH-UAT-004", currentCustomerId: "CUST-UAT-004", plate: "0317 EV", modelZh: "日产 Note", modelEn: "Nissan Note" }),
] as const;

export const CANONICAL_VEHICLES: readonly CanonicalVehicleIdentity[] = Object.freeze([...uatVehicles, ...bulkVehicles]);

export const CANONICAL_RELATIONSHIPS: readonly CanonicalRelationshipIdentity[] = Object.freeze([
  frozen({ id: "REL-UAT-001", customerId: "CUST-UAT-001", vehicleId: "VEH-UAT-001", startedAt: "2025-01-14T09:00:00.000Z", endedAt: null }),
  frozen({ id: "REL-UAT-002", customerId: "CUST-UAT-002", vehicleId: "VEH-UAT-002", startedAt: "2025-03-20T09:00:00.000Z", endedAt: null }),
  frozen({ id: "REL-UAT-003", customerId: "CUST-UAT-003", vehicleId: "VEH-UAT-003", startedAt: "2025-02-01T09:00:00.000Z", endedAt: "2026-01-31T18:00:00.000Z" }),
  frozen({ id: "REL-UAT-004", customerId: "CUST-UAT-001", vehicleId: "VEH-UAT-003", startedAt: "2026-02-01T09:00:00.000Z", endedAt: "2026-07-01T00:00:00.000Z" }),
  frozen({ id: "REL-UAT-005", customerId: "CUST-UAT-002", vehicleId: "VEH-UAT-003", startedAt: "2026-07-01T00:00:00.000Z", endedAt: null }),
  frozen({ id: "REL-UAT-006", customerId: "CUST-UAT-004", vehicleId: "VEH-UAT-004", startedAt: "2025-07-19T09:00:00.000Z", endedAt: null }),
  ...bulkVehicles.map((vehicle, offset) => frozen({ id: `REL-BULK-${String(offset + 1).padStart(3, "0")}`, customerId: vehicle.currentCustomerId, vehicleId: vehicle.id, startedAt: "2026-01-15T09:00:00.000Z", endedAt: null })),
]);

export const CANONICAL_OPERATIONS: readonly CanonicalOperationIdentity[] = Object.freeze(Array.from(
  { length: BULK_OPERATION_COUNT },
  (_, offset) => {
    const sequence = offset + 1;
    const reservedForAlicia = sequence >= 11 && sequence <= 24;
    const catalogIndex = sequence <= 10 ? sequence : sequence - 14;
    return frozen({
      sequence,
      orderId: operationId(sequence),
      customerId: reservedForAlicia ? "CUST-UAT-001" : bulkId("CUST", catalogIndex),
      vehicleId: reservedForAlicia ? "VEH-UAT-001" : bulkId("VEH", catalogIndex),
    });
  },
));

function required<T>(value: T | undefined, id: string): T {
  if (!value) throw new Error(`缺少 canonical identity: ${id}`);
  return value;
}

export function canonicalCustomerById(id: string): CanonicalCustomerIdentity {
  return required(CANONICAL_CUSTOMERS.find((item) => item.id === id), id);
}

export function canonicalVehicleById(id: string): CanonicalVehicleIdentity {
  return required(CANONICAL_VEHICLES.find((item) => item.id === id), id);
}

export function operationIdentityForSequence(sequence: number): CanonicalOperationIdentity {
  return required(CANONICAL_OPERATIONS.find((item) => item.sequence === sequence), String(sequence));
}
