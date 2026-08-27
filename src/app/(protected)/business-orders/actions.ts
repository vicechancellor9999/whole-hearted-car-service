"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId } from "@/lib/request-id";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import {
  BusinessOrderConflictError,
  BusinessOrderNotFoundError,
  BusinessOrderValidationError,
  BusinessOrderWriteDeniedError,
  type BusinessOrderActionContext,
} from "@/modules/business-order/business-order-service";
import {
  RepairRoundNotFoundError,
  RepairRoundValidationError,
  RepairRoundWriteDeniedError,
} from "@/modules/business-order/repair-round-service";
import {
  FormalHandoffNotFoundError,
  FormalHandoffValidationError,
  FormalHandoffWriteDeniedError,
} from "@/modules/business-order/formal-handoff-service";
import { requirePermission } from "@/modules/permissions/require-permission";

const positiveId = z.coerce.number().int().positive();
const positiveVersion = z.coerce.number().int().positive();

function optionalPositiveId(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? positiveId.parse(text) : null;
}

function jsonArray(value: FormDataEntryValue | null) {
  const parsed: unknown = JSON.parse(String(value ?? "[]"));
  if (!Array.isArray(parsed)) throw new Error("提交内容不是数组");
  return parsed;
}

export async function businessOrderAction(formData: FormData): Promise<never> {
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
  let destination = "/business-orders";
  let message = "操作已完成";
  let error: string | null = null;
  try {
    if (operation === "create_business_order") {
      const created = await runtime.service.createBusinessOrder({
        vehicleId: positiveId.parse(formData.get("vehicleId")),
        companyContactId: optionalPositiveId(formData.get("companyContactId")),
        context,
      });
      destination = `/business-orders/${created.id}`;
      message = "Business Order 已创建";
    } else {
      const businessOrderId = positiveId.parse(formData.get("businessOrderId"));
      destination = `/business-orders/${businessOrderId}`;
      if (operation === "replace_charges") {
        await runtime.service.replaceChargeVersion({
          businessOrderId,
          expectedBusinessOrderVersion: positiveVersion.parse(formData.get("expectedBusinessOrderVersion")),
          reason: String(formData.get("reason") ?? ""),
          laborDiscount: String(formData.get("laborDiscount") ?? "0"),
          partDiscount: String(formData.get("partDiscount") ?? "0"),
          otherDiscount: String(formData.get("otherDiscount") ?? "0"),
          wholeOrderDiscount: "0",
          items: jsonArray(formData.get("itemsJson")) as Parameters<typeof runtime.service.replaceChargeVersion>[0]["items"],
          notes: jsonArray(formData.get("notesJson")) as Parameters<typeof runtime.service.replaceChargeVersion>[0]["notes"],
          context,
        });
        message = "收费项目已保存为新版本";
      } else if (operation === "void_business_order") {
        await runtime.service.voidBusinessOrder({
          businessOrderId,
          expectedBusinessOrderVersion: positiveVersion.parse(formData.get("expectedBusinessOrderVersion")),
          reason: String(formData.get("reason") ?? ""),
          context,
        });
        message = "Business Order 已作废";
      } else if (operation === "assign_round") {
        const result = await runtime.repairRounds.assignRound({
          businessOrderId,
          expectedBusinessOrderVersion: positiveVersion.parse(formData.get("expectedBusinessOrderVersion")),
          teamId: positiveId.parse(formData.get("teamId")),
          customerConfirmedWithoutPayment: formData.get("customerConfirmedWithoutPayment") === "true",
          context,
        });
        if (!result.assigned) throw new RepairRoundValidationError("尚未确认客户认可本单内容，未执行派单");
        message = "已派给维修班组";
      } else if (operation === "record_intake_mileage") {
        await runtime.repairRounds.recordIntakeMileage({
          businessOrderId,
          expectedRepairRoundVersion: positiveVersion.parse(formData.get("expectedRepairRoundVersion")),
          odometerKm: z.coerce.number().int().nonnegative().parse(formData.get("odometerKm")),
          context,
        });
        message = "接车里程已记录";
      } else if (operation === "submit_work_return") {
        await runtime.repairRounds.submitWorkReturn({
          businessOrderId,
          expectedRepairRoundVersion: positiveVersion.parse(formData.get("expectedRepairRoundVersion")),
          actualStaffMemberId: positiveId.parse(formData.get("actualStaffMemberId")),
          workSummary: String(formData.get("workSummary") ?? ""),
          context,
        });
        message = "维修回单已提交审核";
      } else if (operation === "approve_work_return") {
        await runtime.repairRounds.approveWorkReturn({
          businessOrderId,
          expectedRepairRoundVersion: positiveVersion.parse(formData.get("expectedRepairRoundVersion")),
          workReturnId: positiveId.parse(formData.get("workReturnId")),
          context,
        });
        message = "维修回单已审核通过";
      } else if (operation === "return_work_return") {
        await runtime.repairRounds.returnWorkReturn({
          businessOrderId,
          expectedRepairRoundVersion: positiveVersion.parse(formData.get("expectedRepairRoundVersion")),
          workReturnId: positiveId.parse(formData.get("workReturnId")),
          reason: String(formData.get("reason") ?? ""),
          context,
        });
        message = "维修回单已退回";
      } else if (operation === "formal_handoff") {
        await runtime.formalHandoffs.formallyHandOffRound({
          businessOrderId,
          expectedRepairRoundVersion: positiveVersion.parse(formData.get("expectedRepairRoundVersion")),
          performanceValue: String(formData.get("performanceValue") ?? ""),
          context,
        });
        message = "本轮已正式交单，绩效事实已经落地";
      } else if (operation === "cancel_formal_handoff") {
        await runtime.formalHandoffs.cancelFormalHandoffInSameMonth({
          businessOrderId,
          formalHandoffId: positiveId.parse(formData.get("formalHandoffId")),
          reason: String(formData.get("reason") ?? ""),
          context,
        });
        message = "本次正式交单已在同月取消，原事实仍保留";
      } else if (operation === "start_after_sales_round") {
        await runtime.repairRounds.startAfterSalesRound({
          businessOrderId,
          expectedBusinessOrderVersion: positiveVersion.parse(
            formData.get("expectedBusinessOrderVersion"),
          ),
          issue: String(formData.get("issue") ?? ""),
          context,
        });
        message = "售后维修轮次已创建，等待派单";
      } else {
        throw new Error("未知 Business Order 操作");
      }
    }
  } catch (caught) {
    error = toPublicError(caught);
  } finally {
    await runtime.close();
  }
  revalidatePath("/business-orders");
  revalidatePath(destination);
  const query = new URLSearchParams(error ? { error } : { success: message });
  redirect(`${destination}?${query.toString()}`);
}

function toPublicError(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "提交内容不完整或无效";
  if (error instanceof SyntaxError) return "收费项目或备注数据格式不正确";
  if (
    error instanceof BusinessOrderConflictError ||
    error instanceof BusinessOrderNotFoundError ||
    error instanceof BusinessOrderValidationError ||
    error instanceof BusinessOrderWriteDeniedError ||
    error instanceof RepairRoundNotFoundError ||
    error instanceof RepairRoundValidationError ||
    error instanceof RepairRoundWriteDeniedError ||
    error instanceof FormalHandoffNotFoundError ||
    error instanceof FormalHandoffValidationError ||
    error instanceof FormalHandoffWriteDeniedError
  ) return error.message;
  return "操作失败，请刷新后重试";
}
