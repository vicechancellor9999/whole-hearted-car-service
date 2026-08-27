import { expect, test } from "@playwright/test";
import type { VehicleCustomerRelationship, VehicleRecord } from "../../src/lib/customers/types";
import {
  vehicleArchiveIncomplete,
  vehicleHasCurrentCustomer,
  vehicleHasOpenTask,
  vehicleMatchesSummaryFilter,
} from "../../src/components/customers/vehicle-summary-cards";

function vehicle(overrides: Partial<VehicleRecord> = {}): VehicleRecord {
  return {
    id: "veh-1",
    plate: "1234 AB",
    vin: "1HGBH41JXMN109186",
    engineNumber: null,
    make: "Toyota",
    model: "Corolla",
    makeZh: "丰田",
    modelZh: "卡罗拉",
    variant: null,
    year: 2024,
    color: "White",
    powertrain: null,
    bodyType: null,
    seating: null,
    ccRating: null,
    fuelType: null,
    mileage: null,
    mileageUnit: "km",
    mileageRecordedAt: null,
    usage: null,
    specialNotes: null,
    photos: [{
      id: "photo-1",
      kind: "registration",
      url: "/seed-photos/registration.jpg",
      note: "",
      linkedOrderId: null,
      uploadedBy: "超级管理员",
      uploadedAt: "2026-08-23T09:00:00-05:00",
    }],
    status: "on_site",
    partsNeeds: [],
    tasks: [],
    attachments: [],
    revision: 1,
    createdAt: "2026-08-23T09:00:00-05:00",
    updatedAt: "2026-08-23T09:00:00-05:00",
    ...overrides,
  };
}

const relationship: VehicleCustomerRelationship = {
  id: "rel-1",
  vehicleId: "veh-1",
  customerId: "customer-1",
  startedAt: "2026-08-23T09:00:00-05:00",
  endedAt: null,
};

test("车辆统计从当前车辆档案实时识别在场、待补、待办和客户关系", () => {
  const current = vehicle({
    tasks: [{ id: "task-1", title: "补照片", status: "pending", assignee: "超级管理员", dueAt: null }],
  });
  expect(vehicleArchiveIncomplete(current)).toBe(false);
  expect(vehicleHasOpenTask(current)).toBe(true);
  expect(vehicleHasCurrentCustomer(current.id, [relationship])).toBe(true);
  expect(vehicleMatchesSummaryFilter(current, [relationship], "on_site")).toBe(true);
  expect(vehicleMatchesSummaryFilter(current, [relationship], "open_tasks")).toBe(true);
  expect(vehicleMatchesSummaryFilter(current, [relationship], "unbound")).toBe(false);
});

test("缺少车牌或照片的车辆计入档案待补且无当前客户可独立筛选", () => {
  const incomplete = vehicle({ plate: "", photos: [], status: "off_site" });
  expect(vehicleArchiveIncomplete(incomplete)).toBe(true);
  expect(vehicleMatchesSummaryFilter(incomplete, [], "incomplete")).toBe(true);
  expect(vehicleMatchesSummaryFilter(incomplete, [], "unbound")).toBe(true);
  expect(vehicleMatchesSummaryFilter(incomplete, [], "off_site")).toBe(true);
});
