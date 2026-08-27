import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@formal/modules/customer-vehicle/customer-vehicle-runtime";
import { optionalIntegerField, optionalTextField } from "@formal/app/api/vehicles/vehicle-api-fields";
import type {
  CustomerVehicleActionContext,
  VehicleRecord,
} from "@formal/modules/customer-vehicle/customer-vehicle-service";

type VehicleDetailSession = { account: { id: number } };
type VehicleProfileUpdateInput = {
  vehicleId: number;
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
  isActive: boolean;
  version: number;
  context: CustomerVehicleActionContext;
};
type VehicleDetailApiDependencies = {
  readSession(): Promise<VehicleDetailSession | null>;
  findVehicle(vehicleNo: string, viewerAccountId: number): Promise<VehicleRecord | null>;
  updateVehicle(input: VehicleProfileUpdateInput): Promise<unknown>;
  resolveOwner?(customerNo: string, viewerAccountId: number): Promise<{ type: "person" | "company"; id: number } | null>;
  updateVehicleWithOwner?(input: VehicleProfileUpdateInput & {
    ownerType: "person" | "company";
    ownerId: number;
    reason: string;
  }): Promise<unknown>;
};

type VehicleUpdateBody = {
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
  isActive?: unknown;
  version?: unknown;
  ownerCustomerNo?: unknown;
  ownerChangeReason?: unknown;
};

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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

export function createVehicleDetailApiHandler(dependencies: VehicleDetailApiDependencies) {
  return async function vehicleDetailApiHandler(
    request: Request,
    params: { vehicleNo: string },
  ): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    try {
      const vehicleNo = decodeURIComponent(params.vehicleNo).trim();
      const vehicle = await dependencies.findVehicle(vehicleNo, session.account.id);
      if (!vehicle) return NextResponse.json({ error: "车辆档案不存在" }, { status: 404 });
      if (request.method === "GET") return NextResponse.json({ record: vehicle });
      if (request.method !== "PATCH") {
        return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
      }

      const body = await request.json() as VehicleUpdateBody;
      const plate = patchText(body.plate, vehicle.plateDisplay);
      const make = body.make === undefined ? vehicle.make : requiredText(body.make);
      const model = body.model === undefined ? vehicle.model : requiredText(body.model);
      if (!make || !model) {
        return NextResponse.json({ error: "品牌和车型不能为空" }, { status: 400 });
      }
      if ((body.isActive !== undefined && typeof body.isActive !== "boolean") || !Number.isInteger(body.version) || Number(body.version) <= 0) {
        return NextResponse.json({ error: "档案状态或版本不正确" }, { status: 400 });
      }
      const parsedModelYear = optionalIntegerField(body.modelYear, "年份", 1886, 2200);
      const parsedEngineCc = optionalIntegerField(body.engineCc, "排量 CC", 1, 30_000);
      const parsedSeating = optionalIntegerField(body.seating, "座位数", 1, 200);
      const modelYear = parsedModelYear === undefined ? vehicle.modelYear : parsedModelYear;
      const engineCc = parsedEngineCc === undefined ? vehicle.engineCc : parsedEngineCc;
      const seating = parsedSeating === undefined ? vehicle.seating : parsedSeating;
      const context = {
        actorAccountId: session.account.id,
        requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
        userAgent: request.headers.get("user-agent"),
      };
      const ownerCustomerNo = optionalTextField(body.ownerCustomerNo) ?? null;
      if (ownerCustomerNo && !dependencies.resolveOwner) {
        throw new Error("车辆当前客户查找服务未配置");
      }
      const ownerChangeReason = ownerCustomerNo
        ? optionalTextField(body.ownerChangeReason) ?? "修改车辆当前客户"
        : null;
      const requestedOwner = ownerCustomerNo && dependencies.resolveOwner
        ? await dependencies.resolveOwner(ownerCustomerNo, session.account.id)
        : null;
      if (ownerCustomerNo && dependencies.resolveOwner && !requestedOwner) {
        return NextResponse.json({ error: "当前客户档案不存在" }, { status: 400 });
      }
      const profileInput: VehicleProfileUpdateInput = {
        vehicleId: vehicle.id,
        plate,
        vin: patchText(body.vin, vehicle.vin),
        engineNumber: patchText(body.engineNumber, vehicle.engineNumber),
        make,
        makeZh: patchText(body.makeZh, vehicle.makeZh),
        model,
        modelZh: patchText(body.modelZh, vehicle.modelZh),
        modelYear,
        color: patchText(body.color, vehicle.color),
        bodyType: patchText(body.bodyType, vehicle.bodyType),
        fuelType: patchText(body.fuelType, vehicle.fuelType),
        engineCc,
        seating,
        usage: patchText(body.usage, vehicle.usage),
        specialNotes: patchText(body.specialNotes, vehicle.specialNotes),
        isActive: body.isActive ?? vehicle.isActive,
        version: Number(body.version),
        context,
      };
      const ownerChanged = requestedOwner
        ? requestedOwner.type !== vehicle.currentOwner.type || requestedOwner.id !== vehicle.currentOwner.id
        : false;
      if (ownerChanged && !dependencies.updateVehicleWithOwner) {
        throw new Error("车辆资料与当前客户原子保存服务未配置");
      }
      const record = ownerChanged && requestedOwner && dependencies.updateVehicleWithOwner
        ? await dependencies.updateVehicleWithOwner({
          ...profileInput,
          ownerType: requestedOwner.type,
          ownerId: requestedOwner.id,
          reason: ownerChangeReason ?? "修改车辆当前客户",
        })
        : await dependencies.updateVehicle(profileInput);
      return NextResponse.json({ record });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "车辆档案读取或保存失败" },
        { status: responseStatus(error, 400) },
      );
    }
  };
}

async function handle(request: Request, vehicleNo: string): Promise<Response> {
  const runtime = createCustomerVehicleRuntime(process.env);
  try {
    return await createVehicleDetailApiHandler({
      readSession: currentSession,
      findVehicle: async (number, viewerAccountId) => {
        const result = await runtime.service.listVehicles({
          viewerAccountId,
          search: number,
          page: 1,
          pageSize: 100,
        });
        return result.items.find((candidate) => candidate.vehicleNo === number) ?? null;
      },
      updateVehicle: (input) => runtime.service.updateVehicle(input),
      updateVehicleWithOwner: (input) => runtime.service.updateVehicleWithOwner(input),
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
    })(request, { vehicleNo });
  } finally {
    await runtime.close();
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ vehicleNo: string }> },
): Promise<Response> {
  const params = await context.params;
  return handle(request, params.vehicleNo);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ vehicleNo: string }> },
): Promise<Response> {
  const params = await context.params;
  return handle(request, params.vehicleNo);
}
