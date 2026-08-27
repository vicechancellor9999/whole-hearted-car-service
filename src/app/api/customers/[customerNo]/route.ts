import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@formal/modules/customer-vehicle/customer-vehicle-runtime";
import { optionalTextField } from "@formal/app/api/vehicles/vehicle-api-fields";
import type {
  CompanyAccountRecord,
  CustomerVehicleActionContext,
  PersonalCustomerRecord,
} from "@formal/modules/customer-vehicle/customer-vehicle-service";

type CustomerDetailSession = { account: { id: number } };
type ResolvedCustomer =
  | { kind: "person"; record: PersonalCustomerRecord }
  | { kind: "company"; record: CompanyAccountRecord };

type CustomerDetailApiDependencies = {
  readSession(): Promise<CustomerDetailSession | null>;
  findCustomer(customerNo: string, viewerAccountId: number): Promise<ResolvedCustomer | null>;
  updatePerson(input: {
    customerId: number;
    fullName: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    address?: string;
    trn?: string;
    isActive: boolean;
    version: number;
    context: CustomerVehicleActionContext;
  }): Promise<unknown>;
  updateCompany(input: {
    companyId: number;
    legalName: string;
    phone?: string;
    email?: string;
    address?: string;
    trn?: string;
    isActive: boolean;
    version: number;
    context: CustomerVehicleActionContext;
  }): Promise<unknown>;
};

type CustomerUpdateBody = {
  customerType?: unknown;
  fullName?: unknown;
  organizationName?: unknown;
  phone?: unknown;
  whatsapp?: unknown;
  email?: unknown;
  address?: unknown;
  trn?: unknown;
  isActive?: unknown;
  version?: unknown;
};

function patchText(value: unknown, existing: string | null): string | undefined {
  if (value === undefined) return existing ?? undefined;
  return optionalTextField(value);
}

function responseStatus(error: unknown, fallback: number): number {
  const candidate = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : fallback;
  return Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : fallback;
}

export function createCustomerDetailApiHandler(dependencies: CustomerDetailApiDependencies) {
  return async function customerDetailApiHandler(
    request: Request,
    params: { customerNo: string },
  ): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    try {
      const customerNo = decodeURIComponent(params.customerNo).trim();
      const resolved = await dependencies.findCustomer(customerNo, session.account.id);
      if (!resolved) return NextResponse.json({ error: "客户档案不存在" }, { status: 404 });
      if (request.method === "GET") return NextResponse.json(resolved);
      if (request.method !== "PATCH") {
        return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
      }

      const body = await request.json() as CustomerUpdateBody;
      const expectedType = resolved.kind === "person" ? "individual" : "organization";
      if (body.customerType !== undefined && body.customerType !== expectedType) {
        return NextResponse.json({ error: "客户档案类型不能直接转换" }, { status: 409 });
      }
      if ((body.isActive !== undefined && typeof body.isActive !== "boolean") || !Number.isInteger(body.version) || Number(body.version) <= 0) {
        return NextResponse.json({ error: "档案状态或版本不正确" }, { status: 400 });
      }
      const context: CustomerVehicleActionContext = {
        actorAccountId: session.account.id,
        requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
        userAgent: request.headers.get("user-agent"),
      };

      if (resolved.kind === "person") {
        const fullName = body.fullName === undefined
          ? resolved.record.fullName
          : optionalTextField(body.fullName);
        if (!fullName) return NextResponse.json({ error: "客户姓名不能为空" }, { status: 400 });
        const record = await dependencies.updatePerson({
          customerId: resolved.record.id,
          fullName,
          phone: patchText(body.phone, resolved.record.normalizedPhone),
          whatsapp: patchText(body.whatsapp, resolved.record.whatsapp),
          email: patchText(body.email, resolved.record.email),
          address: patchText(body.address, resolved.record.address),
          trn: patchText(body.trn, resolved.record.trn),
          isActive: typeof body.isActive === "boolean" ? body.isActive : resolved.record.isActive,
          version: Number(body.version),
          context,
        });
        return NextResponse.json({ kind: "person", record });
      }

      const legalName = body.organizationName === undefined
        ? resolved.record.legalName
        : optionalTextField(body.organizationName);
      if (!legalName) return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });
      const record = await dependencies.updateCompany({
        companyId: resolved.record.id,
        legalName,
        phone: patchText(body.phone, resolved.record.phone),
        email: patchText(body.email, resolved.record.email),
        address: patchText(body.address, resolved.record.address),
        trn: patchText(body.trn, resolved.record.trn),
        isActive: typeof body.isActive === "boolean" ? body.isActive : resolved.record.isActive,
        version: Number(body.version),
        context,
      });
      return NextResponse.json({ kind: "company", record });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "客户档案读取或保存失败" },
        { status: responseStatus(error, 400) },
      );
    }
  };
}

async function handle(request: Request, customerNo: string): Promise<Response> {
  const runtime = createCustomerVehicleRuntime(process.env);
  try {
    return await createCustomerDetailApiHandler({
      readSession: currentSession,
      findCustomer: async (number, viewerAccountId) => {
        const [people, companies] = await Promise.all([
          runtime.service.listPersonalCustomers({ viewerAccountId, search: number, page: 1, pageSize: 100 }),
          runtime.service.listCompanyAccounts({ viewerAccountId, search: number, page: 1, pageSize: 100 }),
        ]);
        const person = people.items.find((candidate) => candidate.customerNo === number);
        if (person) return { kind: "person" as const, record: person };
        const company = companies.items.find((candidate) => candidate.companyNo === number);
        return company ? { kind: "company" as const, record: company } : null;
      },
      updatePerson: (input) => runtime.service.updatePersonalCustomer(input),
      updateCompany: (input) => runtime.service.updateCompanyAccount(input),
    })(request, { customerNo });
  } finally {
    await runtime.close();
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ customerNo: string }> },
): Promise<Response> {
  const params = await context.params;
  return handle(request, params.customerNo);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ customerNo: string }> },
): Promise<Response> {
  const params = await context.params;
  return handle(request, params.customerNo);
}
