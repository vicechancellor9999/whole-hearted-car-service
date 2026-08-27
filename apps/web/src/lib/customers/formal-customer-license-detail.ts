import type { LicenseImageTransform } from "@/lib/customers/license-extraction/image-input";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FormalCustomerLicenseStatus =
  | "pending_verification"
  | "verified"
  | "needs_reverification";

export type FormalCustomerLicenseRecord = {
  id: number;
  subject:
    | { type: "individual_customer"; personalCustomerId: number }
    | {
        type: "organization_primary_contact";
        companyAccountId: number;
        companyContactId: number | null;
        personalCustomerId: number | null;
      };
  fileId: number;
  profile: { name: string; birthDate: string; sex: "M" | "F"; address: string };
  status: FormalCustomerLicenseStatus;
  verifiedBy: number | null;
  verifiedAt: string | null;
  supersededBy: number | null;
  supersededAt: string | null;
  createdBy: number;
  createdAt: string;
  version: number;
};

export type FormalCustomerLicenseDetail = {
  status: FormalCustomerLicenseStatus | "missing";
  current: FormalCustomerLicenseRecord | null;
  records: FormalCustomerLicenseRecord[];
  historyCount: number;
};

export function deriveFormalCustomerLicenseDetail(
  records: readonly FormalCustomerLicenseRecord[],
): FormalCustomerLicenseDetail {
  const sorted = [...records].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.id - left.id
  ));
  const current = sorted.find((record) => record.supersededAt === null) ?? null;
  return {
    status: current?.status ?? "missing",
    current,
    records: sorted,
    historyCount: sorted.length,
  };
}

export async function fetchFormalCustomerLicenseHistory(
  customerNo: string,
  fetcher: Fetcher = fetch,
): Promise<FormalCustomerLicenseRecord[]> {
  const response = await fetcher(
    `/api/formal/customers/${encodeURIComponent(customerNo)}/driver-license-history`,
    { credentials: "same-origin", cache: "no-store" },
  );
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw detailError(response.status, payload, "驾驶证记录读取失败");
  if (!isObject(payload) || !Array.isArray(payload.records)) {
    throw new Error("驾驶证记录返回格式不正确");
  }
  return payload.records.map(parseRecord);
}

export async function supplementFormalCustomerLicense(
  customerNo: string,
  input: {
    file: File;
    transform: LicenseImageTransform;
    profile: { name: string; birthDate: string; sex: "M" | "F"; address: string };
    verified: boolean;
  },
  fetcher: Fetcher = fetch,
): Promise<FormalCustomerLicenseRecord> {
  const form = new FormData();
  form.set("payload", JSON.stringify({
    profile: input.profile,
    verified: input.verified,
    transform: input.transform,
  }));
  form.set("licenseFront", input.file);
  const response = await fetcher(
    `/api/formal/customers/${encodeURIComponent(customerNo)}/driver-license`,
    { method: "POST", credentials: "same-origin", body: form },
  );
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw detailError(response.status, payload, "驾驶证补录失败，请重试");
  if (!isObject(payload) || !("record" in payload)) {
    throw new Error("驾驶证补录结果格式不正确");
  }
  return parseRecord(payload.record);
}

function parseRecord(value: unknown): FormalCustomerLicenseRecord {
  if (!isObject(value) || !isPositiveInteger(value.id) || !isPositiveInteger(value.fileId) ||
      !isObject(value.profile) || typeof value.profile.name !== "string" ||
      typeof value.profile.birthDate !== "string" ||
      (value.profile.sex !== "M" && value.profile.sex !== "F") ||
      typeof value.profile.address !== "string" ||
      (value.status !== "pending_verification" && value.status !== "verified" &&
        value.status !== "needs_reverification") ||
      !isNullablePositiveInteger(value.verifiedBy) || !isNullableString(value.verifiedAt) ||
      !isNullablePositiveInteger(value.supersededBy) || !isNullableString(value.supersededAt) ||
      !isPositiveInteger(value.createdBy) || typeof value.createdAt !== "string" ||
      !isPositiveInteger(value.version) || !isObject(value.subject)) {
    throw new Error("驾驶证记录返回格式不正确");
  }
  const subject = parseSubject(value.subject);
  return {
    id: value.id,
    subject,
    fileId: value.fileId,
    profile: {
      name: value.profile.name,
      birthDate: value.profile.birthDate,
      sex: value.profile.sex,
      address: value.profile.address,
    },
    status: value.status,
    verifiedBy: value.verifiedBy,
    verifiedAt: value.verifiedAt,
    supersededBy: value.supersededBy,
    supersededAt: value.supersededAt,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
    version: value.version,
  };
}

function parseSubject(value: Record<string, unknown>): FormalCustomerLicenseRecord["subject"] {
  if (value.type === "individual_customer" && isPositiveInteger(value.personalCustomerId)) {
    return { type: value.type, personalCustomerId: value.personalCustomerId };
  }
  if (value.type === "organization_primary_contact" &&
      isPositiveInteger(value.companyAccountId) &&
      isNullablePositiveInteger(value.companyContactId) &&
      isNullablePositiveInteger(value.personalCustomerId)) {
    return {
      type: value.type,
      companyAccountId: value.companyAccountId,
      companyContactId: value.companyContactId,
      personalCustomerId: value.personalCustomerId,
    };
  }
  throw new Error("驾驶证记录返回格式不正确");
}

function detailError(status: number, payload: unknown, fallback: string): Error {
  if (status === 401) return new Error("登录状态已失效，请重新登录");
  if (status === 403) return new Error("当前账号没有客户证件访问权限");
  const message = isObject(payload) && typeof payload.error === "string" ? payload.error : fallback;
  return new Error(status >= 500 ? fallback : message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
