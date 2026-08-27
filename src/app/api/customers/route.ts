import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "@formal/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@formal/modules/customer-vehicle/customer-vehicle-runtime";
import {
  removeStoredCustomerDriverLicenseUpload,
  storeCustomerDriverLicenseUpload,
  CustomerDriverLicenseStorageError,
  type CustomerLicenseImageTransform,
  type StoredCustomerDriverLicenseUpload,
} from "@formal/modules/customer-vehicle/customer-driver-license-storage";
import { customerDriverLicenseProfileSchema } from "@formal/modules/customer-vehicle/customer-driver-license-schemas";
import type {
  CompanyPrimaryContactInput,
  CustomerLicenseWrite,
} from "@formal/modules/customer-vehicle/customer-vehicle-service";
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
  createPersonWithLicense?(input: {
    fullName: string; phone?: string; whatsapp?: string; email?: string;
    address?: string; trn?: string; license?: CustomerLicenseWrite;
    context: CustomerCreateContext;
  }): Promise<{ record: unknown; driverLicense: unknown }>;
  createCompanyWithPrimaryContact?(input: {
    legalName: string; phone?: string; email?: string; address?: string; trn?: string;
    primaryContact?: CompanyPrimaryContactInput;
    license?: CustomerLicenseWrite;
    context: CustomerCreateContext;
  }): Promise<{ record: unknown; primaryContact: unknown; driverLicense: unknown }>;
  storeLicense?(file: File, transform: CustomerLicenseImageTransform): Promise<StoredCustomerDriverLicenseUpload>;
  removeLicense?(storageKey: string): Promise<void>;
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

    let storedLicense: StoredCustomerDriverLicenseUpload | null = null;
    let committed = false;
    try {
      if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
        const form = await request.formData();
        const rawPayload = form.get("payload");
        const files = form.getAll("licenseFront");
        if (typeof rawPayload !== "string" || form.getAll("payload").length !== 1 || files.length > 1) {
          return NextResponse.json({ error: "客户建档资料格式不正确" }, { status: 400 });
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawPayload);
        } catch {
          return NextResponse.json({ error: "客户建档资料格式不正确" }, { status: 400 });
        }
        const payload = multipartCustomerPayloadSchema.parse(parsedJson);
        const image = files[0];
        const licenseFile = isFilePart(image) ? image : null;
        if ((payload.license && !licenseFile) || (!payload.license && licenseFile)) {
          return NextResponse.json({ error: "驾驶证图片和核对资料必须同时提供" }, { status: 400 });
        }
        const context = createContext(request, session.account.id);
        let license: CustomerLicenseWrite | undefined;
        if (payload.license && licenseFile) {
          const store = dependencies.storeLicense ?? storeCustomerDriverLicenseUpload;
          storedLicense = await store(licenseFile, payload.license.transform);
          license = {
            file: storedLicense,
            profile: payload.license.profile,
            verified: payload.license.verified,
          };
        }
        if (payload.customerType === "individual") {
          if (!dependencies.createPersonWithLicense) throw new Error("客户复合建档服务不可用");
          const result = await dependencies.createPersonWithLicense({
            fullName: payload.fullName,
            phone: payload.phone ?? undefined,
            whatsapp: payload.whatsapp ?? undefined,
            email: payload.email ?? undefined,
            address: payload.address ?? undefined,
            trn: payload.trn ?? undefined,
            license,
            context,
          });
          committed = true;
          return NextResponse.json({ kind: "person", ...result }, { status: 201 });
        }
        if (!dependencies.createCompanyWithPrimaryContact) throw new Error("公司复合建档服务不可用");
        const result = await dependencies.createCompanyWithPrimaryContact({
          legalName: payload.organizationName,
          phone: payload.phone ?? undefined,
          email: payload.email ?? undefined,
          address: payload.address ?? undefined,
          trn: payload.trn ?? undefined,
          primaryContact: toPrimaryContactInput(payload.primaryContact),
          license,
          context,
        });
        committed = true;
        return NextResponse.json({ kind: "company", ...result }, { status: 201 });
      }
      const body = await request.json() as CustomerCreateBody;
      const context = createContext(request, session.account.id);
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
      if (storedLicense && !committed) {
        await (dependencies.removeLicense ?? removeStoredCustomerDriverLicenseUpload)(
          storedLicense.storageKey,
        ).catch(() => undefined);
      }
      const result = customerApiError(error);
      return NextResponse.json(
        { error: result.message },
        { status: result.status },
      );
    }
  };
}

const optionalPayloadText = z.string().trim().max(500).nullable().optional();
const licensePayloadSchema = z.object({
  profile: customerDriverLicenseProfileSchema,
  verified: z.boolean(),
  transform: z.object({
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    crop: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    }).refine((crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1).nullable(),
  }).strict(),
}).strict();
const newPrimaryContactSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  phone: optionalPayloadText,
  whatsapp: optionalPayloadText,
  email: optionalPayloadText,
  address: optionalPayloadText,
  trn: optionalPayloadText,
  jobTitle: optionalPayloadText,
}).strict();
const primaryContactSchema = z.union([
  z.object({ existingPersonalCustomerNo: z.string().trim().min(1), newPrimaryContact: z.never().optional() }).strict(),
  z.object({ existingPersonalCustomerNo: z.never().optional(), newPrimaryContact: newPrimaryContactSchema }).strict(),
]);
const multipartCustomerPayloadSchema = z.discriminatedUnion("customerType", [
  z.object({
    customerType: z.literal("individual"),
    fullName: z.string().trim().min(1).max(160),
    phone: optionalPayloadText,
    whatsapp: optionalPayloadText,
    email: optionalPayloadText,
    address: optionalPayloadText,
    trn: optionalPayloadText,
    license: licensePayloadSchema.optional(),
  }).strict(),
  z.object({
    customerType: z.literal("organization"),
    organizationName: z.string().trim().min(1).max(200),
    phone: optionalPayloadText,
    email: optionalPayloadText,
    address: optionalPayloadText,
    trn: optionalPayloadText,
    primaryContact: primaryContactSchema.optional(),
    license: licensePayloadSchema.optional(),
  }).strict(),
]);

function createContext(request: Request, actorAccountId: number): CustomerCreateContext {
  return {
    actorAccountId,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    userAgent: request.headers.get("user-agent"),
  };
}

function isFilePart(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === "object" &&
    "arrayBuffer" in value && typeof value.arrayBuffer === "function" &&
    "name" in value && typeof value.name === "string" &&
    "type" in value && typeof value.type === "string" &&
    "size" in value && typeof value.size === "number");
}

function toPrimaryContactInput(
  value: z.infer<typeof primaryContactSchema> | undefined,
): CompanyPrimaryContactInput | undefined {
  if (!value) return undefined;
  if (typeof value.existingPersonalCustomerNo === "string") {
    return { existingPersonalCustomerNo: value.existingPersonalCustomerNo };
  }
  if (!value.newPrimaryContact) return undefined;
  return { newPrimaryContact: {
    fullName: value.newPrimaryContact.fullName,
    phone: value.newPrimaryContact.phone ?? undefined,
    whatsapp: value.newPrimaryContact.whatsapp ?? undefined,
    email: value.newPrimaryContact.email ?? undefined,
    address: value.newPrimaryContact.address ?? undefined,
    trn: value.newPrimaryContact.trn ?? undefined,
    jobTitle: value.newPrimaryContact.jobTitle ?? undefined,
  } };
}

function customerApiError(error: unknown): { status: number; message: string } {
  if (error instanceof z.ZodError) {
    return { status: 400, message: error.issues[0]?.message ?? "客户建档资料格式不正确" };
  }
  if (error instanceof SyntaxError) return { status: 400, message: "客户建档资料格式不正确" };
  if (error instanceof CustomerDriverLicenseStorageError) return { status: 400, message: error.message };
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : 500;
  if (Number.isInteger(status) && status >= 400 && status <= 499 && error instanceof Error) {
    return { status, message: error.message };
  }
  return { status: 500, message: "客户档案保存失败，请重试" };
}

export async function POST(request: Request): Promise<Response> {
  const runtime = createCustomerVehicleRuntime(process.env);
  try {
    return await createCustomerApiHandler({
      readSession: currentSession,
      createPerson: (input) => runtime.service.createPersonalCustomer(input),
      createCompany: (input) => runtime.service.createCompanyAccount(input),
      createPersonWithLicense: (input) => runtime.service.createPersonalCustomerWithLicense(input),
      createCompanyWithPrimaryContact: (input) => runtime.service.createCompanyWithPrimaryContact(input),
    })(request);
  } finally {
    await runtime.close();
  }
}
