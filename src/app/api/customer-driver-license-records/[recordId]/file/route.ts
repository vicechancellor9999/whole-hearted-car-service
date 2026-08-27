import { readFile } from "node:fs/promises";
import { currentSession } from "@formal/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@formal/modules/customer-vehicle/customer-vehicle-runtime";
import { storedCustomerDriverLicenseUploadPath } from "@formal/modules/customer-vehicle/customer-driver-license-storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ recordId: string }> },
): Promise<Response> {
  const session = await currentSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const recordId = Number((await context.params).recordId);
  if (!Number.isSafeInteger(recordId) || recordId < 1) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const runtime = createCustomerVehicleRuntime();
  try {
    const file = await runtime.driverLicenseService.getFile({
      viewerAccountId: session.account.id,
      recordId,
    });
    const bytes = await readFile(storedCustomerDriverLicenseUploadPath(file.storageKey));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mediaType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500;
    return Response.json({ error: status === 404 ? "not_found" : "file_unavailable" }, { status });
  } finally {
    await runtime.close();
  }
}
