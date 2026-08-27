import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentSession } from "@/modules/auth/current-session";
import type { AccountRole } from "@/modules/auth/auth-service";
import { createMasterDataRuntime } from "@/modules/master-data/master-data-runtime";
import type { MasterDataActionContext, MasterDataService } from "@/modules/master-data/master-data-service";

type Session = { account: { id: number; role: AccountRole } };
type ServiceMethods = Pick<MasterDataService,
  | "listDictionaryItems"
  | "listRepairTeams"
  | "listStaffMembers"
  | "listPayrollParameters"
  | "createRepairTeam"
  | "createDictionaryItem"
  | "updateDictionaryItem"
  | "createMechanic"
  | "renameRepairTeam"
  | "retireRepairTeam"
  | "setEmployeeSalary"
>;

type MasterDataApiDependencies = ServiceMethods & {
  readSession(): Promise<Session | null>;
};

function context(request: Request, actorAccountId: number): MasterDataActionContext {
  return {
    actorAccountId,
    requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: request.headers.get("user-agent"),
  };
}

function text(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === "string" ? body[key] : "";
}

function number(body: Record<string, unknown>, key: string): number {
  return Number(body[key]);
}

export function createMasterDataApiHandler(dependencies: MasterDataApiDependencies) {
  return async function masterDataApiHandler(request: Request): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
      if (request.method === "GET") {
        const payrollParametersPromise = session.account.role === "super_admin" || session.account.role === "owner"
          ? dependencies.listPayrollParameters({ viewerAccountId: session.account.id })
          : Promise.resolve([]);
        const [dictionaries, teams, staff, payrollParameters] = await Promise.all([
          dependencies.listDictionaryItems({ viewerAccountId: session.account.id }),
          dependencies.listRepairTeams({ viewerAccountId: session.account.id }),
          dependencies.listStaffMembers({ viewerAccountId: session.account.id }),
          payrollParametersPromise,
        ]);
        return NextResponse.json({ dictionaries, teams, staff, payrollParameters });
      }

      if (request.method !== "POST") {
        return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
      }
      const body = await request.json() as Record<string, unknown>;
      const action = text(body, "action");
      const actionContext = context(request, session.account.id);
      if (action === "create_team") {
        return NextResponse.json(await dependencies.createRepairTeam({
          name: text(body, "name"), context: actionContext,
        }), { status: 201 });
      }
      if (action === "rename_team") {
        return NextResponse.json(await dependencies.renameRepairTeam({
          teamId: number(body, "teamId"), name: text(body, "name"), context: actionContext,
        }));
      }
      if (action === "retire_team") {
        const replacementTeamId = body.replacementTeamId == null ? undefined : number(body, "replacementTeamId");
        return NextResponse.json(await dependencies.retireRepairTeam({
          teamId: number(body, "teamId"),
          replacementTeamId,
          reason: text(body, "reason"),
          context: actionContext,
        }));
      }
      if (action === "create_dictionary_item") {
        return NextResponse.json(await dependencies.createDictionaryItem({
          category: text(body, "category") as "payment_method" | "charge_unit" | "staff_position",
          code: text(body, "code"),
          labelZh: text(body, "labelZh"),
          labelEn: text(body, "labelEn"),
          context: actionContext,
        }), { status: 201 });
      }
      if (action === "update_dictionary_item") {
        return NextResponse.json(await dependencies.updateDictionaryItem({
          itemId: number(body, "itemId"),
          labelZh: text(body, "labelZh"),
          labelEn: text(body, "labelEn"),
          isActive: body.isActive !== false,
          sortOrder: number(body, "sortOrder"),
          context: actionContext,
        }));
      }
      if (action === "create_mechanic") {
        return NextResponse.json(await dependencies.createMechanic({
          fullName: text(body, "fullName"),
          phone: text(body, "phone"),
          positionItemId: number(body, "positionItemId"),
          teamId: number(body, "teamId"),
          hiredOn: text(body, "hiredOn"),
          effectiveMonth: text(body, "effectiveMonth"),
          baseSalaryCnyMinor: number(body, "baseSalaryCnyMinor"),
          username: text(body, "username"),
          password: text(body, "password"),
          context: actionContext,
        }), { status: 201 });
      }
      if (action === "set_employee_salary") {
        await dependencies.setEmployeeSalary({
          staffMemberId: number(body, "staffMemberId"),
          effectiveMonth: text(body, "effectiveMonth"),
          baseSalaryCnyMinor: number(body, "baseSalaryCnyMinor"),
          context: actionContext,
        });
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: "基础资料操作无效" }, { status: 400 });
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : 400;
      return NextResponse.json({
        error: error instanceof ZodError
          ? (error.issues[0]?.message ?? "请检查填写内容")
          : error instanceof Error ? error.message : "基础资料操作失败",
      }, { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400 });
    }
  };
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}

async function run(request: Request): Promise<Response> {
  const runtime = createMasterDataRuntime();
  try {
    return await createMasterDataApiHandler({
      readSession: currentSession,
      listDictionaryItems: (input) => runtime.service.listDictionaryItems(input),
      listRepairTeams: (input) => runtime.service.listRepairTeams(input),
      listStaffMembers: (input) => runtime.service.listStaffMembers(input),
      listPayrollParameters: (input) => runtime.service.listPayrollParameters(input),
      createRepairTeam: (input) => runtime.service.createRepairTeam(input),
      createDictionaryItem: (input) => runtime.service.createDictionaryItem(input),
      updateDictionaryItem: (input) => runtime.service.updateDictionaryItem(input),
      createMechanic: (input) => runtime.service.createMechanic(input),
      renameRepairTeam: (input) => runtime.service.renameRepairTeam(input),
      retireRepairTeam: (input) => runtime.service.retireRepairTeam(input),
      setEmployeeSalary: (input) => runtime.service.setEmployeeSalary(input),
    })(request);
  } finally {
    await runtime.close();
  }
}
