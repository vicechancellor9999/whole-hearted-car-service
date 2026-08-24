import { readFile } from "node:fs/promises";
import { currentSession } from "@/modules/auth/current-session";
import { requirePermission } from "@/modules/permissions/require-permission";
import { createCustomerVehicleRuntime } from "@/modules/customer-vehicle/customer-vehicle-runtime";
import { CustomerVehicleNotFoundError } from "@/modules/customer-vehicle/customer-vehicle-service";
import { storedVehicleUploadPath } from "@/modules/customer-vehicle/attachment-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await currentSession();
  let viewer;
  try {
    viewer = requirePermission(session, "customer_vehicle.read");
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const fileId = Number((await params).fileId);
  if (!Number.isSafeInteger(fileId) || fileId < 1) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const runtime = createCustomerVehicleRuntime();
  try {
    const attachment = await runtime.service.getVehicleAttachmentFile({
      viewerAccountId: viewer.id,
      fileId,
    });
    const bytes = await readFile(storedVehicleUploadPath(attachment.storageKey));
    const encodedName = encodeURIComponent(attachment.originalName);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": attachment.mediaType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CustomerVehicleNotFoundError ||
        (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw error;
  } finally {
    await runtime.close();
  }
}
