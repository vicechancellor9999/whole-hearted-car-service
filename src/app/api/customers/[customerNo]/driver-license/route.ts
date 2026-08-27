import { z } from "zod";
import { currentSession } from "@formal/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@formal/modules/customer-vehicle/customer-vehicle-runtime";
import { customerDriverLicenseProfileSchema, type LicenseSubject } from "@formal/modules/customer-vehicle/customer-driver-license-schemas";
import {
  CustomerDriverLicenseStorageError,
  removeStoredCustomerDriverLicenseUpload,
  storeCustomerDriverLicenseUpload,
  type CustomerLicenseImageTransform,
  type StoredCustomerDriverLicenseUpload,
} from "@formal/modules/customer-vehicle/customer-driver-license-storage";
import type {
  CustomerDriverLicenseActionContext,
  CustomerDriverLicenseRecord,
} from "@formal/modules/customer-vehicle/customer-driver-license-service";

type Dependencies = {
  readSession(): Promise<{ account: { id: number } } | null>;
  resolveSubject(input: { viewerAccountId: number; customerNo: string }): Promise<LicenseSubject>;
  store(file: File, transform: CustomerLicenseImageTransform): Promise<StoredCustomerDriverLicenseUpload>;
  save(input: {
    subject: LicenseSubject;
    file: StoredCustomerDriverLicenseUpload;
    profile: z.infer<typeof customerDriverLicenseProfileSchema>;
    verified: boolean;
    context: CustomerDriverLicenseActionContext;
  }): Promise<CustomerDriverLicenseRecord>;
  remove(storageKey: string): Promise<void>;
};

const payloadSchema = z.object({
  profile: customerDriverLicenseProfileSchema,
  verified: z.boolean(),
  transform: z.object({
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    crop: z.object({
      x: z.number().min(0).max(1), y: z.number().min(0).max(1),
      width: z.number().positive().max(1), height: z.number().positive().max(1),
    }).refine((crop) => crop.x + crop.width <= 1 && crop.y + crop.height <= 1).nullable(),
  }).strict(),
}).strict();

export function createCustomerDriverLicenseSupplementHandler(dependencies: Dependencies) {
  return async function handler(
    request: Request,
    context: { params: Promise<{ customerNo: string }> },
  ): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
    let stored: StoredCustomerDriverLicenseUpload | null = null;
    let committed = false;
    try {
      const form = await request.formData();
      const rawPayload = form.get("payload");
      const image = form.get("licenseFront");
      if (typeof rawPayload !== "string" || form.getAll("payload").length !== 1 ||
          !isFilePart(image) || form.getAll("licenseFront").length !== 1) {
        return Response.json({ error: "驾驶证补录资料格式不正确" }, { status: 400 });
      }
      const payload = payloadSchema.parse(JSON.parse(rawPayload));
      const customerNo = decodeURIComponent((await context.params).customerNo);
      const subject = await dependencies.resolveSubject({
        viewerAccountId: session.account.id,
        customerNo,
      });
      stored = await dependencies.store(image, payload.transform);
      const record = await dependencies.save({
        subject,
        file: stored,
        profile: payload.profile,
        verified: payload.verified,
        context: {
          actorAccountId: session.account.id,
          requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
          userAgent: request.headers.get("user-agent"),
        },
      });
      committed = true;
      return Response.json({ record }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (stored && !committed) await dependencies.remove(stored.storageKey).catch(() => undefined);
      const result = supplementApiError(error);
      return Response.json(
        { error: result.message },
        { status: result.status },
      );
    }
  };
}

function isFilePart(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value === "object" &&
    "arrayBuffer" in value && typeof value.arrayBuffer === "function" &&
    "name" in value && typeof value.name === "string" &&
    "type" in value && typeof value.type === "string" &&
    "size" in value && typeof value.size === "number");
}

function supplementApiError(error: unknown): { status: number; message: string } {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return { status: 400, message: "驾驶证补录资料格式不正确" };
  }
  if (error instanceof CustomerDriverLicenseStorageError) return { status: 400, message: error.message };
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : 500;
  if (Number.isInteger(status) && status >= 400 && status <= 499 && error instanceof Error) {
    return { status, message: error.message };
  }
  return { status: 500, message: "驾驶证补录失败，请重试" };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ customerNo: string }> },
): Promise<Response> {
  const runtime = createCustomerVehicleRuntime();
  try {
    return await createCustomerDriverLicenseSupplementHandler({
      readSession: currentSession,
      resolveSubject: (input) => runtime.driverLicenseService.resolveSubjectByCustomerNo(input),
      store: storeCustomerDriverLicenseUpload,
      save: (input) => runtime.driverLicenseService.recordOrReplace(input),
      remove: removeStoredCustomerDriverLicenseUpload,
    })(request, context);
  } finally {
    await runtime.close();
  }
}
