import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@formal/modules/customer-vehicle/customer-vehicle-runtime";
import { optionalTextField } from "@formal/app/api/vehicles/vehicle-api-fields";

type CustomerApiSession = { account: { id: number } };
type CustomerCreateContext = {
  actorAccountId: number;
  requestId: string;
  userAgent: string | null;
};

type CustomerApiDependencies = {
  readSession(): Promise<CustomerApiSession | null>;
  createPerson(input: {
    fullName: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    address?: string;
    trn?: string;
    context: CustomerCreateContext;
  }): Promise<unknown>;
  createCompany(input: {
    legalName: string;
    phone?: string;
    email?: string;
    address?: string;
    trn?: string;
    context: CustomerCreateContext;
  }): Promise<unknown>;
};

type CustomerCreateBody = {
  customerType?: unknown;
  fullName?: unknown;
  organizationName?: unknown;
  phone?: unknown;
  whatsapp?: unknown;
  email?: unknown;
  address?: unknown;
  trn?: unknown;
};

export function createCustomerApiHandler(dependencies: CustomerApiDependencies) {
  return async function customerApiHandler(request: Request): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    try {
      const body = await request.json() as CustomerCreateBody;
      const context = {
        actorAccountId: session.account.id,
        requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
        userAgent: request.headers.get("user-agent"),
      };
      if (body.customerType === "individual") {
        const fullName = optionalTextField(body.fullName);
        if (!fullName) return NextResponse.json({ error: "客户姓名不能为空" }, { status: 400 });
        const record = await dependencies.createPerson({
          fullName,
          phone: optionalTextField(body.phone),
          whatsapp: optionalTextField(body.whatsapp),
          email: optionalTextField(body.email),
          address: optionalTextField(body.address),
          trn: optionalTextField(body.trn),
          context,
        });
        return NextResponse.json({ kind: "person", record }, { status: 201 });
      }
      if (body.customerType === "organization") {
        const legalName = optionalTextField(body.organizationName);
        if (!legalName) return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });
        const record = await dependencies.createCompany({
          legalName,
          phone: optionalTextField(body.phone),
          email: optionalTextField(body.email),
          address: optionalTextField(body.address),
          trn: optionalTextField(body.trn),
          context,
        });
        return NextResponse.json({ kind: "company", record }, { status: 201 });
      }
      return NextResponse.json({ error: "客户类型不正确" }, { status: 400 });
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : 400;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "客户档案保存失败" },
        { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400 },
      );
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const runtime = createCustomerVehicleRuntime(process.env);
  try {
    return await createCustomerApiHandler({
      readSession: currentSession,
      createPerson: (input) => runtime.service.createPersonalCustomer(input),
      createCompany: (input) => runtime.service.createCompanyAccount(input),
    })(request);
  } finally {
    await runtime.close();
  }
}
