/**
 * 批量演示数据生成器（2026-08-12 老板要求：各大几百条）。
 * 确定性：mulberry32 固定种子，每次加载产出完全一致的数据（测试与演示可复现）。
 * 锚点保留：order-demo-01..10 与 CUST/VEH-UAT-001..004 不受影响。
 */
import {
  CANONICAL_CUSTOMERS,
  canonicalCustomerById,
  canonicalVehicleById,
  operationIdentityForSequence,
} from "../customers/canonical-identities";

// ---------------------------------------------------------------------------
// 确定性随机
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, pool: readonly T[]): T {
  return pool[Math.floor(rand() * pool.length)];
}

function chance(rand: () => number, probability: number): boolean {
  return rand() < probability;
}

// ---------------------------------------------------------------------------
// 维修项目池
// ---------------------------------------------------------------------------

const LABOR_ITEMS: ReadonlyArray<readonly [string, number]> = [
  ["常规保养换机油", 8500],
  ["刹车片更换", 18000],
  ["刹车盘+片整套", 32000],
  ["正时皮带更换", 65000],
  ["变速箱油更换", 24000],
  ["空调检修加氟", 15000],
  ["发动机故障诊断", 12000],
  ["悬挂减震器更换", 45000],
  ["四轮定位", 9000],
  ["电瓶更换", 16000],
  ["水箱清洗更换", 28000],
  ["离合器套件更换", 85000],
  ["年检代办检查", 6000],
  ["轮胎更换(两条)", 22000],
  ["雨刷+灯光检查", 4500],
] as const;

const PART_ITEMS: ReadonlyArray<readonly [string, number]> = [
  ["原厂刹车片", 12500],
  ["机油滤芯", 2200],
  ["空气滤芯", 3500],
  ["正时皮带套件", 38000],
  ["减震器总成", 26000],
  ["电瓶 65Ah", 14000],
  ["水泵总成", 18500],
  ["离合器三件套", 52000],
] as const;

const TEAM_IDS = ["t1", "t2", "t3"] as const;
const MECHANIC_NAMES = ["Omar D.", "Tanya B.", "Devon M.", "Clive H.", "Raymond C."] as const;
const FRONTDESK_NAMES = ["LiJian", "兰兰", "Cindy"] as const;

// ---------------------------------------------------------------------------
// 生成：order SeedInput 批量（接 src/lib/orders/seed.ts 的 seedOrder）
// ---------------------------------------------------------------------------

export interface BulkOrderSeedInput {
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
  teamId?: "t1" | "t2" | "t3";
  mechanicNames?: string[];
  acceptedAt?: string;
  returnedAt?: string;
  submittedAt?: string;
  pickedUpAt?: string;
  updatedBy: string;
  updatedAt: string;
}

function isoDay(dayOffset: number, hour: number): string {
  const base = Date.parse("2026-08-11T12:00:00.000Z");
  const d = new Date(base - dayOffset * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:30:00.000Z`;
}

/** 生成 count 条批量业务单种子（sequence 从 11 开始，前 10 为静态锚点）。 */
export function generateBulkOrderSeeds(count: number, seed = 20260812): BulkOrderSeedInput[] {
  const rand = mulberry32(seed);
  const initialTeamByVehicleId = new Map<string, "t1" | "t2" | "t3">();
  const result: BulkOrderSeedInput[] = [];

  for (let i = 0; i < count; i += 1) {
    const sequence = 11 + i;
    const operation = operationIdentityForSequence(sequence);
    const customer = canonicalCustomerById(operation.customerId);
    const vehicle = canonicalVehicleById(operation.vehicleId);

    // 身份事实只从 canonical catalog 读取；随机数只驱动业务字段。
    const labor = pick(rand, LABOR_ITEMS);
    const hasPart = chance(rand, 0.6);
    const part = hasPart ? pick(rand, PART_ITEMS) : null;
    const total = labor[1] + (part?.[1] ?? 0);

    // 状态分布：已交单 62% / 已回单 10% / 已接单 14% / 新建 14%
    const roll = rand();
    const ageBase = Math.floor(rand() * 55) + 1;
    let acceptedAt: string | undefined;
    let submittedAt: string | undefined;
    let pickedUpAt: string | undefined;
    if (roll < 0.62) {
      acceptedAt = isoDay(ageBase, 8);
      submittedAt = isoDay(Math.max(0, ageBase - 2), 16);
      if (chance(rand, 0.7)) pickedUpAt = isoDay(Math.max(0, ageBase - 3), 11);
    } else if (roll < 0.72) {
      acceptedAt = isoDay(ageBase, 8);
      submittedAt = isoDay(Math.max(0, ageBase - 1), 17);
    } else if (roll < 0.86) {
      acceptedAt = isoDay(Math.min(ageBase, 6), 9);
    }

    // 付款分布（仅已交单）：75% 付清 / 12% 部分 / 13% 未付
    let netPaidJmd = 0;
    if (submittedAt) {
      const payRoll = rand();
      if (payRoll < 0.75) netPaidJmd = total;
      else if (payRoll < 0.87) netPaidJmd = Math.round(total * (0.3 + rand() * 0.4));
    }

    const generatedTeam = pick(rand, TEAM_IDS);
    const teamId = initialTeamByVehicleId.get(operation.vehicleId) ?? generatedTeam;
    initialTeamByVehicleId.set(operation.vehicleId, teamId);
    result.push({
      sequence,
      customerId: operation.customerId,
      vehicleId: operation.vehicleId,
      customerNameZh: customer.contactName.nameZh,
      customerNameEn: customer.contactName.nameEn,
      phone: customer.phone ?? "",
      plate: vehicle.plate,
      modelZh: vehicle.modelZh,
      modelEn: vehicle.modelEn,
      laborName: labor[0],
      laborJmd: labor[1],
      ...(part ? { partName: part[0], partsJmd: part[1] } : {}),
      netPaidJmd,
      teamId,
      mechanicNames: [pick(rand, MECHANIC_NAMES)],
      ...(acceptedAt ? { acceptedAt } : {}),
      ...(submittedAt ? { submittedAt } : {}),
      ...(pickedUpAt ? { pickedUpAt } : {}),
      updatedBy: pick(rand, FRONTDESK_NAMES),
      updatedAt: isoDay(0, 9),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 生成：客户档案批量（接 mock-customers 的 baseCustomer）
// ---------------------------------------------------------------------------

export interface BulkCustomerInput {
  id: string;
  customerType: "individual" | "organization";
  name: string | null;
  nameZh: string | null;
  organizationName: string | null;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  status: "active" | "inactive";
  riskLevel: "normal" | "attention" | "high";
  verification: {
    otpVerified: boolean;
    otpVerifiedAt: string | null;
    kycStatus: "pending" | "verified";
    kycVerifiedAt: string | null;
    agreementStatus: "pending" | "signed" | "expired";
    agreementVersion: string | null;
    agreementSignedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

/** 生成 count 个批量客户（id 从 CUST-BULK-001 开始）。 */
export function generateBulkCustomers(count: number, seed = 20260813): BulkCustomerInput[] {
  const rand = mulberry32(seed);
  const result: BulkCustomerInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const seq = i + 1;
    const canonical = canonicalCustomerById(`CUST-BULK-${String(seq).padStart(3, "0")}`);
    const isOrg = canonical.kind === "organization";
    const createdDaysAgo = 30 + Math.floor(rand() * 400);

    // 验证状态分布：全齐 62% / 缺一项 22% / 缺两项 10% / 全缺 6%
    const vRoll = rand();
    const missingCount = vRoll < 0.62 ? 0 : vRoll < 0.84 ? 1 : vRoll < 0.94 ? 2 : 3;
    const missing = new Set<number>();
    while (missing.size < missingCount) missing.add(Math.floor(rand() * 3));
    const otpOk = !missing.has(0);
    const kycOk = !missing.has(1);
    const agrOk = !missing.has(2);

    const rRoll = rand();
    const riskLevel = rRoll < 0.9 ? "normal" : rRoll < 0.96 ? "attention" : "high";

    result.push({
      id: `CUST-BULK-${String(seq).padStart(3, "0")}`,
      customerType: isOrg ? "organization" : "individual",
      name: canonical.contactName.nameEn,
      nameZh: isOrg ? null : canonical.contactName.nameZh,
      organizationName: canonical.organizationName,
      phone: canonical.phone ?? "",
      whatsapp: chance(rand, 0.7) ? `+1 876 ${300 + Math.floor(rand() * 600)} ${String(1000 + Math.floor(rand() * 9000))}` : null,
      email: canonical.email,
      status: chance(rand, 0.85) ? "active" : "inactive",
      riskLevel,
      verification: {
        otpVerified: otpOk,
        otpVerifiedAt: otpOk ? isoDay(createdDaysAgo - 1, 10) : null,
        kycStatus: kycOk ? "verified" : "pending",
        kycVerifiedAt: kycOk ? isoDay(createdDaysAgo - 1, 10) : null,
        agreementStatus: agrOk ? (chance(rand, 0.08) ? "expired" : "signed") : "pending",
        agreementVersion: agrOk ? "v1.2" : null,
        agreementSignedAt: agrOk ? isoDay(createdDaysAgo - 2, 14) : null,
      },
      createdAt: isoDay(createdDaysAgo, 9),
      updatedAt: isoDay(Math.floor(rand() * 20), 11),
    });
  }
  return result;
}

/** 生成 count 辆批量车（id 从 VEH-BULK-001 开始），关联到批量客户。 */
export function generateBulkVehicles(count: number, customerIds: readonly string[], seed = 20260814): Array<{
  id: string;
  plate: string;
  make: string;
  model: string;
  makeZh: string | null;
  modelZh: string | null;
  year: number;
  status: "on_site" | "off_site";
  customerId: string;
}> {
  const rand = mulberry32(seed);
  const availableCustomerIds = new Set(customerIds);
  const canonicalBulkCustomerIds = new Set(CANONICAL_CUSTOMERS
    .filter((customer) => customer.id.startsWith("CUST-BULK-"))
    .map((customer) => customer.id));
  for (const customerId of customerIds) {
    if (!canonicalBulkCustomerIds.has(customerId)) {
      throw new Error(`unexpected customer id for canonical bulk vehicles: ${customerId}`);
    }
  }
  const result: Array<{ id: string; plate: string; make: string; model: string; makeZh: string | null; modelZh: string | null; year: number; status: "on_site" | "off_site"; customerId: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const canonical = canonicalVehicleById(`VEH-BULK-${String(i + 1).padStart(3, "0")}`);
    if (!availableCustomerIds.has(canonical.currentCustomerId)) {
      throw new Error(`missing canonical vehicle customer: ${canonical.currentCustomerId}`);
    }
    const [make, ...modelWords] = canonical.modelEn.split(" ");
    const [makeZh, ...modelZhWords] = (canonical.modelZh ?? "").split(" ");
    result.push({
      id: canonical.id,
      plate: canonical.plate,
      make,
      model: modelWords.join(" "),
      makeZh: makeZh || null,
      modelZh: modelZhWords.join(" ") || null,
      year: 2008 + Math.floor(rand() * 18),
      status: chance(rand, 0.22) ? "on_site" : "off_site",
      customerId: canonical.currentCustomerId,
    });
  }
  return result;
}
