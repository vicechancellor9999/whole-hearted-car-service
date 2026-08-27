import { expect, test } from "@playwright/test";
import { adaptFormalCustomerVehicleWorkspace, adaptFormalPerson } from "../../src/lib/customers/formal-customer-vehicle-adapter";
import { customerDisplayNameV3 } from "../../src/lib/customers/selectors";

test("正式客户与车辆数据沿用既有页面结构并显示正式编号", () => {
  const workspace = adaptFormalCustomerVehicleWorkspace({
    people: [{
      id: 1,
      customerNo: "CUST-202608-0001",
      fullName: "张三",
      normalizedPhone: "+18765550101",
      whatsapp: null,
      email: null,
      address: null,
      trn: null,
      isActive: true,
      version: 1,
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    }],
    companies: [{
      id: 2,
      companyNo: "COMP-202608-0001",
      legalName: "Whole Hearted Fleet",
      trn: "123456789",
      phone: "+18765550102",
      email: null,
      address: null,
      isActive: true,
      version: 1,
    }],
    companyContacts: [{
      id: 12,
      companyId: 2,
      personalCustomerId: 1,
      personalCustomerName: "张三",
      normalizedPhone: "+18765550101",
      jobTitle: "车队主管",
      isPrimary: true,
      canSign: true,
      receivesInvoice: true,
      receivesCollection: false,
      isActive: true,
      version: 3,
    }],
    vehicles: [{
      id: 3,
      vehicleNo: "VEH-202608-0001",
      plateDisplay: "4321 AB",
      normalizedPlate: "4321AB",
      vin: "1HGCM82633A004352",
      engineNumber: "MR20-123456",
      make: "Nissan",
      makeZh: "日产",
      model: "X-Trail",
      modelZh: "奇骏",
      modelYear: 2020,
      color: "White",
      bodyType: "SUV",
      fuelType: "汽油",
      engineCc: 1997,
      seating: 5,
      usage: "公司营运",
      specialNotes: "定期检查轮胎磨损。",
      currentOwner: { type: "company", id: 2, name: "Whole Hearted Fleet" },
      hasOpenDispute: true,
      openDisputeId: 17,
      isActive: true,
      version: 1,
      createdAt: "2026-08-10T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    }],
    vehicleAttachments: [{
      fileId: 21,
      vehicleId: 3,
      kind: "photo",
      caption: "左前方",
      originalName: "接车照片.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 1024,
      uploadedAt: "2026-08-10T11:00:00.000Z",
    }, {
      fileId: 22,
      vehicleId: 3,
      kind: "document",
      caption: null,
      originalName: "车辆登记证.pdf",
      mediaType: "application/pdf",
      sizeBytes: 2048,
      uploadedAt: "2026-08-10T12:00:00.000Z",
    }],
    onSiteVehicleIds: [3],
    ownerHistory: [{
      id: 8,
      vehicleId: 3,
      owner: { type: "person", id: 1, name: "张三" },
      startedAt: "2026-08-01T10:00:00.000Z",
      endedAt: "2026-08-10T10:00:00.000Z",
      reason: "车辆转入公司名下",
    }, {
      id: 9,
      vehicleId: 3,
      owner: { type: "company", id: 2, name: "Whole Hearted Fleet" },
      startedAt: "2026-08-10T10:00:00.000Z",
      endedAt: null,
      reason: "车辆转入公司名下",
    }],
    totals: { people: 1, companies: 1, vehicles: 1 },
  });

  expect(workspace.customers.map((customer) => customer.id)).toEqual([
    "CUST-202608-0001",
    "COMP-202608-0001",
  ]);
  expect(customerDisplayNameV3(workspace.customers[0]!)).toBe("张三");
  expect(workspace.vehicles[0]).toMatchObject({
    id: "VEH-202608-0001",
    formalId: 3,
    formalIsActive: true,
    plate: "4321 AB",
    vin: "1HGCM82633A004352",
    status: "on_site",
    hasOpenDispute: true,
    openDisputeId: 17,
    engineNumber: "MR20-123456",
    makeZh: "日产",
    modelZh: "奇骏",
    bodyType: "SUV",
    fuelType: "汽油",
    ccRating: "1997",
    seating: "5",
    usage: "公司营运",
    specialNotes: "定期检查轮胎磨损。",
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
  });
  expect(workspace.vehicles[0]?.photos).toEqual([
    expect.objectContaining({
      id: "formal-vehicle-file-21",
      url: "/api/formal/vehicle-attachments/21",
      note: "左前方",
    }),
  ]);
  expect(workspace.vehicles[0]?.attachments).toEqual([
    expect.objectContaining({ id: "formal-vehicle-file-21", fileName: "接车照片.jpg" }),
    expect.objectContaining({ id: "formal-vehicle-file-22", fileName: "车辆登记证.pdf" }),
  ]);
  expect(workspace.companyContacts).toEqual([
    expect.objectContaining({
      id: "formal-company-contact-12",
      companyId: "COMP-202608-0001",
      personalCustomerId: "CUST-202608-0001",
      isPrimary: true,
    }),
  ]);
  expect(workspace.customers[1]).toMatchObject({
    nameSourceValue: "张三",
    nameZh: "张三",
    nameEn: null,
    primaryContactRole: "车队主管",
  });
  expect(workspace.relationships).toEqual([
    expect.objectContaining({
      vehicleId: "VEH-202608-0001",
      customerId: "CUST-202608-0001",
      endedAt: "2026-08-10T10:00:00.000Z",
    }),
    expect.objectContaining({
      vehicleId: "VEH-202608-0001",
      customerId: "COMP-202608-0001",
      endedAt: null,
    }),
  ]);
  expect(workspace.summary).toEqual({
    totalCustomers: 2,
    activeCustomers: 2,
    totalVehicles: 1,
    activeVehicles: 1,
    activeRelationships: 1,
  });
  expect(workspace.sourceRevision).toBe(3);
});

test("正式姓名只有中英成对时才拆分斜线，单语原值保持完整", () => {
  const customer = adaptFormalPerson({
    id: 9,
    customerNo: "CUST-202608-0009",
    fullName: "Jean/Paul Morgan",
    normalizedPhone: "+18765550109",
    whatsapp: null,
    email: null,
    address: null,
    trn: null,
    isActive: true,
    version: 1,
  });

  expect(customer.nameEn).toBe("Jean/Paul Morgan");
  expect(customerDisplayNameV3(customer)).toBe("Jean/Paul Morgan");
});

test("正式双语姓名保留后端原值，供无关字段编辑原样回传", () => {
  const customer = adaptFormalPerson({
    id: 10,
    customerNo: "CUST-202608-0010",
    fullName: "陈志远 / Chen Zhiyuan",
    normalizedPhone: "+18765550110",
    whatsapp: null,
    email: null,
    address: null,
    trn: null,
    isActive: true,
    version: 2,
  });

  expect(customer.formalFullName).toBe("陈志远 / Chen Zhiyuan");
  expect(customer.nameZh).toBe("陈志远");
  expect(customer.nameEn).toBe("Chen Zhiyuan");
});
