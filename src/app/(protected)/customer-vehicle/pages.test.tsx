import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CustomersView } from "@/app/(protected)/customers/page";
import { CompaniesView } from "@/app/(protected)/companies/page";
import { VehiclesView } from "@/app/(protected)/vehicles/page";

const customer = {
  id: 1, customerNo: "CUST-202608-0001", fullName: "艾丽西亚·贝内特",
  normalizedPhone: "+18765550101", whatsapp: null, email: "a@example.com",
  address: null, trn: null, isActive: true, version: 1,
};

describe("customer, company and vehicle pages", () => {
  it("shows a paged compact customer list with explicit create and edit entry points", () => {
    render(<CustomersView canWrite page={{ items: [customer], page: 1, pageSize: 20, pageCount: 2, total: 21 }} />);
    expect(screen.getByRole("heading", { name: "个人客户档案" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建个人客户" })).toBeInTheDocument();
    expect(screen.getByText("CUST-202608-0001")).toBeInTheDocument();
    expect(screen.getByText("第 1 / 2 页 · 共 21 条")).toBeInTheDocument();
    expect(screen.getByText("修改")).toBeInTheDocument();
  });

  it("selects company contacts from existing personal customers", () => {
    render(
      <CompaniesView
        canWrite
        companies={{
          items: [{ id: 2, companyNo: "COMP-202608-0001", legalName: "North Coast Logistics Ltd", trn: "123456789", phone: null, email: null, address: null, isActive: true, version: 1 }],
          page: 1, pageSize: 20, pageCount: 1, total: 1,
        }}
        contactsByCompany={{
          "2": [{
            id: 10, companyId: 2, personalCustomerId: 1,
            personalCustomerName: "艾丽西亚·贝内特",
            normalizedPhone: "+18765550101", jobTitle: "现场负责人",
            isPrimary: true, canSign: true, receivesInvoice: true,
            receivesCollection: false, isActive: true, version: 1,
          }],
        }}
        people={[customer]}
      />,
    );
    expect(screen.getByRole("heading", { name: "公司账户" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建公司账户" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /艾丽西亚·贝内特/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加公司联系人" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存联系人关系" })).toBeInTheDocument();
  });

  it("keeps vehicle ownership, dispute and modification operations visible without horizontal scrolling", () => {
    render(
      <VehiclesView
        canWrite
        attachmentsByVehicle={{
          "3": [{
            fileId: 20, vehicleId: 3, kind: "photo", caption: "左前方",
            originalName: "接车照片.jpg", mediaType: "image/jpeg",
            sizeBytes: 1024, uploadedAt: new Date("2026-08-24T10:00:00Z"),
          }],
        }}
        companies={[]}
        people={[customer]}
        vehicles={{
          items: [{
            id: 3, vehicleNo: "VEH-202608-0001", plateDisplay: "4321 AB",
            normalizedPlate: "4321AB", vin: "JN1BJ0RR9HM123456", engineNumber: "MR20DE123456",
            make: "Nissan", makeZh: "日产", model: "X-Trail", modelZh: "奇骏",
            modelYear: 2021, color: "Silver", bodyType: "SUV", fuelType: "PETROL",
            engineCc: 1997, seating: 5, usage: "个人用车", specialNotes: "核对备胎",
            currentOwner: { type: "person", id: 1, name: "艾丽西亚·贝内特" },
            hasOpenDispute: false, openDisputeId: null, isActive: true, version: 1,
          }],
          page: 1, pageSize: 20, pageCount: 1, total: 1,
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "车辆档案" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建车辆档案" })).toBeInTheDocument();
    expect(screen.getByText("修改车辆资料")).toBeInTheDocument();
    expect(screen.getByDisplayValue("MR20DE123456")).toBeInTheDocument();
    expect(screen.getByDisplayValue("日产")).toBeInTheDocument();
    expect(screen.getByDisplayValue("奇骏")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1997")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    expect(screen.getByDisplayValue("个人用车")).toBeInTheDocument();
    expect(screen.getByDisplayValue("核对备胎")).toBeInTheDocument();
    expect(screen.getByText("变更车辆归属")).toBeInTheDocument();
    expect(screen.getAllByText("记录客户争议")).toHaveLength(2);
    expect(screen.getByText(/接车照片.jpg/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传并归档附件" })).toBeInTheDocument();
  });

  it("removes all write controls for the owner view", () => {
    render(<CustomersView canWrite={false} page={{ items: [customer], page: 1, pageSize: 20, pageCount: 1, total: 1 }} />);
    expect(screen.queryByRole("button", { name: /创建|保存|修改/ })).not.toBeInTheDocument();
    expect(screen.queryByText("修改")).not.toBeInTheDocument();
  });
});
