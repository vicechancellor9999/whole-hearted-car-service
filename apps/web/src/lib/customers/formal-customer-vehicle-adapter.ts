import type {
  CompanyContactRelationship,
  CustomerRecord,
  CustomerVehicleWorkspaceResponse,
  StoredCustomerName,
  VehicleRecord,
} from "@/lib/customers/types";
import type { EvidenceAsset } from "@/lib/customers/verification-types";

export type FormalPerson = {
  id: number;
  customerNo: string;
  fullName: string;
  normalizedPhone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  trn: string | null;
  isActive: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
};

export type FormalCompany = {
  id: number;
  companyNo: string;
  legalName: string;
  trn: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
};

export type FormalVehicle = {
  id: number;
  vehicleNo: string;
  plateDisplay: string | null;
  normalizedPlate: string | null;
  vin: string | null;
  engineNumber: string | null;
  make: string;
  makeZh: string | null;
  model: string;
  modelZh: string | null;
  modelYear: number | null;
  color: string | null;
  bodyType: string | null;
  fuelType: string | null;
  engineCc: number | null;
  seating: number | null;
  usage: string | null;
  specialNotes: string | null;
  currentOwner: { type: "person" | "company"; id: number; name?: string };
  hasOpenDispute: boolean;
  openDisputeId: number | null;
  isActive: boolean;
  version: number;
  createdAt?: string;
  updatedAt?: string;
};

export type FormalVehicleAttachment = {
  fileId: number;
  vehicleId: number;
  kind: "photo" | "document" | "dispute_evidence";
  caption: string | null;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export type FormalCustomerVehicleWorkspace = {
  people: FormalPerson[];
  companies: FormalCompany[];
  companyContacts: Array<{
    id: number;
    companyId: number;
    personalCustomerId: number;
    personalCustomerName: string;
    normalizedPhone: string | null;
    jobTitle: string | null;
    isPrimary: boolean;
    canSign: boolean;
    receivesInvoice: boolean;
    receivesCollection: boolean;
    isActive: boolean;
    version: number;
  }>;
  vehicles: FormalVehicle[];
  vehicleAttachments: FormalVehicleAttachment[];
  onSiteVehicleIds: number[];
  ownerHistory?: Array<{
    id: number;
    vehicleId: number;
    owner: { type: "person" | "company"; id: number; name?: string };
    startedAt: string;
    endedAt: string | null;
    reason: string | null;
  }>;
  totals: { people: number; companies: number; vehicles: number };
};

export function normalizeFormalPlate(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function selectFormalVehicleByPlate(
  vehicles: FormalVehicle[],
  plate: string,
): FormalVehicle | null {
  const normalized = normalizeFormalPlate(plate);
  if (!normalized) return null;
  return vehicles.find((vehicle) => vehicle.normalizedPlate === normalized) ?? null;
}

export async function fetchFormalCustomerVehicleWorkspace(): Promise<FormalCustomerVehicleWorkspace> {
  const response = await fetch("/api/formal/customer-vehicles", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as FormalCustomerVehicleWorkspace & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "客户与车辆正式数据读取失败");
  }
  return payload;
}

export async function fetchFormalVehicleSearch(
  search: string,
  signal?: AbortSignal,
): Promise<FormalVehicle[]> {
  const query = new URLSearchParams({ search, pageSize: "8" });
  const response = await fetch(`/api/formal/vehicles?${query.toString()}`, {
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => ({})) as {
    items?: FormalVehicle[];
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "车辆搜索失败");
  }
  return Array.isArray(payload.items) ? payload.items : [];
}

const emptyVerificationArchive = {
  otpRecords: [],
  kycRecords: [],
  agreementRecords: [],
  evidenceGaps: [],
} as const;

const noCredit = {
  eligible: false,
  registeredAt: null,
  registeredBy: null,
  signatureNote: null,
  signatureDataUrl: null,
  cancelledAt: null,
  cancelledBy: null,
} as const;

function adaptFormalStoredName(value: string): StoredCustomerName {
  const storedValue = value.trim();
  const pairedNames = storedValue.split("/").map((part) => part.trim()).filter(Boolean);
  const pairedNameZh = pairedNames.find((part) => /[\u3400-\u9fff]/u.test(part)) ?? null;
  const pairedNameEn = pairedNames.find((part) => !/[\u3400-\u9fff]/u.test(part)) ?? null;
  if (pairedNameZh && pairedNameEn) return {
    nameSourceScript: "en",
    nameSourceValue: pairedNameEn,
    nameZh: pairedNameZh,
    nameEn: pairedNameEn,
    transliterationMethod: "exact_name_dictionary",
    transliterationVersion: "customer-name-v1",
    transliterationStatus: "confirmed",
  };
  if (/[\u3400-\u9fff]/u.test(storedValue)) return {
    nameSourceScript: "zh",
    nameSourceValue: storedValue,
    nameZh: storedValue,
    nameEn: null,
    transliterationMethod: null,
    transliterationVersion: null,
    transliterationStatus: "needs_transliteration_review",
  };
  return {
    nameSourceScript: "en",
    nameSourceValue: storedValue,
    nameZh: null,
    nameEn: storedValue,
    transliterationMethod: null,
    transliterationVersion: null,
    transliterationStatus: "needs_transliteration_review",
  };
}

export function adaptFormalPerson(person: FormalPerson): CustomerRecord {
  return {
    id: person.customerNo,
    formalFullName: person.fullName,
    customerType: "individual",
    organizationName: null,
    primaryContactRole: null,
    ...adaptFormalStoredName(person.fullName),
    salutation: null,
    gender: null,
    birthDate: null,
    trn: person.trn,
    language: "zh",
    phone: person.normalizedPhone,
    secondaryPhone: null,
    whatsapp: person.whatsapp,
    email: person.email,
    preferredChannel: person.whatsapp ? "whatsapp" : person.email ? "email" : "phone",
    address: person.address,
    status: person.isActive ? "active" : "inactive",
    riskFlags: [],
    verificationArchive: emptyVerificationArchive,
    creditEligibility: noCredit,
    notes: [],
    revision: person.version,
    createdAt: person.createdAt ?? "",
    updatedAt: person.updatedAt ?? person.createdAt ?? "",
  };
}

export function adaptFormalCompany(
  company: FormalCompany,
  contacts: FormalCustomerVehicleWorkspace["companyContacts"] = [],
): CustomerRecord {
  const primaryContact = contacts.find((contact) => contact.isActive && contact.isPrimary)
    ?? contacts.find((contact) => contact.isActive)
    ?? null;
  const storedContactName = primaryContact
    ? adaptFormalStoredName(primaryContact.personalCustomerName)
    : {
        nameSourceScript: null,
        nameSourceValue: null,
        nameZh: null,
        nameEn: null,
        transliterationMethod: null,
        transliterationVersion: null,
        transliterationStatus: "needs_profile_review" as const,
      };
  return {
    id: company.companyNo,
    customerType: "organization",
    organizationName: company.legalName,
    primaryContactRole: primaryContact?.jobTitle ?? null,
    ...storedContactName,
    salutation: null,
    gender: null,
    birthDate: null,
    trn: company.trn,
    language: "en",
    phone: company.phone,
    secondaryPhone: null,
    whatsapp: null,
    email: company.email,
    preferredChannel: company.email ? "email" : "phone",
    address: company.address,
    status: company.isActive ? "active" : "inactive",
    riskFlags: [],
    verificationArchive: emptyVerificationArchive,
    creditEligibility: noCredit,
    notes: [],
    revision: company.version,
    createdAt: company.createdAt ?? "",
    updatedAt: company.updatedAt ?? company.createdAt ?? "",
  };
}

export function adaptFormalVehicle(
  vehicle: FormalVehicle,
  attachments: FormalVehicleAttachment[] = [],
  onSite = false,
): VehicleRecord {
  const attachmentAssets = attachments.map((attachment) => ({
    id: `formal-vehicle-file-${attachment.fileId}`,
    fileName: attachment.originalName,
    url: `/api/formal/vehicle-attachments/${attachment.fileId}`,
    mimeType: attachment.mediaType as EvidenceAsset["mimeType"],
    sizeBytes: attachment.sizeBytes,
    createdAt: attachment.uploadedAt,
    createdBy: "正式系统",
  }));
  return {
    id: vehicle.vehicleNo,
    formalId: vehicle.id,
    formalIsActive: vehicle.isActive,
    plate: vehicle.plateDisplay ?? "",
    vin: vehicle.vin ?? "",
    engineNumber: vehicle.engineNumber,
    make: vehicle.make,
    model: vehicle.model,
    makeZh: vehicle.makeZh,
    modelZh: vehicle.modelZh,
    variant: null,
    year: vehicle.modelYear ?? 0,
    color: vehicle.color,
    powertrain: null,
    bodyType: vehicle.bodyType,
    seating: vehicle.seating == null ? null : String(vehicle.seating),
    ccRating: vehicle.engineCc == null ? null : String(vehicle.engineCc),
    fuelType: vehicle.fuelType,
    mileage: null,
    mileageUnit: "km",
    mileageRecordedAt: null,
    usage: vehicle.usage,
    specialNotes: vehicle.specialNotes,
    photos: attachments.filter((attachment) => attachment.kind === "photo").map((attachment) => ({
      id: `formal-vehicle-file-${attachment.fileId}`,
      kind: "other",
      url: `/api/formal/vehicle-attachments/${attachment.fileId}`,
      note: attachment.caption ?? attachment.originalName,
      linkedOrderId: null,
      uploadedBy: "正式系统",
      uploadedAt: attachment.uploadedAt,
    })),
    status: onSite ? "on_site" : "off_site",
    hasOpenDispute: vehicle.hasOpenDispute,
    openDisputeId: vehicle.openDisputeId,
    partsNeeds: [],
    tasks: [],
    attachments: attachmentAssets,
    revision: vehicle.version,
    createdAt: vehicle.createdAt ?? "",
    updatedAt: vehicle.updatedAt ?? vehicle.createdAt ?? "",
  };
}

export function adaptFormalCustomerVehicleWorkspace(
  source: FormalCustomerVehicleWorkspace,
): CustomerVehicleWorkspaceResponse {
  const peopleById = new Map(source.people.map((person) => [person.id, person.customerNo]));
  const companiesById = new Map(source.companies.map((company) => [company.id, company.companyNo]));
  const contactsByCompanyId = Map.groupBy(source.companyContacts, (contact) => contact.companyId);
  const customers = [
    ...source.people.map(adaptFormalPerson),
    ...source.companies.map((company) => adaptFormalCompany(company, contactsByCompanyId.get(company.id) ?? [])),
  ];
  const attachmentsByVehicleId = Map.groupBy(source.vehicleAttachments, (attachment) => attachment.vehicleId);
  const onSiteVehicleIds = new Set(source.onSiteVehicleIds);
  const vehicles = source.vehicles.map((vehicle) => adaptFormalVehicle(
    vehicle,
    attachmentsByVehicleId.get(vehicle.id) ?? [],
    onSiteVehicleIds.has(vehicle.id),
  ));
  const vehicleNoById = new Map(source.vehicles.map((vehicle) => [vehicle.id, vehicle.vehicleNo]));
  const relationships = source.ownerHistory?.flatMap((history) => {
    const vehicleId = vehicleNoById.get(history.vehicleId);
    const customerId = history.owner.type === "person"
      ? peopleById.get(history.owner.id)
      : companiesById.get(history.owner.id);
    if (!vehicleId || !customerId) return [];
    return [{
      id: `owner-history-${history.id}`,
      vehicleId,
      customerId,
      startedAt: history.startedAt,
      endedAt: history.endedAt,
    }];
  }) ?? source.vehicles.flatMap((vehicle) => {
    const customerId = vehicle.currentOwner.type === "person"
      ? peopleById.get(vehicle.currentOwner.id)
      : companiesById.get(vehicle.currentOwner.id);
    if (!customerId) return [];
    return [{
      id: `owner-${vehicle.vehicleNo}`,
      vehicleId: vehicle.vehicleNo,
      customerId,
      startedAt: "",
      endedAt: null,
    }];
  });
  const companyContacts: CompanyContactRelationship[] = source.companyContacts.flatMap((contact) => {
    const companyId = companiesById.get(contact.companyId);
    const personalCustomerId = peopleById.get(contact.personalCustomerId);
    if (!companyId || !personalCustomerId) return [];
    return [{
      id: `formal-company-contact-${contact.id}`,
      companyId,
      personalCustomerId,
      personalCustomerName: contact.personalCustomerName,
      normalizedPhone: contact.normalizedPhone,
      jobTitle: contact.jobTitle,
      isPrimary: contact.isPrimary,
      canSign: contact.canSign,
      receivesInvoice: contact.receivesInvoice,
      receivesCollection: contact.receivesCollection,
      isActive: contact.isActive,
      revision: contact.version,
    }];
  });
  return {
    sourceRevision: Math.max(
      0,
      ...source.people.map((record) => record.version),
      ...source.companies.map((record) => record.version),
      ...source.vehicles.map((record) => record.version),
      ...source.companyContacts.map((record) => record.version),
    ),
    summary: {
      totalCustomers: customers.length,
      activeCustomers: customers.filter((customer) => customer.status === "active").length,
      totalVehicles: vehicles.length,
      activeVehicles: source.vehicles.filter((vehicle) => vehicle.isActive).length,
      activeRelationships: relationships.filter((relationship) => relationship.endedAt === null).length,
    },
    customers,
    vehicles,
    relationships,
    companyContacts,
  };
}
