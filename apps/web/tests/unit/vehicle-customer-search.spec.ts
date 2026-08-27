import { expect, test } from "@playwright/test";
import { filterVehicleCustomerCandidates } from "../../src/lib/customers/vehicle-customer-search";

const customers = [
  { id: "CUST-202608250001", nameZh: "陈美玲", nameEn: "Chen Meiling", organizationName: null, phone: "+18765550101", trn: null },
  { id: "CUST-202608250002", nameZh: null, nameEn: null, organizationName: "North Coast Logistics Ltd", phone: "+18765550102", trn: "123456789" },
];

test("vehicle customer lookup searches name, phone, TRN and customer number", () => {
  expect(filterVehicleCustomerCandidates(customers, "美玲").map((item) => item.id)).toEqual(["CUST-202608250001"]);
  expect(filterVehicleCustomerCandidates(customers, "5550102").map((item) => item.id)).toEqual(["CUST-202608250002"]);
  expect(filterVehicleCustomerCandidates(customers, "123456789").map((item) => item.id)).toEqual(["CUST-202608250002"]);
  expect(filterVehicleCustomerCandidates(customers, "250001").map((item) => item.id)).toEqual(["CUST-202608250001"]);
});

test("vehicle customer lookup does not render the full customer directory for an empty query", () => {
  expect(filterVehicleCustomerCandidates(customers, "")).toEqual([]);
});
