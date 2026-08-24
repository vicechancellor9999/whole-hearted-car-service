import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmployeesView } from "@/app/(protected)/employees/page";

describe("EmployeesView", () => {
  it("creates a member and account in one visible form and keeps salary changes explicit", () => {
    render(
      <EmployeesView
        canManage
        positions={[
          {
            id: 7,
            category: "staff_position",
            code: "mechanic",
            labelZh: "维修工",
            labelEn: "Mechanic",
            isActive: true,
            sortOrder: 0,
            version: 1,
          },
        ]}
        teams={[
          { id: 8, teamNo: "TEAM-202608-0001", name: "维修一组", isActive: true, version: 1 },
        ]}
        members={[
          {
            id: 9,
            staffNo: "STAFF-202608-0001",
            fullName: "林海",
            normalizedPhone: "+18765550101",
            accountId: 10,
            accountUsername: "mechanic.one",
            positionItemId: 7,
            currentTeamId: 8,
            status: "active",
            hiredOn: "2026-08-01",
            version: 1,
            currentTeamName: "维修一组",
            positionLabel: "维修工",
            latestBaseSalaryCnyMinor: 500_000,
            salaryEffectiveMonth: "2026-08",
          },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "员工管理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新增维修工与账号" })).toBeInTheDocument();
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
    expect(screen.getByLabelText("初始密码")).toBeInTheDocument();
    expect(screen.getAllByLabelText("月标准工资（CNY）")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "创建员工与账号" })).toBeInTheDocument();
    expect(screen.getByText("CNY 5,000.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增工资版本" })).toBeInTheDocument();
  });
});
