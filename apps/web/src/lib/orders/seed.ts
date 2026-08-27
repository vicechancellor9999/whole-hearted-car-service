import type {
  InspectionQuoteVersionLabel,
  OrderRecord,
  OrderTeamId,
} from "./types";
import { formatBusinessOrderNo, formatInspectionReportNo } from "./document-number";
import { generateBulkOrderSeeds } from "../api/mock-bulk-seed";
import {
  canonicalCustomerById,
  canonicalVehicleById,
  operationIdentityForSequence,
} from "../customers/canonical-identities";

export const ORDER_DEMO_SEED_META = {
  id: "orders-demo-v1",
  kind: "canonical_catalog",
  dashboardReconciled: false,
} as const;

export interface SeedInput {
  sequence: number;
  customerId: string;
  vehicleId: string;
  customerNameZh: string | null;
  customerNameEn: string;
  phone: string;
  plate: string;
  modelZh: string | null;
  modelEn: string;
  laborName: string;
  laborJmd: number;
  partName?: string;
  partsJmd?: number;
  parkingFeeJmd?: number;
  netPaidJmd?: number;
  payments?: readonly { id: string; amountJmd: number }[];
  refunds?: readonly { id: string; amountJmd: number }[];
  teamId?: OrderTeamId;
  mechanicNames?: string[];
  acceptedAt?: string;
  returnedAt?: string;
  submittedAt?: string;
  pickedUpAt?: string;
  updatedBy: string;
  updatedAt: string;
}

type SeedBusinessInput = Omit<SeedInput, "customerId" | "vehicleId" | "customerNameZh" | "customerNameEn" | "phone" | "plate" | "modelZh" | "modelEn">;
type SeedIdentityInput = Pick<SeedInput, "sequence" | "customerId" | "vehicleId" | "customerNameZh" | "customerNameEn" | "phone" | "plate" | "modelZh" | "modelEn">;

export function assertCanonicalSeedIdentity(input: SeedIdentityInput): void {
  const operation = operationIdentityForSequence(input.sequence);
  const customer = canonicalCustomerById(operation.customerId);
  const vehicle = canonicalVehicleById(operation.vehicleId);
  const expected: Omit<SeedIdentityInput, "sequence"> = {
    customerId: operation.customerId,
    vehicleId: operation.vehicleId,
    customerNameZh: customer.contactName.nameZh,
    customerNameEn: customer.contactName.nameEn,
    phone: customer.phone ?? "",
    plate: vehicle.plate,
    modelZh: vehicle.modelZh,
    modelEn: vehicle.modelEn,
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (input[key] !== expected[key]) throw new Error(`canonical seed identity mismatch: ${key}`);
  }
}

function withCanonicalIdentity(input: SeedBusinessInput): SeedInput {
  const operation = operationIdentityForSequence(input.sequence);
  const customer = canonicalCustomerById(operation.customerId);
  const vehicle = canonicalVehicleById(operation.vehicleId);
  return {
    ...input,
    customerId: operation.customerId,
    vehicleId: operation.vehicleId,
    customerNameZh: customer.contactName.nameZh,
    customerNameEn: customer.contactName.nameEn,
    phone: customer.phone ?? "",
    plate: vehicle.plate,
    modelZh: vehicle.modelZh,
    modelEn: vehicle.modelEn,
  };
}

export function createSeedOrder(input: SeedInput): OrderRecord {
  const suffix = String(input.sequence).padStart(2, "0");
  const documentSequence = 19_421 + input.sequence;
  const operation = operationIdentityForSequence(input.sequence);
  const customer = canonicalCustomerById(operation.customerId);
  const vehicle = canonicalVehicleById(operation.vehicleId);
  assertCanonicalSeedIdentity(input);
  const netPaidJmd = input.netPaidJmd ?? 0;
  const sourceVersions: readonly InspectionQuoteVersionLabel[] = ["V1", "V2", "V3"];
  const sourceVersion = sourceVersions[(input.sequence - 1) % sourceVersions.length] ?? "V1";
  return {
    id: operation.orderId,
    orderNo: formatBusinessOrderNo({
      branchCode: "KGN",
      brandCode: "WH",
      businessDate: "20260809",
      sequence: documentSequence,
    }),
    createdAt: `2026-08-09T${String(7 + Math.min(input.sequence, 9)).padStart(2, "0")}:00:00-05:00`,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
    customer: {
      id: operation.customerId,
      nameZh: customer.contactName.nameZh ?? customer.contactName.nameEn,
      nameEn: customer.contactName.nameEn,
      phone: customer.phone ?? "",
    },
    vehicle: {
      id: operation.vehicleId,
      plate: vehicle.plate,
      ...(vehicle.modelZh ? { modelZh: vehicle.modelZh } : {}),
      modelEn: vehicle.modelEn,
    },
    laborItems: [{
      id: `labor-demo-${suffix}`,
      name: input.laborName,
      amountJmd: input.laborJmd,
    }],
    partItems: input.partName ? [{
      id: `part-demo-${suffix}`,
      name: input.partName,
      amountJmd: input.partsJmd ?? 0,
    }] : [],
    parkingFeeJmd: input.parkingFeeJmd ?? 0,
    payments: input.payments ? input.payments.map((event) => ({ ...event })) : netPaidJmd >= 0 ? [{ id: `payment-demo-${suffix}`, amountJmd: netPaidJmd }] : [],
    refunds: input.refunds ? input.refunds.map((event) => ({ ...event })) : netPaidJmd < 0 ? [{ id: `refund-demo-${suffix}`, amountJmd: -netPaidJmd }] : [],
    sourceInspection: Object.freeze({
      reportNo: formatInspectionReportNo({
        branchCode: "KGN",
        brandCode: "WH",
        businessDate: "20260809",
        sequence: documentSequence,
      }),
      version: sourceVersion,
      inspectorTeamId: input.teamId ?? "t1",
    }),
    ...(input.teamId ? { teamId: input.teamId } : {}),
    mechanics: (input.mechanicNames ?? []).map((name, index) => ({
      id: `mechanic-demo-${suffix}-${index + 1}`,
      name,
    })),
    ...(input.acceptedAt ? { acceptedAt: input.acceptedAt } : {}),
    ...(input.returnedAt ? { returnedAt: input.returnedAt } : {}),
    ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
    ...(input.pickedUpAt ? { pickedUpAt: input.pickedUpAt } : {}),
  };
}

export const ORDER_DEMO_SEED: readonly OrderRecord[] = [
  createSeedOrder(withCanonicalIdentity({
    sequence: 1,
    laborName: "发动机诊断",
    laborJmd: 12_000,
    partName: "机油滤芯",
    partsJmd: 3_500,
    updatedBy: "王建华",
    updatedAt: "2026-08-09T15:55:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 2,
    laborName: "制动系统检查",
    laborJmd: 18_000,
    partName: "前刹车片",
    partsJmd: 10_000,
    netPaidJmd: 5_000,
    teamId: "t1",
    updatedBy: "王建华",
    updatedAt: "2026-08-09T15:40:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 3,
    laborName: "空调系统维修",
    laborJmd: 22_000,
    partName: "空调压缩机",
    partsJmd: 18_000,
    parkingFeeJmd: 1_000,
    netPaidJmd: 20_000,
    teamId: "t1",
    mechanicNames: ["Marcus Brown", "David Williams"],
    acceptedAt: "2026-08-09T09:10:00-05:00",
    updatedBy: "Marcus Brown",
    updatedAt: "2026-08-09T15:25:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 4,
    laborName: "转向系统检修",
    laborJmd: 10_000,
    partName: "转向拉杆球头",
    partsJmd: 7_500,
    netPaidJmd: 10_000,
    teamId: "t1",
    mechanicNames: ["Marcus Brown"],
    acceptedAt: "2026-08-09T08:50:00-05:00",
    returnedAt: "2026-08-09T14:45:00-05:00",
    updatedBy: "Marcus Brown",
    updatedAt: "2026-08-09T15:10:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 5,
    laborName: "定期保养",
    laborJmd: 18_000,
    partName: "保养材料包",
    partsJmd: 12_000,
    netPaidJmd: 30_000,
    teamId: "t2",
    mechanicNames: ["Owen Campbell"],
    acceptedAt: "2026-08-09T08:30:00-05:00",
    returnedAt: "2026-08-09T12:00:00-05:00",
    submittedAt: "2026-08-09T14:30:00-05:00",
    updatedBy: "王建华",
    updatedAt: "2026-08-09T14:55:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 6,
    laborName: "底盘异响检修",
    laborJmd: 25_000,
    partName: "悬挂胶套",
    partsJmd: 5_000,
    netPaidJmd: 20_000,
    teamId: "t2",
    mechanicNames: ["Owen Campbell"],
    acceptedAt: "2026-08-09T08:20:00-05:00",
    returnedAt: "2026-08-09T11:40:00-05:00",
    submittedAt: "2026-08-09T13:30:00-05:00",
    pickedUpAt: "2026-08-09T14:20:00-05:00",
    updatedBy: "李美玲",
    updatedAt: "2026-08-09T14:40:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 8,
    laborName: "液压系统检修",
    laborJmd: 45_000,
    partName: "液压油管",
    partsJmd: 15_000,
    netPaidJmd: 15_000,
    teamId: "t3",
    mechanicNames: ["Devon Reid"],
    acceptedAt: "2026-08-09T10:20:00-05:00",
    updatedBy: "Devon Reid",
    updatedAt: "2026-08-09T14:25:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 9,
    laborName: "车身损伤评估",
    laborJmd: 8_000,
    netPaidJmd: 0,
    teamId: "t4",
    updatedBy: "王建华",
    updatedAt: "2026-08-09T14:10:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 10,
    laborName: "钣金修复",
    laborJmd: 30_000,
    partName: "后保险杠",
    partsJmd: 20_000,
    netPaidJmd: 55_000,
    teamId: "t4",
    mechanicNames: ["Andre Lewis"],
    acceptedAt: "2026-08-09T09:40:00-05:00",
    returnedAt: "2026-08-09T13:30:00-05:00",
    updatedBy: "Andre Lewis",
    updatedAt: "2026-08-09T13:55:00-05:00",
  })),
  createSeedOrder(withCanonicalIdentity({
    sequence: 7,
    laborName: "发动机支架更换",
    laborJmd: 16_000,
    partName: "发动机支架",
    partsJmd: 9_000,
    netPaidJmd: 25_000,
    teamId: "t2",
    mechanicNames: ["Owen Campbell"],
    acceptedAt: "2026-08-09T07:50:00-05:00",
    returnedAt: "2026-08-09T10:30:00-05:00",
    submittedAt: "2026-08-09T11:20:00-05:00",
    pickedUpAt: "2026-08-09T12:15:00-05:00",
    updatedBy: "李美玲",
    updatedAt: "2026-08-09T13:40:00-05:00",
  })),
  // 批量演示数据（2026-08-12 老板要求数百条）：确定性生成，锚点不变
  ...generateBulkOrderSeeds(290).map((input) => createSeedOrder(input)),
];
