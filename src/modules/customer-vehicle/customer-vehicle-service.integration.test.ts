import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@/modules/auth/session-repository";
import {
  CustomerVehicleConflictError,
  CustomerVehicleService,
  CustomerVehicleWriteDeniedError,
} from "@/modules/customer-vehicle/customer-vehicle-service";

const migrationPaths = [
  "0000_foundation.sql",
  "0001_account_permissions.sql",
  "0002_master_data.sql",
  "0003_master_data_facts_append_only.sql",
  "0004_customer_vehicle.sql",
  "0005_customer_vehicle_facts_append_only.sql",
  "0006_customer_identity_rule.sql",
  "0007_customer_trn_registry.sql",
  "0008_customer_trn_registry_sync.sql",
  "0016_vehicle_profile_fields.sql",
  "0017_optional_vehicle_plate.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let service: CustomerVehicleService;
let adminId: number;
let frontDeskId: number;
let ownerId: number;

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

async function seedAccount(name: string, username: string, role: string) {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role, must_change_password)
     values ($1, $2, 'test-hash', $3::account_role, false)
     returning id`,
    [name, username, role],
  );
  return Number(result.rows[0].id);
}

function context(actorAccountId: number, requestId: string) {
  return {
    actorAccountId,
    requestId,
    now: new Date("2026-08-24T14:00:00Z"),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

describe("CustomerVehicleService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) await database.exec(await readFile(path, "utf8"));
    adminId = await seedAccount("超级管理员", "admin", "super_admin");
    frontDeskId = await seedAccount("前台", "front", "front_desk");
    ownerId = await seedAccount("老板", "owner", "owner");
    service = new CustomerVehicleService(testDatabase(database));
  });

  afterEach(async () => database.close());

  it("creates normalized formal customers and rejects duplicate identities", async () => {
    const first = await service.createPersonalCustomer({
      fullName: "  艾丽西亚·贝内特  ",
      phone: "+1 (876) 555-0101",
      trn: "",
      context: context(frontDeskId, "req-person-1"),
    });
    expect(first).toMatchObject({
      customerNo: "CUST-202608-0001",
      fullName: "艾丽西亚·贝内特",
      normalizedPhone: "+18765550101",
      trn: null,
      createdAt: new Date("2026-08-24T14:00:00Z"),
      updatedAt: new Date("2026-08-24T14:00:00Z"),
    });
    await expect(
      service.createPersonalCustomer({
        fullName: "重复客户",
        phone: "0018765550101",
        context: context(adminId, "req-person-2"),
      }),
    ).rejects.toBeInstanceOf(CustomerVehicleConflictError);
    await expect(
      service.listPersonalCustomers({ viewerAccountId: ownerId, page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ id: first.id })] });
  });

  it("keeps company contacts as personal customers and switches the active primary contact", async () => {
    const first = await service.createPersonalCustomer({
      fullName: "联系人一",
      phone: "+18765550111",
      context: context(frontDeskId, "req-contact-1"),
    });
    const second = await service.createPersonalCustomer({
      fullName: "联系人二",
      phone: "+18765550112",
      context: context(frontDeskId, "req-contact-2"),
    });
    const company = await service.createCompanyAccount({
      legalName: " North Coast Logistics Ltd ",
      trn: "123-456-789",
      context: context(frontDeskId, "req-company"),
    });
    await service.addCompanyContact({
      companyId: company.id,
      personalCustomerId: first.id,
      jobTitle: "现场负责人",
      isPrimary: true,
      canSign: true,
      receivesInvoice: true,
      receivesCollection: false,
      context: context(frontDeskId, "req-link-1"),
    });
    await service.addCompanyContact({
      companyId: company.id,
      personalCustomerId: second.id,
      jobTitle: "财务",
      isPrimary: true,
      canSign: false,
      receivesInvoice: true,
      receivesCollection: true,
      context: context(frontDeskId, "req-link-2"),
    });
    const contacts = await service.listCompanyContacts({
      viewerAccountId: ownerId,
      companyId: company.id,
    });
    expect(contacts).toHaveLength(2);
    expect(contacts.find((item) => item.personalCustomerId === first.id)?.isPrimary).toBe(false);
    expect(contacts.find((item) => item.personalCustomerId === second.id)?.isPrimary).toBe(true);
    const switchEvents = await database.query<{ event_type: string; object_id: string }>(
      `select event_type, object_id from audit_events
       where request_id = 'req-link-2' order by id`,
    );
    expect(switchEvents.rows.map((row) => row.event_type)).toEqual([
      "company.contact_updated",
      "company.contact_added",
    ]);

    const primary = contacts.find((item) => item.personalCustomerId === second.id)!;
    await service.updateCompanyContact({
      contactId: primary.id,
      jobTitle: "财务主管",
      isPrimary: false,
      canSign: true,
      receivesInvoice: true,
      receivesCollection: true,
      isActive: false,
      version: primary.version,
      context: context(frontDeskId, "req-contact-update"),
    });
    await expect(
      service.listCompanyContacts({ viewerAccountId: ownerId, companyId: company.id }),
    ).resolves.toContainEqual(expect.objectContaining({
      id: primary.id,
      jobTitle: "财务主管",
      isPrimary: false,
      isActive: false,
      canSign: true,
    }));
  });

  it("creates a vehicle and moves ownership without rewriting its first owner", async () => {
    const person = await service.createPersonalCustomer({
      fullName: "戴维·布莱克",
      phone: "+18765550120",
      context: context(frontDeskId, "req-owner"),
    });
    const company = await service.createCompanyAccount({
      legalName: "Seaview Villas Group",
      context: context(frontDeskId, "req-company"),
    });
    const vehicle = await service.createVehicle({
      plate: " 4321-ab ",
      vin: "1hgbh41jxmn109186",
      make: "Nissan",
      model: "X-Trail",
      modelYear: 2021,
      color: "Silver",
      ownerType: "person",
      ownerId: person.id,
      context: context(frontDeskId, "req-vehicle"),
    });
    expect(vehicle).toMatchObject({
      vehicleNo: "VEH-202608-0001",
      normalizedPlate: "4321AB",
      currentOwner: { type: "person", id: person.id },
      createdAt: new Date("2026-08-24T14:00:00Z"),
      updatedAt: new Date("2026-08-24T14:00:00Z"),
    });
    await service.changeVehicleOwner({
      vehicleId: vehicle.id,
      ownerType: "company",
      ownerId: company.id,
      reason: "车辆过户到公司账户",
      context: context(frontDeskId, "req-owner-change"),
    });
    const history = await database.query<{ person_customer_id: number | null; company_account_id: number | null; ended_at: Date | null }>(
      `select person_customer_id, company_account_id, ended_at
       from vehicle_owner_history where vehicle_id = $1 order by started_at, id`,
      [vehicle.id],
    );
    expect(history.rows).toEqual([
      expect.objectContaining({ person_customer_id: person.id, company_account_id: null, ended_at: expect.any(Date) }),
      expect.objectContaining({ person_customer_id: null, company_account_id: company.id, ended_at: null }),
    ]);
  });

  it("rolls back the profile update when an atomic owner change cannot complete", async () => {
    const person = await service.createPersonalCustomer({
      fullName: "原车主",
      phone: "+18765550123",
      context: context(frontDeskId, "req-atomic-owner-person"),
    });
    const company = await service.createCompanyAccount({
      legalName: "Atomic Fleet Ltd",
      context: context(frontDeskId, "req-atomic-owner-company"),
    });
    const vehicle = await service.createVehicle({
      plate: "A 123",
      make: "Nissan",
      model: "X-Trail",
      color: "Silver",
      ownerType: "person",
      ownerId: person.id,
      context: context(frontDeskId, "req-atomic-owner-vehicle"),
    });
    await database.query(
      "update vehicle_owner_history set ended_at = '2026-08-24T14:01:00Z' where vehicle_id = $1",
      [vehicle.id],
    );

    await expect(service.updateVehicleWithOwner({
      vehicleId: vehicle.id,
      plate: "A 123",
      make: "Nissan",
      model: "X-Trail",
      color: "Black",
      isActive: true,
      version: vehicle.version,
      ownerType: "company",
      ownerId: company.id,
      reason: "转入车队",
      context: context(frontDeskId, "req-atomic-owner-change"),
    })).rejects.toBeInstanceOf(CustomerVehicleConflictError);

    const persisted = await database.query<{
      color: string | null;
      version: number;
      current_person_customer_id: number | null;
      current_company_account_id: number | null;
    }>(
      `select color, version, current_person_customer_id, current_company_account_id
       from vehicles where id = $1`,
      [vehicle.id],
    );
    expect(persisted.rows[0]).toEqual({
      color: "Silver",
      version: 1,
      current_person_customer_id: person.id,
      current_company_account_id: null,
    });
    const audit = await database.query<{ count: number }>(
      "select count(*)::integer as count from audit_events where request_id = 'req-atomic-owner-change'",
    );
    expect(audit.rows[0]?.count).toBe(0);
  });

  it("creates a vehicle before a plate is available and keeps the supplied plate unique", async () => {
    const person = await service.createPersonalCustomer({
      fullName: "待上牌车辆客户",
      phone: "+18765550121",
      context: context(frontDeskId, "req-no-plate-owner"),
    });
    const vehicle = await service.createVehicle({
      make: "Toyota",
      makeZh: "丰田",
      model: "Hiace",
      modelZh: "海狮",
      modelYear: 2022,
      ownerType: "person",
      ownerId: person.id,
      context: context(frontDeskId, "req-no-plate"),
    });
    expect(vehicle).toMatchObject({
      plateDisplay: null,
      normalizedPlate: null,
      make: "Toyota",
      model: "Hiace",
    });
  });

  it("opens and resolves one vehicle dispute with immutable audit entries", async () => {
    const person = await service.createPersonalCustomer({
      fullName: "争议客户",
      phone: "+18765550130",
      context: context(frontDeskId, "req-person"),
    });
    const vehicle = await service.createVehicle({
      plate: "7788 KM",
      make: "Suzuki",
      model: "Swift",
      ownerType: "person",
      ownerId: person.id,
      context: context(frontDeskId, "req-vehicle"),
    });
    const dispute = await service.openVehicleDispute({
      vehicleId: vehicle.id,
      note: "客户认为异响仍然存在",
      context: context(frontDeskId, "req-dispute-open"),
    });
    await expect(
      service.openVehicleDispute({
        vehicleId: vehicle.id,
        note: "重复开启",
        context: context(adminId, "req-dispute-duplicate"),
      }),
    ).rejects.toBeInstanceOf(CustomerVehicleConflictError);
    await service.resolveVehicleDispute({
      disputeId: dispute.id,
      note: "已复检并由客户确认解决",
      context: context(adminId, "req-dispute-resolve"),
    });
    const events = await database.query<{ event_type: string; reason: string | null }>(
      `select event_type, reason from audit_events
       where object_type = 'vehicle_dispute' order by occurred_at, id`,
    );
    expect(events.rows).toEqual([
      { event_type: "vehicle.dispute_opened", reason: "客户认为异响仍然存在" },
      { event_type: "vehicle.dispute_resolved", reason: "已复检并由客户确认解决" },
    ]);
  });

  it("registers only external file metadata and links it to the vehicle", async () => {
    const person = await service.createPersonalCustomer({
      fullName: "附件客户",
      phone: "+18765550140",
      context: context(frontDeskId, "req-person"),
    });
    const vehicle = await service.createVehicle({
      plate: "CC 9087",
      make: "Toyota",
      model: "Corolla",
      ownerType: "person",
      ownerId: person.id,
      context: context(frontDeskId, "req-vehicle"),
    });
    const attachment = await service.registerVehicleAttachment({
      vehicleId: vehicle.id,
      storageKey: "vehicle/1/photo-a.jpg",
      originalName: "接车照片.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 1024,
      sha256Hex: "a".repeat(64),
      kind: "photo",
      caption: "左前方",
      context: context(frontDeskId, "req-attachment"),
    });
    expect(attachment).toMatchObject({ vehicleId: vehicle.id, kind: "photo", originalName: "接车照片.jpg" });
    await expect(
      service.listVehicleAttachments({ viewerAccountId: ownerId, vehicleIds: [vehicle.id] }),
    ).resolves.toEqual([
      expect.objectContaining({
        fileId: attachment.fileId,
        vehicleId: vehicle.id,
        kind: "photo",
        originalName: "接车照片.jpg",
        sizeBytes: 1024,
      }),
    ]);
    await expect(
      service.getVehicleAttachmentFile({ viewerAccountId: ownerId, fileId: attachment.fileId }),
    ).resolves.toMatchObject({
      fileId: attachment.fileId,
      vehicleId: vehicle.id,
      storageKey: "vehicle/1/photo-a.jpg",
    });
  });

  it("keeps the owner role read-only at the service boundary", async () => {
    await expect(
      service.createPersonalCustomer({
        fullName: "老板不能写入",
        phone: "+18765550150",
        context: context(ownerId, "req-owner-write"),
      }),
    ).rejects.toBeInstanceOf(CustomerVehicleWriteDeniedError);
  });

  it("updates customer, company and vehicle records with optimistic versions", async () => {
    const person = await service.createPersonalCustomer({
      fullName: "原客户名",
      phone: "+18765550160",
      context: context(frontDeskId, "req-person"),
    });
    const updatedPerson = await service.updatePersonalCustomer({
      customerId: person.id,
      fullName: "新客户名",
      phone: "+18765550160",
      trn: "123456789",
      isActive: true,
      version: person.version,
      context: context(frontDeskId, "req-person-update"),
    });
    expect(updatedPerson).toMatchObject({
      fullName: "新客户名",
      trn: "123456789",
      version: 2,
      createdAt: new Date("2026-08-24T14:00:00Z"),
      updatedAt: new Date("2026-08-24T14:00:00Z"),
    });
    await expect(
      service.updatePersonalCustomer({
        customerId: person.id,
        fullName: "过期覆盖",
        phone: "+18765550160",
        trn: "123456789",
        isActive: true,
        version: person.version,
        context: context(adminId, "req-person-stale"),
      }),
    ).rejects.toBeInstanceOf(CustomerVehicleConflictError);

    const company = await service.createCompanyAccount({
      legalName: "Original Company",
      context: context(frontDeskId, "req-company"),
    });
    await expect(
      service.updateCompanyAccount({
        companyId: company.id,
        legalName: "Updated Company",
        phone: "+18765550161",
        isActive: true,
        version: company.version,
        context: context(frontDeskId, "req-company-update"),
      }),
    ).resolves.toMatchObject({ legalName: "Updated Company", version: 2 });

    const vehicle = await service.createVehicle({
      plate: "Q 100",
      vin: "1HGBH41JXMN109186",
      engineNumber: "L15A-1234567",
      make: "Honda",
      makeZh: "本田",
      model: "Fit",
      modelZh: "飞度",
      modelYear: 2019,
      color: "银色",
      bodyType: "掀背车",
      fuelType: "汽油",
      engineCc: 1497,
      seating: 5,
      usage: "个人用途",
      specialNotes: "客户自带儿童座椅套，施工时注意保护。",
      ownerType: "person",
      ownerId: person.id,
      context: context(frontDeskId, "req-vehicle"),
    });
    expect(vehicle).toMatchObject({
      engineNumber: "L15A-1234567",
      makeZh: "本田",
      modelZh: "飞度",
      bodyType: "掀背车",
      fuelType: "汽油",
      engineCc: 1497,
      seating: 5,
      usage: "个人用途",
      specialNotes: "客户自带儿童座椅套，施工时注意保护。",
      createdAt: new Date("2026-08-24T14:00:00Z"),
      updatedAt: new Date("2026-08-24T14:00:00Z"),
    });
    await expect(
      service.updateVehicle({
        vehicleId: vehicle.id,
        plate: "Q-101",
        vin: "1HGBH41JXMN109186",
        engineNumber: "L15A-1234567",
        make: "Honda",
        makeZh: "本田",
        model: "Fit",
        modelZh: "飞度",
        modelYear: 2020,
        color: "白色",
        bodyType: "掀背车",
        fuelType: "汽油",
        engineCc: 1497,
        seating: 5,
        usage: "公司通勤",
        specialNotes: "已核对车架号。",
        isActive: true,
        version: vehicle.version,
        context: context(frontDeskId, "req-vehicle-update"),
      }),
    ).resolves.toMatchObject({
      normalizedPlate: "Q101",
      modelYear: 2020,
      color: "白色",
      usage: "公司通勤",
      specialNotes: "已核对车架号。",
      version: 2,
      createdAt: new Date("2026-08-24T14:00:00Z"),
      updatedAt: new Date("2026-08-24T14:00:00Z"),
    });
  });
});
