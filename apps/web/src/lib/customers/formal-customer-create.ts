import type { CustomerRecord, CustomerType } from "@/lib/customers/types";
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

type FetchCustomer = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function textOrNull(value: string): string | null {
  return value.trim() || null;
}

export async function createFormalCustomer(
  draft: FormalCustomerCreateDraft,
  fetchCustomer: FetchCustomer = fetch,
): Promise<CustomerRecord> {
  const response = await fetchCustomer("/api/formal/customers", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customerType: draft.customerType,
      fullName: draft.customerType === "individual" ? draft.fullName.trim() : null,
      organizationName: draft.customerType === "organization" ? textOrNull(draft.organizationName) : null,
      phone: textOrNull(draft.phone),
      whatsapp: draft.customerType === "individual" ? textOrNull(draft.whatsapp) : null,
      email: textOrNull(draft.email),
      address: textOrNull(draft.address),
      trn: textOrNull(draft.trn),
    }),
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
