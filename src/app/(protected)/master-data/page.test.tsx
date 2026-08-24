import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MasterDataView } from "@/app/(protected)/master-data/page";

const dictionaries = [
  {
    id: 1,
    category: "payment_method" as const,
    code: "cash",
    labelZh: "现金",
    labelEn: "Cash",
    isActive: true,
    sortOrder: 0,
    version: 1,
  },
  {
    id: 2,
    category: "staff_position" as const,
    code: "mechanic",
    labelZh: "维修工",
    labelEn: "Mechanic",
    isActive: true,
    sortOrder: 0,
    version: 1,
  },
];

const teams = [
  { id: 1, teamNo: "TEAM-202608-0001", name: "维修一组", isActive: true, version: 1 },
  { id: 2, teamNo: "TEAM-202608-0002", name: "维修二组", isActive: true, version: 1 },
];

describe("MasterDataView", () => {
  it("gives the super administrator direct create, edit and successor entry points", () => {
    render(
      <MasterDataView
        canManage
        dictionaries={dictionaries}
        payroll={[]}
        teams={teams}
      />,
    );

    expect(screen.getByRole("heading", { name: "基础资料" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "维修班组" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加字典项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加维修班组" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "保存班组名称" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "停用并继承" })).toHaveLength(2);
    expect(screen.getAllByLabelText("继承班组")[0]).toHaveTextContent("维修二组");
    expect(screen.getByRole("button", { name: "保存月度参数" })).toBeInTheDocument();
  });

  it("renders the same facts without mutation controls for a read-only owner", () => {
    render(
      <MasterDataView
        canManage={false}
        dictionaries={dictionaries}
        payroll={[]}
        teams={teams}
      />,
    );
    expect(screen.getByText("现金")).toBeInTheDocument();
    expect(screen.getByText("维修一组")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
