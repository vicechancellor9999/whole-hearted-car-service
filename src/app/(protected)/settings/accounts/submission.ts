import { z } from "zod";
import type {
  AccountActionContext,
  AccountService,
} from "@/modules/accounts/account-service";
import { accountRoleSchema } from "@/modules/accounts/account-schemas";

const accountIdSchema = z.coerce.number().int().positive();
const enabledSchema = z.enum(["true", "false"]).transform((value) => value === "true");

const accountManagementSubmissionSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    displayName: z.string(),
    username: z.string(),
    password: z.string().min(1).max(1_024),
    role: accountRoleSchema,
  }),
  z.object({
    operation: z.literal("rename"),
    accountId: accountIdSchema,
    displayName: z.string(),
  }),
  z.object({
    operation: z.literal("change_role"),
    accountId: accountIdSchema,
    role: accountRoleSchema,
  }),
  z.object({
    operation: z.literal("set_active"),
    accountId: accountIdSchema,
    enabled: enabledSchema,
  }),
  z.object({
    operation: z.literal("reset_password"),
    accountId: accountIdSchema,
    newPassword: z.string().min(1).max(1_024),
  }),
  z.object({
    operation: z.literal("force_logout"),
    accountId: accountIdSchema,
  }),
  z.object({
    operation: z.literal("set_sensitive_permission"),
    accountId: accountIdSchema,
    enabled: enabledSchema,
  }),
]);

export type AccountManagementSubmission = z.infer<
  typeof accountManagementSubmissionSchema
>;

export function parseAccountManagementSubmission(
  formData: FormData,
): AccountManagementSubmission {
  return accountManagementSubmissionSchema.parse(
    Object.fromEntries(formData.entries()),
  );
}

type AccountManagementService = Pick<
  AccountService,
  | "createAccount"
  | "updateDisplayName"
  | "changeAccountRole"
  | "setAccountActive"
  | "resetPassword"
  | "forceLogout"
  | "setSensitiveOperationsPermission"
>;

export async function executeAccountManagementSubmission(
  submission: AccountManagementSubmission,
  service: AccountManagementService,
  context: AccountActionContext,
) {
  switch (submission.operation) {
    case "create":
      await service.createAccount({ ...submission, context });
      return "账号已创建";
    case "rename":
      await service.updateDisplayName({ ...submission, context });
      return "显示名已保存";
    case "change_role":
      await service.changeAccountRole({ ...submission, context });
      return "角色已保存";
    case "set_active":
      await service.setAccountActive({
        accountId: submission.accountId,
        isActive: submission.enabled,
        context,
      });
      return submission.enabled ? "账号已启用" : "账号已停用";
    case "reset_password":
      await service.resetPassword({
        accountId: submission.accountId,
        newPassword: submission.newPassword,
        context,
      });
      return "密码已重置，旧会话已失效";
    case "force_logout":
      await service.forceLogout({ accountId: submission.accountId, context });
      return "该账号的全部会话已失效";
    case "set_sensitive_permission":
      await service.setSensitiveOperationsPermission({
        accountId: submission.accountId,
        enabled: submission.enabled,
        context,
      });
      return submission.enabled
        ? "前台敏感操作权限已开启"
        : "前台敏感操作权限已关闭";
  }
}
