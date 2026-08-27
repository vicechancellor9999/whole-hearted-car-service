import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import {
  CustomerVehicleConflictError,
  CustomerVehicleService,
} from "@formal/modules/customer-vehicle/customer-vehicle-service";

const migrations = [
  "0000_foundation.sql", "0001_account_permissions.sql", "0002_master_data.sql",
  "0003_master_data_facts_append_only.sql", "0004_customer_vehicle.sql",
  "0005_customer_vehicle_facts_append_only.sql", "0006_customer_identity_rule.sql",
  "0007_customer_trn_registry.sql", "0008_customer_trn_registry_sync.sql",
  "0025_fantastic_dakota_north.sql", "0026_customer_driver_license_append_only.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let service: CustomerVehicleService;
let frontDeskId: number;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(text: string, parameters: readonly unknown[] = []) {
      return (await source.query<Row>(text, [...parameters])).rows;
    },
  };
}

function testDatabase(source: PGlite): AuthSqlDatabase {
  return {
    ...executor(source),
    transaction(callback) {
      return source.transaction((transaction) => callback(executor(transaction)));
    },
  };
}

function context(requestId: string) {
  return {
    actorAccountId: frontDeskId,
    requestId,
    now: new Date("2026-08-27T16:00:00Z"),
  };
}

function license(key: string, name = "ALICIA BENNETT", address = "12 Ocean Road") {
  return {
    file: {
      storageKey: `customer-license-files/2026/08/${key}.jpg`,
      originalName: `${key}.jpg`,
      mediaType: "image/jpeg" as const,
      sizeBytes: 1200,
      sha256Hex: createHash("sha256").update(key).digest("hex"),
    },
    profile: { name, birthDate: "1990-06-15", sex: "F" as const, address },
    verified: true,
  };
}

describe("compound formal customer creation", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const migration of migrations) await database.exec(await readFile(migration, "utf8"));
    const account = await database.query<{ id: number }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role, must_change_password)
       values ('前台', 'front', 'hash', 'front_desk', false) returning id`,
    );
    frontDeskId = Number(account.rows[0].id);
    service = new CustomerVehicleService(testDatabase(database));
  });

  afterEach(async () => database.close());

  it("creates a personal customer and verified license in one transaction", async () => {
    const result = await service.createPersonalCustomerWithLicense({
      fullName: "Draft Name",
      phone: "+18765550181",
      license: license("personal"),
      context: context("req-personal-compound"),
    });
    expect(result.record).toMatchObject({
      customerNo: "CUST-202608-0001",
      fullName: "ALICIA BENNETT",
      address: "12 Ocean Road",
    });
    expect(result.driverLicense).toMatchObject({ status: "verified", verifiedBy: frontDeskId });
  });

  it("creates a company and new primary contact while keeping both addresses separate", async () => {
    const result = await service.createCompanyWithPrimaryContact({
      legalName: "North Coast Fleet",
      address: "88 Company Avenue",
      primaryContact: {
        newPrimaryContact: {
          fullName: "Contact Draft",
          phone: "+18765550182",
          jobTitle: "Fleet Manager",
        },
      },
      license: license("company-contact", "PRIMARY CONTACT", "44 Contact Lane"),
      context: context("req-company-compound"),
    });
    expect(result.record.address).toBe("88 Company Avenue");
    expect(result.primaryContact).toMatchObject({
      personalCustomerName: "PRIMARY CONTACT",
      jobTitle: "Fleet Manager",
      isPrimary: true,
    });
    const person = await database.query<{ address: string }>(
      "select address from personal_customers where id = $1",
      [result.primaryContact?.personalCustomerId],
    );
    expect(person.rows[0].address).toBe("44 Contact Lane");
  });

  it("reuses a confirmed existing contact and allows a company without a contact or license", async () => {
    const existing = await service.createPersonalCustomer({
      fullName: "Existing Contact",
      phone: "+18765550183",
      context: context("req-existing-person"),
    });
    const reused = await service.createCompanyWithPrimaryContact({
      legalName: "Existing Contact Company",
      primaryContact: { existingPersonalCustomerNo: existing.customerNo },
      context: context("req-reuse-contact"),
    });
    expect(reused.primaryContact?.personalCustomerId).toBe(existing.id);
    expect(reused.driverLicense).toBeNull();

    const noContact = await service.createCompanyWithPrimaryContact({
      legalName: "No Contact Yet Company",
      context: context("req-no-contact"),
    });
    expect(noContact.primaryContact).toBeNull();
    expect(noContact.driverLicense).toBeNull();
    const missingEvents = await database.query<{ count: number }>(
      `select count(*)::integer as count from audit_events
       where event_type = 'customer.driver_license_missing_acknowledged'`,
    );
    expect(missingEvents.rows[0].count).toBe(2);
  });

  it("rolls back the entire company when a new contact phone is already owned", async () => {
    await service.createPersonalCustomer({
      fullName: "Phone Owner",
      phone: "+18765550184",
      context: context("req-owner"),
    });
    await expect(service.createCompanyWithPrimaryContact({
      legalName: "Must Roll Back Company",
      primaryContact: { newPrimaryContact: {
        fullName: "Conflicting Contact",
        phone: "+18765550184",
      } },
      context: context("req-conflict"),
    })).rejects.toBeInstanceOf(CustomerVehicleConflictError);
    const companies = await database.query<{ count: number }>(
      "select count(*)::integer as count from company_accounts where legal_name = 'Must Roll Back Company'",
    );
    expect(companies.rows[0].count).toBe(0);
  });
});
