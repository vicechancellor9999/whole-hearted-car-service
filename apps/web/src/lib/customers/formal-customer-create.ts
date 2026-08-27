import type { CustomerRecord, CustomerType } from "@/lib/customers/types";
import type { CustomerLicenseRecognition } from "@/lib/customers/customer-driver-license-recognition";
import type { LicenseImageTransform } from "@/lib/customers/license-extraction/image-input";
import {
  adaptFormalCompany,
  adaptFormalPerson,
  type FormalCompany,
  type FormalPerson,
} from "@/lib/customers/formal-customer-vehicle-adapter";

export type FormalCustomerCreateDraft = {
  customerType: CustomerType;
  fullName: string;
  organizationName: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  trn: string;
};

export type FormalCustomerCreateExtension = {
  license?: {
    file: File;
    transform: LicenseImageTransform;
    profile: {
      name: string;
      birthDate: string;
      sex: "M" | "F";
      address: string;
    };
    verified: boolean;
    status?: CustomerLicenseRecognition["status"];
  };
  primaryContact?:
    | { existingPersonalCustomerNo: string }
    | { newPrimaryContact: {
        fullName: string;
        phone?: string;
        whatsapp?: string;
        email?: string;
        address?: string;
        trn?: string;
        jobTitle?: string;
      } };
};

type FetchCustomer = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function textOrNull(value: string): string | null {
  return value.trim() || null;
}

export async function createFormalCustomer(
  draft: FormalCustomerCreateDraft,
  extensionOrFetcher?: FormalCustomerCreateExtension | FetchCustomer,
  suppliedFetcher?: FetchCustomer,
): Promise<CustomerRecord> {
  const extension = typeof extensionOrFetcher === "function" ? undefined : extensionOrFetcher;
  const fetchCustomer = typeof extensionOrFetcher === "function"
    ? extensionOrFetcher
    : suppliedFetcher ?? fetch;
  const body = extension
    ? multipartBody(draft, extension)
    : JSON.stringify({
        customerType: draft.customerType,
        fullName: draft.customerType === "individual" ? draft.fullName.trim() : null,
        organizationName: draft.customerType === "organization" ? textOrNull(draft.organizationName) : null,
        phone: textOrNull(draft.phone),
        whatsapp: draft.customerType === "individual" ? textOrNull(draft.whatsapp) : null,
        email: textOrNull(draft.email),
        address: textOrNull(draft.address),
        trn: textOrNull(draft.trn),
      });
  const response = await fetchCustomer("/api/formal/customers", {
    method: "POST",
    credentials: "same-origin",
    ...(extension ? {} : { headers: { "content-type": "application/json" } }),
    body,
  });
  const payload = await response.json().catch(() => null) as {
    error?: unknown;
    kind?: "person" | "company";
    record?: FormalPerson | FormalCompany;
  } | null;
  if (!response.ok || !payload?.kind || !payload.record) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "客户档案保存失败");
  }
  return payload.kind === "person"
    ? adaptFormalPerson(payload.record as FormalPerson)
    : adaptFormalCompany(payload.record as FormalCompany);
}

function multipartBody(
  draft: FormalCustomerCreateDraft,
  extension: FormalCustomerCreateExtension,
): FormData {
  const form = new FormData();
  const license = extension.license
    ? {
        profile: extension.license.profile,
        verified: extension.license.verified,
        transform: extension.license.transform,
      }
    : undefined;
  const payload = draft.customerType === "individual"
    ? {
        customerType: "individual" as const,
        fullName: draft.fullName.trim(),
        phone: textOrNull(draft.phone),
        whatsapp: textOrNull(draft.whatsapp),
        email: textOrNull(draft.email),
        address: textOrNull(draft.address),
        trn: textOrNull(draft.trn),
        license,
      }
    : {
        customerType: "organization" as const,
        organizationName: draft.organizationName.trim(),
        phone: textOrNull(draft.phone),
        email: textOrNull(draft.email),
        address: textOrNull(draft.address),
        trn: textOrNull(draft.trn),
        primaryContact: extension.primaryContact,
        license,
      };
  form.set("payload", JSON.stringify(payload));
  if (extension.license) form.set("licenseFront", extension.license.file);
  return form;
}
