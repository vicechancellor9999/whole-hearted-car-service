import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deriveFormalCustomerLicenseDetail,
  fetchFormalCustomerLicenseHistory,
  supplementFormalCustomerLicense,
} from "../../src/lib/customers/formal-customer-license-detail";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const currentRecord = {
  id: 17,
  subject: { type: "individual_customer" as const, personalCustomerId: 9 },
  fileId: 20,
  profile: { name: "ALICIA", birthDate: "1990-06-15", sex: "F" as const, address: "12 Ocean Road" },
  status: "verified" as const,
  verifiedBy: 3,
  verifiedAt: "2026-08-27T14:30:00.000Z",
  supersededBy: null,
  supersededAt: null,
  createdBy: 3,
  createdAt: "2026-08-27T14:30:00.000Z",
  version: 1,
};

test("formal customer license detail derives all four fixed statuses", () => {
  expect(deriveFormalCustomerLicenseDetail([]).status).toBe("missing");
  expect(deriveFormalCustomerLicenseDetail([{ ...currentRecord, status: "pending_verification" }]).status).toBe("pending_verification");
  expect(deriveFormalCustomerLicenseDetail([currentRecord]).status).toBe("verified");
  expect(deriveFormalCustomerLicenseDetail([{ ...currentRecord, status: "needs_reverification" }]).status).toBe("needs_reverification");
  expect(deriveFormalCustomerLicenseDetail([
    { ...currentRecord, id: 18, supersededAt: "2026-08-27T15:00:00.000Z", supersededBy: 3 },
    currentRecord,
  ]).current?.id).toBe(17);
});

test("formal customer license detail reads history without exposing storage keys", async () => {
  let request: Request | undefined;
  const records = await fetchFormalCustomerLicenseHistory("CUST-202608-0009", async (input, init) => {
    request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({ records: [currentRecord] });
  });
  expect(request?.url).toBe("http://localhost/api/formal/customers/CUST-202608-0009/driver-license-history");
  expect(request?.cache).toBe("no-store");
  expect(JSON.stringify(records)).not.toContain("storageKey");
  expect(records[0].profile.name).toBe("ALICIA");
});

test("formal customer license detail supplements with exact multipart", async () => {
  let request: Request | undefined;
  const file = new File(["image"], "front.jpg", { type: "image/jpeg" });
  const record = await supplementFormalCustomerLicense("COMP-202608-0002", {
    file,
    transform: { rotation: 90, crop: { x: 0, y: 0, width: 1, height: 1 } },
    profile: currentRecord.profile,
    verified: true,
  }, async (input, init) => {
    request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({ record: currentRecord }, { status: 201 });
  });
  const form = await request?.formData();
  expect(request?.url).toBe("http://localhost/api/formal/customers/COMP-202608-0002/driver-license");
  expect([...form!.keys()].sort()).toEqual(["licenseFront", "payload"]);
  expect(JSON.parse(String(form?.get("payload")))).toEqual({
    profile: currentRecord.profile,
    verified: true,
    transform: { rotation: 90, crop: { x: 0, y: 0, width: 1, height: 1 } },
  });
  expect(record.id).toBe(17);
});

test("formal customer license detail UI keeps company contact ownership and read-only controls", () => {
  const card = source("src/components/customers/formal-customer-license-card.tsx");
  const dialog = source("src/components/customers/formal-customer-license-dialog.tsx");
  const page = source("src/components/customers/customer-detail-page.tsx");
  expect(card).toContain("主要联系人驾驶证");
  expect(card).toContain("待补");
  expect(card).toContain("待核验");
  expect(card).toContain("已核验");
  expect(card).toContain("需重新核验");
  expect(card).toContain("只读");
  expect(card).toContain("查看证件原图");
  expect(dialog).toContain("FormalCustomerLicenseSection");
  expect(page).toContain("FormalCustomerLicenseCard");
  expect(page).toContain("hasPrimaryContact");
  expect(page).toContain("onChanged={() => setReloadSequence");
});
