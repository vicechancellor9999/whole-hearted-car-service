import { currentSession } from "@formal/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@formal/modules/customer-vehicle/customer-vehicle-runtime";

export async function GET(
  _request: Request,
  context: { params: Promise<{ customerNo: string }> },
): Promise<Response> {
  const session = await currentSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const runtime = createCustomerVehicleRuntime();
  try {
    const customerNo = decodeURIComponent((await context.params).customerNo);
    const subject = await runtime.driverLicenseService.resolveSubjectByCustomerNo({
      viewerAccountId: session.account.id,
      customerNo,
    });
    const records = await runtime.driverLicenseService.history({
      viewerAccountId: session.account.id,
      subject,
    });
    return Response.json({ records }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : "驾驶证记录读取失败" },
      { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400 },
    );
  } finally {
    await runtime.close();
  }
}
