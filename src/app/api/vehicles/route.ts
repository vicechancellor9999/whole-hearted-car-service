import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@formal/modules/customer-vehicle/customer-vehicle-runtime";
import { optionalIntegerField, optionalTextField } from "@formal/app/api/vehicles/vehicle-api-fields";

type VehicleApiSession = { account: { id: number } };
type VehicleOwner = { type: "person" | "company"; id: number };
type VehicleCreateContext = {
  actorAccountId: number;
  requestId: string;
  userAgent: string | null;
};

type VehicleApiDependencies = {
  readSession(): Promise<VehicleApiSession | null>;
  listVehicles?(input: {
    viewerAccountId: number;
    search?: string;
    activeOnly: boolean;
    page: number;
    pageSize: number;
  }): Promise<unknown>;
  resolveOwner(customerNo: string, viewerAccountId: number): Promise<VehicleOwner | null>;
  createVehicle(input: {
    plate?: string;
    vin?: string;
    engineNumber?: string;
    make: string;
    makeZh?: string;
    model: string;
    modelZh?: string;
    modelYear?: number | null;
    color?: string;
    bodyType?: string;
    fuelType?: string;
    engineCc?: number | null;
    seating?: number | null;
    usage?: string;
    specialNotes?: string;
    ownerType: "person" | "company";
    ownerId: number;
    context: VehicleCreateContext;
  }): Promise<unknown>;
};

type VehicleCreateBody = {
  plate?: unknown;
  vin?: unknown;
  engineNumber?: unknown;
  make?: unknown;
  makeZh?: unknown;
  model?: unknown;
  modelZh?: unknown;
  modelYear?: unknown;
  color?: unknown;
  bodyType?: unknown;
  fuelType?: unknown;
  engineCc?: unknown;
  seating?: unknown;
  usage?: unknown;
  specialNotes?: unknown;
  ownerCustomerNo?: unknown;
};

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createVehicleApiHandler(dependencies: VehicleApiDependencies) {
  return async function vehicleApiHandler(request: Request): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      if (request.method === "GET") {
        if (!dependencies.listVehicles) {
          return NextResponse.json({ error: "车辆搜索服务不可用" }, { status: 503 });
        }
        const url = new URL(request.url);
        const search = url.searchParams.get("search")?.normalize("NFKC").trim() || undefined;
        const requestedPageSize = Number(url.searchParams.get("pageSize"));
        const pageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
          ? Math.min(requestedPageSize, 8)
          : 8;
        return NextResponse.json(await dependencies.listVehicles({
          viewerAccountId: session.account.id,
          ...(search ? { search } : {}),
          activeOnly: true,
          page: 1,
          pageSize,
        }));
      }
      if (request.method !== "POST") {
        return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
      }
      const body = await request.json() as VehicleCreateBody;
      const plate = optionalTextField(body.plate);
      const make = requiredText(body.make);
      const model = requiredText(body.model);
      const ownerCustomerNo = requiredText(body.ownerCustomerNo);
      if (!make || !model || !ownerCustomerNo) {
        return NextResponse.json({ error: "品牌、车型和当前客户不能为空" }, { status: 400 });
      }
      const owner = await dependencies.resolveOwner(ownerCustomerNo, session.account.id);
      if (!owner) return NextResponse.json({ error: "当前客户档案不存在" }, { status: 400 });
      const modelYear = optionalIntegerField(body.modelYear, "年份", 1886, 2200) ?? null;
      const engineCc = optionalIntegerField(body.engineCc, "排量 CC", 1, 30_000) ?? null;
      const seating = optionalIntegerField(body.seating, "座位数", 1, 200) ?? null;
      const record = await dependencies.createVehicle({
        plate,
        vin: optionalTextField(body.vin),
        engineNumber: optionalTextField(body.engineNumber),
        make,
        makeZh: optionalTextField(body.makeZh),
        model,
        modelZh: optionalTextField(body.modelZh),
        modelYear,
        color: optionalTextField(body.color),
        bodyType: optionalTextField(body.bodyType),
        fuelType: optionalTextField(body.fuelType),
        engineCc,
        seating,
        usage: optionalTextField(body.usage),
        specialNotes: optionalTextField(body.specialNotes),
        ownerType: owner.type,
        ownerId: owner.id,
        context: {
          actorAccountId: session.account.id,
          requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
          userAgent: request.headers.get("user-agent"),
        },
      });
      return NextResponse.json({ record }, { status: 201 });
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : 400;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "车辆档案保存失败" },
        { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400 },
      );
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const runtime = createCustomerVehicleRuntime(process.env);
  try {
    return await createVehicleApiHandler({
      readSession: currentSession,
      resolveOwner: async (customerNo, viewerAccountId) => {
        const [people, companies] = await Promise.all([
          runtime.service.listPersonalCustomers({ viewerAccountId, search: customerNo, page: 1, pageSize: 100 }),
          runtime.service.listCompanyAccounts({ viewerAccountId, search: customerNo, page: 1, pageSize: 100 }),
        ]);
        const person = people.items.find((candidate) => candidate.customerNo === customerNo);
        if (person) return { type: "person", id: person.id };
        const company = companies.items.find((candidate) => candidate.companyNo === customerNo);
        return company ? { type: "company", id: company.id } : null;
      },
      createVehicle: (input) => runtime.service.createVehicle(input),
      listVehicles: (input) => runtime.service.listVehicles(input),
    })(request);
  } finally {
    await runtime.close();
  }
}

export async function GET(request: Request): Promise<Response> {
  return POST(request);
}
