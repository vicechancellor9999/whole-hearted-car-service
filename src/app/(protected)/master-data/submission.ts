import { z } from "zod";
import { parseMajorAmountToMinor } from "@/lib/money";
import type {
  MasterDataActionContext,
  MasterDataService,
} from "@/modules/master-data/master-data-service";
import { dictionaryCategorySchema } from "@/modules/master-data/master-data-schemas";

const positiveId = z.coerce.number().int().positive();
const optionalPositiveId = z.preprocess(
  (value) => value === "" || value == null ? undefined : value,
  positiveId.optional(),
);
const booleanField = z.enum(["true", "false"]).transform((value) => value === "true");

const rawSubmissionSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create_dictionary"),
    category: dictionaryCategorySchema,
    code: z.string(),
    labelZh: z.string(),
    labelEn: z.string().optional(),
  }),
  z.object({
    operation: z.literal("update_dictionary"),
    itemId: positiveId,
    labelZh: z.string(),
    labelEn: z.string().optional(),
    isActive: booleanField,
    sortOrder: z.coerce.number().int().nonnegative(),
  }),
  z.object({
    operation: z.literal("create_team"),
    name: z.string(),
  }),
  z.object({
    operation: z.literal("rename_team"),
    teamId: positiveId,
    name: z.string(),
  }),
  z.object({
    operation: z.literal("retire_team"),
    teamId: positiveId,
    replacementTeamId: optionalPositiveId,
    reason: z.string(),
  }),
  z.object({
    operation: z.literal("set_payroll"),
    effectiveMonth: z.string(),
    commissionRate: z.string(),
    cnyToJmdRate: z.string(),
  }),
  z.object({
    operation: z.literal("create_mechanic"),
    fullName: z.string(),
    phone: z.string(),
    positionItemId: positiveId,
    teamId: positiveId,
    hiredOn: z.string(),
    effectiveMonth: z.string(),
    baseSalaryCny: z.string(),
    username: z.string(),
    password: z.string().min(1).max(1_024),
  }),
  z.object({
    operation: z.literal("set_salary"),
    staffMemberId: positiveId,
    effectiveMonth: z.string(),
    baseSalaryCny: z.string(),
  }),
]);

type RawSubmission = z.infer<typeof rawSubmissionSchema>;

export type MasterDataSubmission =
  | Exclude<RawSubmission, { operation: "create_mechanic" | "set_salary" }>
  | {
      operation: "create_mechanic";
      fullName: string;
      phone: string;
      positionItemId: number;
      teamId: number;
      hiredOn: string;
      effectiveMonth: string;
      baseSalaryCnyMinor: number;
      username: string;
      password: string;
    }
  | {
      operation: "set_salary";
      staffMemberId: number;
      effectiveMonth: string;
      baseSalaryCnyMinor: number;
    };

export function parseMasterDataSubmission(formData: FormData): MasterDataSubmission {
  const submission = rawSubmissionSchema.parse(Object.fromEntries(formData.entries()));
  if (submission.operation === "create_mechanic") {
    const { baseSalaryCny, ...rest } = submission;
    return {
      ...rest,
      baseSalaryCnyMinor: parseMajorAmountToMinor(baseSalaryCny),
    };
  }
  if (submission.operation === "set_salary") {
    const { baseSalaryCny, ...rest } = submission;
    return {
      ...rest,
      baseSalaryCnyMinor: parseMajorAmountToMinor(baseSalaryCny),
    };
  }
  return submission;
}

export type MasterDataSubmissionService = Pick<
  MasterDataService,
  | "createDictionaryItem"
  | "updateDictionaryItem"
  | "createRepairTeam"
  | "renameRepairTeam"
  | "retireRepairTeam"
  | "setPayrollParameters"
  | "createMechanic"
  | "setEmployeeSalary"
>;

export async function executeMasterDataSubmission(
  submission: MasterDataSubmission,
  service: MasterDataSubmissionService,
  context: MasterDataActionContext,
): Promise<{ message: string; destination: "/master-data" | "/employees" }> {
  switch (submission.operation) {
    case "create_dictionary":
      await service.createDictionaryItem({ ...submission, context });
      return { message: "字典项目已创建", destination: "/master-data" };
    case "update_dictionary":
      await service.updateDictionaryItem({ ...submission, context });
      return { message: "字典项目已保存", destination: "/master-data" };
    case "create_team":
      await service.createRepairTeam({ name: submission.name, context });
      return { message: "维修班组已创建", destination: "/master-data" };
    case "rename_team":
      await service.renameRepairTeam({ ...submission, context });
      return { message: "维修班组名称已保存", destination: "/master-data" };
    case "retire_team":
      await service.retireRepairTeam({ ...submission, context });
      return { message: "维修班组已停用并完成继承", destination: "/master-data" };
    case "set_payroll":
      await service.setPayrollParameters({ ...submission, context });
      return { message: "整月提成比例和汇率已保存", destination: "/master-data" };
    case "create_mechanic":
      await service.createMechanic({ ...submission, context });
      return { message: "维修工资料和登录账号已创建", destination: "/employees" };
    case "set_salary":
      await service.setEmployeeSalary({ ...submission, context });
      return { message: "员工整月工资版本已保存", destination: "/employees" };
  }
}
