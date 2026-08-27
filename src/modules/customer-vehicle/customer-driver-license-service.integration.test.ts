import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import {
  CustomerDriverLicenseConflictError,
  CustomerDriverLicenseNotFoundError,
  CustomerDriverLicenseService,
  CustomerDriverLicenseWriteDeniedError,
} from "@formal/modules/customer-vehicle/customer-driver-license-service";
import { CustomerVehicleService } from "@formal/modules/customer-vehicle/customer-vehicle-service";

const migrations = [
  "0000_foundation.sql",
  "0001_account_permissions.sql",
  "0002_master_data.sql",
  "0003_master_data_facts_append_only.sql",
  "0004_customer_vehicle.sql",
  "0005_customer_vehicle_facts_append_only.sql",
  "0006_customer_identity_rule.sql",
  "0007_customer_trn_registry.sql",
  "0008_customer_trn_registry_sync.sql",
  "0025_fantastic_dakota_north.sql",
  "0026_customer_driver_license_append_only.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let sql: AuthSqlDatabase;
let service: CustomerDriverLicenseService;
let customerService: CustomerVehicleService;
let adminId: number;
let frontDeskId: number;
let ownerId: number;
let sequence = 0;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(text: string, parameters: readonly unknown[] = []) {
      const result = await source.query<Row>(text, [...parameters]);
      return result.rows;
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

async function seedAccount(name: string, username: string, role: string): Promise<number> {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, must_change_password)
     values ($1, $2, 'test-hash', $3::account_role, false)
     returning id`,
    [name, username, role],
  );
  return Number(result.rows[0].id);
}

async function seedPerson(name = "License Customer"): Promise<number> {
  sequence += 1;
  const result = await database.query<{ id: number }>(
    `insert into personal_customers (customer_no, full_name, created_by)
     values ($1, $2, $3) returning id`,
    [`CUST-202608-${String(sequence).padStart(4, "0")}`, name, adminId],
  );
  return Number(result.rows[0].id);
}

async function seedCompanyContact(personalCustomerId: number) {
  sequence += 1;
  const company = await database.query<{ id: number }>(
    `insert into company_accounts
      (company_no, legal_name, normalized_name, created_by)
     values ($1, $2, $3, $4) returning id`,
    [`COMP-202608-${String(sequence).padStart(4, "0")}`, "License Company", "license company", adminId],
  );
  const contact = await database.query<{ id: number }>(
    `insert into company_contacts
      (company_id, personal_customer_id, is_primary, created_by)
     values ($1, $2, true, $3) returning id`,
    [company.rows[0].id, personalCustomerId, adminId],
  );
  return { companyId: Number(company.rows[0].id), contactId: Number(contact.rows[0].id) };
}

function context(actorAccountId: number, requestId: string, minute = 0) {
  return {
    actorAccountId,
    requestId,
    now: new Date(`2026-08-27T14:${String(minute).padStart(2, "0")}:00Z`),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

function file(suffix: string) {
  return {
    storageKey: `customer-license-files/2026/08/${suffix}.jpg`,
    originalName: `${suffix}.jpg`,
    mediaType: "image/jpeg" as const,
    sizeBytes: 2048,
    sha256Hex: createHash("sha256").update(suffix).digest("hex"),
  };
}

const profile = {
  name: "ALICIA BENNETT",
  birthDate: "1990-06-15",
  sex: "F" as const,
  address: "12 Ocean View Road",
};

describe("CustomerDriverLicenseService", () => {
  beforeEach(async () => {
    sequence = 0;
    database = new PGlite();
    await database.waitReady;
    for (const migration of migrations) await database.exec(await readFile(migration, "utf8"));
    adminId = await seedAccount("超级管理员", "admin", "super_admin");
    frontDeskId = await seedAccount("前台", "front", "front_desk");
    ownerId = await seedAccount("老板", "owner", "owner");
    sql = testDatabase(database);
    service = new CustomerDriverLicenseService(sql);
    customerService = new CustomerVehicleService(sql);
  });

  afterEach(async () => database.close());

  it("records pending and verified evidence with exact subject ownership", async () => {
    const pendingPersonId = await seedPerson();
    const pending = await service.record({
      subject: { type: "individual_customer", personalCustomerId: pendingPersonId },
      file: file("pending"),
      profile,
      verified: false,
      context: context(frontDeskId, "req-pending"),
    });
    expect(pending).toMatchObject({
      status: "pending_verification",
      verifiedBy: null,
      verifiedAt: null,
      profile,
    });

    const contactPersonId = await seedPerson("Primary Contact");
    const company = await seedCompanyContact(contactPersonId);
    const verified = await service.record({
      subject: {
        type: "organization_primary_contact",
        companyAccountId: company.companyId,
        companyContactId: company.contactId,
        personalCustomerId: contactPersonId,
      },
      file: file("verified"),
      profile: { ...profile, name: "PRIMARY CONTACT" },
      verified: true,
      context: context(adminId, "req-verified", 1),
    });
    expect(verified).toMatchObject({
      status: "verified",
      verifiedBy: adminId,
      verifiedAt: new Date("2026-08-27T14:01:00Z"),
    });

    await expect(service.record({
      subject: {
        type: "organization_primary_contact",
        companyAccountId: company.companyId,
        companyContactId: company.contactId,
        personalCustomerId: pendingPersonId,
      },
      file: file("wrong-subject"),
      profile,
      verified: true,
      context: context(frontDeskId, "req-wrong-subject", 2),
    })).rejects.toBeInstanceOf(CustomerDriverLicenseNotFoundError);
  });

  it("supersedes rather than mutating evidence and preserves readable history", async () => {
    const personalCustomerId = await seedPerson();
    const first = await service.record({
      subject: { type: "individual_customer", personalCustomerId },
      file: file("first"),
      profile,
      verified: true,
      context: context(frontDeskId, "req-first"),
    });
    const replacement = await service.replace({
      subject: { type: "individual_customer", personalCustomerId },
      file: file("replacement"),
      profile: { ...profile, address: "44 New Address" },
      verified: false,
      context: context(frontDeskId, "req-replace", 5),
    });

    expect(replacement).toMatchObject({ status: "pending_verification" });
    await expect(service.history({
      viewerAccountId: ownerId,
      subject: { type: "individual_customer", personalCustomerId },
    })).resolves.toEqual([
      expect.objectContaining({ id: replacement.id, supersededAt: null }),
      expect.objectContaining({ id: first.id, supersededAt: new Date("2026-08-27T14:05:00Z") }),
    ]);
    await expect(service.getFile({ viewerAccountId: ownerId, recordId: first.id }))
      .resolves.toMatchObject({ storageKey: file("first").storageKey });

    await expect(database.query(
      "update customer_driver_license_records set document_address = 'rewritten' where id = $1",
      [first.id],
    )).rejects.toMatchObject({ code: "23514" });
    await expect(database.query(
      "delete from customer_driver_license_records where id = $1",
      [first.id],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("marks current evidence for reverification when the formal name changes", async () => {
    const created = await customerService.createPersonalCustomer({
      fullName: "Original Name",
      context: context(frontDeskId, "req-create-customer"),
    });
    const evidence = await service.record({
      subject: { type: "individual_customer", personalCustomerId: created.id },
      file: file("name-change"),
      profile: { ...profile, name: "Original Name" },
      verified: true,
      context: context(frontDeskId, "req-name-license", 1),
    });
    const currentProfile = await database.query<{ version: number }>(
      "select version from personal_customers where id = $1",
      [created.id],
    );

    await customerService.updatePersonalCustomer({
      customerId: created.id,
      fullName: "Corrected Formal Name",
      isActive: true,
      version: currentProfile.rows[0].version,
      context: context(frontDeskId, "req-name-change", 2),
    });
    await expect(service.history({
      viewerAccountId: ownerId,
      subject: { type: "individual_customer", personalCustomerId: created.id },
    })).resolves.toEqual([
      expect.objectContaining({
        id: evidence.id,
        status: "needs_reverification",
        verifiedBy: null,
        verifiedAt: null,
      }),
    ]);
  });

  it("enforces write permission, rolls back conflicts, and keeps audit payloads redacted", async () => {
    const personalCustomerId = await seedPerson();
    await expect(service.record({
      subject: { type: "individual_customer", personalCustomerId },
      file: file("denied"),
      profile,
      verified: true,
      context: context(ownerId, "req-denied"),
    })).rejects.toBeInstanceOf(CustomerDriverLicenseWriteDeniedError);

    await service.record({
      subject: { type: "individual_customer", personalCustomerId },
      file: file("accepted"),
      profile,
      verified: true,
      context: context(frontDeskId, "req-accepted"),
    });
    await expect(service.record({
      subject: { type: "individual_customer", personalCustomerId },
      file: file("rolled-back"),
      profile,
      verified: false,
      context: context(frontDeskId, "req-conflict"),
    })).rejects.toBeInstanceOf(CustomerDriverLicenseConflictError);

    const rolledBackFile = await database.query<{ count: number }>(
      "select count(*)::integer as count from stored_files where storage_key = $1",
      [file("rolled-back").storageKey],
    );
    expect(rolledBackFile.rows[0]?.count).toBe(0);

    const audits = await database.query<{ before_state: unknown; after_state: unknown }>(
      `select before_state, after_state from audit_events
       where request_id in ('req-accepted', 'req-conflict') order by id`,
    );
    const serialized = JSON.stringify(audits.rows);
    expect(serialized).not.toContain(profile.address);
    expect(serialized).not.toContain(file("accepted").storageKey);
    expect(serialized).not.toContain(file("accepted").sha256Hex);
    expect(serialized).not.toContain("base64");
  });
});
