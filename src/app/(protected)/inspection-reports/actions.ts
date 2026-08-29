"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId } from "@/lib/request-id";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import type { BusinessOrderActionContext } from "@/modules/business-order/business-order-service";
import {
  InspectionReportAccessDeniedError,
  InspectionReportNotFoundError,
  InspectionReportValidationError,
} from "@/modules/inspection-report/inspection-report-service";
import { requirePermission } from "@/modules/permissions/require-permission";

const positiveId = z.coerce.number().int().positive();

function optionalId(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? positiveId.parse(text) : null;
}

export async function inspectionReportAction(formData: FormData): Promise<never> {
  const [session, requestHeaders] = await Promise.all([currentSession(), headers()]);
  const actor = requirePermission(session, "business_order.write");
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const context: BusinessOrderActionContext = {
    actorAccountId: actor.id,
    requestId: requestHeaders.get("x-request-id") ?? createRequestId(),
    ipAddress: forwardedFor?.split(",")[0]?.trim() || null,
    userAgent: requestHeaders.get("user-agent"),
  };
  const runtime = createBusinessOrderRuntime();
  const operation = String(formData.get("operation") ?? "");
  const vehicleId = positiveId.parse(formData.get("vehicleId"));
  let message = "操作已完成";
  let error: string | null = null;
  try {
    if (operation === "create_inspection_report") {
      const findingZh = String(formData.get("findingZh") ?? "").trim();
      const findingEn = String(formData.get("findingEn") ?? "").trim();
      const recommendationZh = String(formData.get("recommendationZh") ?? "").trim();
      const recommendationEn = String(formData.get("recommendationEn") ?? "").trim();
      await runtime.inspectionReports.createInspectionReport({
        vehicleId,
        inspectionTeamId: positiveId.parse(formData.get("inspectionTeamId")),
        sourceBusinessOrderId: optionalId(formData.get("sourceBusinessOrderId")),
        sourceRepairRoundId: optionalId(formData.get("sourceRepairRoundId")),
        actualInspectorStaffMemberId: optionalId(formData.get("actualInspectorStaffMemberId")),
        summaryZh: String(formData.get("summaryZh") ?? ""),
        summaryEn: String(formData.get("summaryEn") ?? ""),
        specialCaseNotesZh: String(formData.get("specialCaseNotesZh") ?? ""),
        findings: findingZh ? [{
          findingZh,
          findingEn,
          recommendationZh,
          recommendationEn,
        }] : [],
        context,
      });
      message = "Inspection Report 草稿已创建";
    } else if (operation === "submit_inspection_report") {
      await runtime.inspectionReports.submitInspectionReport({
        inspectionReportId: positiveId.parse(formData.get("inspectionReportId")),
        expectedVersion: positiveId.parse(formData.get("expectedVersion")),
        context,
      });
      message = "Inspection Report 已正式提交并归档";
    } else {
      throw new Error("未知 Inspection Report 操作");
    }
  } catch (caught) {
    error = toPublicError(caught);
  } finally {
    await runtime.close();
  }
  revalidatePath("/inspection-reports");
  const query = new URLSearchParams({ vehicleId: String(vehicleId), ...(error ? { error } : { success: message }) });
  redirect(`/inspection-reports?${query.toString()}`);
}

function toPublicError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "提交内容不完整或无效";
  if (
    error instanceof InspectionReportValidationError ||
    error instanceof InspectionReportNotFoundError ||
    error instanceof InspectionReportAccessDeniedError
  ) return error.message;
  return "操作失败，请刷新后重试";
}
