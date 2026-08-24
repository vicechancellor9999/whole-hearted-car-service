import { describe, expect, it } from "vitest";
import {
  executeMasterDataSubmission,
  parseMasterDataSubmission,
  type MasterDataSubmissionService,
} from "@/app/(protected)/master-data/submission";

describe("master data submissions", () => {
  it("parses an employee form and converts CNY to integer minor units", () => {
    const form = new FormData();
    form.set("operation", "create_mechanic");
    form.set("fullName", "林海");
    form.set("phone", "+1 876 555 0101");
    form.set("positionItemId", "7");
    form.set("teamId", "8");
    form.set("hiredOn", "2026-08-24");
    form.set("effectiveMonth", "2026-08");
    form.set("baseSalaryCny", "5000.50");
    form.set("username", "mechanic.one");
    form.set("password", "Mechanic formal 2026!");

    expect(parseMasterDataSubmission(form)).toEqual({
      operation: "create_mechanic",
      fullName: "林海",
      phone: "+1 876 555 0101",
      positionItemId: 7,
      teamId: 8,
      hiredOn: "2026-08-24",
      effectiveMonth: "2026-08",
      baseSalaryCnyMinor: 500_050,
      username: "mechanic.one",
      password: "Mechanic formal 2026!",
    });
  });

  it("parses a used-team retirement with an explicit successor", () => {
    const form = new FormData();
    form.set("operation", "retire_team");
    form.set("teamId", "11");
    form.set("replacementTeamId", "12");
    form.set("reason", "班组整合");

    expect(parseMasterDataSubmission(form)).toEqual({
      operation: "retire_team",
      teamId: 11,
      replacementTeamId: 12,
      reason: "班组整合",
    });
  });

  it("routes a parsed operation to the service without adding business decisions", async () => {
    const calls: unknown[] = [];
    const service = {
      createRepairTeam: async (input: unknown) => calls.push(input),
    } as unknown as MasterDataSubmissionService;
    const context = { actorAccountId: 1, requestId: "req-submission" };

    await expect(
      executeMasterDataSubmission(
        { operation: "create_team", name: "维修一组" },
        service,
        context,
      ),
    ).resolves.toEqual({ message: "维修班组已创建", destination: "/master-data" });
    expect(calls).toEqual([{ name: "维修一组", context }]);
  });
});
