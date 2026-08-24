import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BusinessOrderDetailView,
} from "@/app/(protected)/business-orders/[businessOrderId]/page";
import {
  BusinessOrderListView,
} from "@/app/(protected)/business-orders/page";
import { InspectionReportsView } from "@/app/(protected)/inspection-reports/page";

const action = vi.fn(async () => undefined);

const order = {
  id: 11,
  orderNo: "BO-20260824-0001",
  vehicleId: 21,
  payer: {
    type: "person" as const,
    displayName: "张伟",
    phone: "+18765550101",
    trn: null,
    contactName: null,
  },
  vehicle: {
    plate: "7012 AB",
    description: "Honda CR-V",
    vin: "1HGBH41JXMN109186",
  },
  status: "waiting_assignment" as const,
  currentChargeVersionNo: 2,
  createdAt: new Date("2026-08-24T14:00:00Z"),
  voided: false,
  voidReason: null,
  version: 2,
};

const charges = {
  id: 31,
  businessOrderId: 11,
  versionNo: 2,
  reason: "客户确认收费",
  totals: {
    grossMinor: 2_000_000,
    lineDiscountMinor: 100_000,
    laborDiscountMinor: 50_000,
    partDiscountMinor: 0,
    otherDiscountMinor: 0,
    categoryDiscountMinor: 50_000,
    wholeOrderDiscountMinor: 50_000,
    totalDueMinor: 1_800_000,
    includedGctMinor: 234_783,
  },
  items: [{
    id: 41,
    kind: "labor" as const,
    nameZh: "发动机诊断",
    nameEn: "Engine diagnosis",
    descriptionZh: "检查发动机异响",
    descriptionEn: "Inspect engine noise",
    unitItemId: 51,
    quantity: "2.000",
    unitPriceMinor: 1_000_000,
    itemDiscountMinor: 100_000,
    subtotalMinor: 1_900_000,
    sortOrder: 1,
  }],
  notes: [{
    id: 61,
    kind: "liability_notice" as const,
    contentZh: "已提前说明诊断范围。",
    contentEn: "Diagnostic scope advised in advance.",
    sortOrder: 1,
  }],
  businessOrderVersion: 2,
};

const round = {
  id: 71,
  businessOrderId: 11,
  roundNo: 1,
  status: "waiting_assignment" as const,
  assignedTeamId: null,
  intakeMileageKm: null,
  intakePhotoFileIds: [],
  latestWorkReturnId: null,
  approvedWorkReturnId: null,
  version: 1,
};

describe("Business Order PC pages", () => {
  it("lists formal Business Orders with paging and a plate-first creation entrance", () => {
    render(
      <BusinessOrderListView
        action={action}
        canWrite
        companyContactsByCompany={{}}
        orders={{ items: [order], page: 1, pageSize: 20, pageCount: 2, total: 21 }}
        vehicleCandidates={[]}
        vehicleSearch="7012 AB"
      />,
    );
    expect(screen.getByRole("heading", { name: "Business Order" })).toBeInTheDocument();
    expect(screen.getByLabelText("先输入车牌号")).toHaveValue("7012 AB");
    expect(screen.getByText("BO-20260824-0001")).toBeInTheDocument();
    expect(screen.getByText("第 1 / 2 页 · 共 21 条")).toBeInTheDocument();
  });

  it("keeps every charge item on one row with the exact compact columns and visible translation", () => {
    const { container } = render(
      <BusinessOrderDetailView
        action={action}
        canWrite
        chargeUnits={[{ id: 51, labelZh: "工时", labelEn: "hour" }]}
        charges={charges}
        formalHandoffs={[]}
        isSuperAdmin
        mechanics={[]}
        order={order}
        repairRound={round}
        teams={[{ id: 81, name: "维修一组" }]}
      />,
    );
    const chargeSection = screen.getByRole("region", { name: "收费项目" });
    expect(chargeSection.querySelector(".bo-charge-head")).toHaveTextContent(
      "项目名称描述单位数量含税单价本项折扣含税小计译删",
    );
    expect(within(chargeSection).getByDisplayValue("发动机诊断")).toBeInTheDocument();
    expect(within(chargeSection).getByDisplayValue("Engine diagnosis")).toBeInTheDocument();
    expect(container.querySelector(".bo-charge-section")?.className).not.toContain("overflow-x");
  });

  it("uses one long square progress bar and keeps every current operation in the same area", () => {
    render(
      <BusinessOrderDetailView
        action={action}
        canWrite
        chargeUnits={[]}
        charges={{ ...charges, items: [] }}
        formalHandoffs={[]}
        isSuperAdmin
        mechanics={[]}
        order={order}
        repairRound={round}
        teams={[{ id: 81, name: "维修一组" }]}
      />,
    );
    const workflow = screen.getByRole("region", { name: "Business Order 进度与操作" });
    expect(within(workflow).getAllByTestId("progress-square")).toHaveLength(5);
    expect(within(workflow).getByRole("button", { name: "确认派单" })).toBeInTheDocument();
    expect(within(workflow).getByRole("button", { name: "作废本单" })).toBeInTheDocument();
  });

  it("keeps owner mode read-only", () => {
    render(
      <BusinessOrderDetailView
        action={action}
        canWrite={false}
        chargeUnits={[]}
        charges={charges}
        formalHandoffs={[]}
        isSuperAdmin={false}
        mechanics={[]}
        order={order}
        repairRound={round}
        teams={[]}
      />,
    );
    expect(screen.getByText("老板只读：可查看全部事实，不能修改或执行流程操作。")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("creates Inspection Report as an independent vehicle fact with optional source links", () => {
    render(
      <InspectionReportsView
        action={action}
        canWrite
        mechanics={[{ id: 91, fullName: "维修工一号" }]}
        reports={[{
          id: 101,
          reportNo: "IR-20260824-0001",
          vehicleId: 21,
          sourceBusinessOrderId: null,
          sourceRepairRoundId: null,
          correctionOfReportId: null,
          correctionReason: null,
          summaryZh: "车辆异响检查完成",
          summaryEn: "Vehicle noise inspection completed",
          actualInspectorStaffMemberId: 91,
          paperPhotoFileId: null,
          status: "submitted",
          createdAt: new Date("2026-08-24T14:00:00Z"),
          createdBy: 1,
          submittedAt: new Date("2026-08-24T14:10:00Z"),
          submittedBy: 1,
          version: 2,
          findings: [],
        }]}
        selectedVehicleId={21}
        vehicleCandidates={[]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Inspection Report" })).toBeInTheDocument();
    expect(screen.getByText("IR-20260824-0001")).toBeInTheDocument();
    expect(screen.getByText(/独立车辆检查/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建独立检查报告" })).toBeInTheDocument();
  });
});
