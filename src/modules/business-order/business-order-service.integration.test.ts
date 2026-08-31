import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@formal/modules/auth/session-repository";
import {
  BusinessOrderConflictError,
  BusinessOrderService,
  BusinessOrderValidationError,
  BusinessOrderWriteDeniedError,
} from "@formal/modules/business-order/business-order-service";

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
  "0009_business_order_core.sql",
  "0010_business_order_facts_append_only.sql",
  "0011_repair_rounds.sql",
  "0018_business_order_number_format.sql",
  "0040_business_order_problem_descriptions.sql",
].map((name) => resolve(process.cwd(), "drizzle", name));

let database: PGlite;
let service: BusinessOrderService;
let adminId: number;
let frontDeskId: number;
let ownerId: number;
let personVehicleId: number;
let companyVehicleId: number;
let companyContactId: number;
let otherCompanyContactId: number;
let hourUnitId: number;
let eachUnitId: number;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
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
      (display_name, normalized_username, password_hash, role,
       must_change_password)
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
    now: new Date("2026-08-24T14:30:00Z"),
    ipAddress: "127.0.0.1",
    userAgent: "Vitest",
  };
}

describe("BusinessOrderService", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const path of migrationPaths) {
      await database.exec(await readFile(path, "utf8"));
    }
    adminId = await seedAccount("超级管理员", "admin", "super_admin");
    frontDeskId = await seedAccount("前台", "front", "front_desk");
    ownerId = await seedAccount("老板", "owner", "owner");
    const units = await database.query<{ id: number }>(
      `insert into dictionary_items
        (category, code, label_zh, label_en, created_by)
       values
        ('charge_unit', 'hour', '工时', 'hour', $1),
        ('charge_unit', 'each', '个', 'each', $1)
       returning id`,
      [adminId],
    );
    hourUnitId = Number(units.rows[0].id);
    eachUnitId = Number(units.rows[1].id);
    const person = await database.query<{ id: number }>(
      `insert into personal_customers
        (customer_no, full_name, normalized_phone, trn, created_by)
       values ('CUST-202608-0001', '张伟', '+18765550101', '123456789', $1)
       returning id`,
      [adminId],
    );
    const personId = Number(person.rows[0].id);
    const company = await database.query<{ id: number }>(
      `insert into company_accounts
        (company_no, legal_name, normalized_name, phone, trn, created_by)
       values ('COMP-202608-0001', 'Kingston Logistics Ltd',
               'kingston logistics ltd', '+18765550999', '987654321', $1)
       returning id`,
      [adminId],
    );
    const otherCompany = await database.query<{ id: number }>(
      `insert into company_accounts
        (company_no, legal_name, normalized_name, created_by)
       values ('COMP-202608-0002', 'Harbour Trading Ltd',
               'harbour trading ltd', $1)
       returning id`,
      [adminId],
    );
    const contacts = await database.query<{ id: number }>(
      `insert into company_contacts
        (company_id, personal_customer_id, is_primary, can_sign, created_by)
       values
        ($1, $3, true, true, $4),
        ($2, $3, true, true, $4)
       returning id`,
      [company.rows[0].id, otherCompany.rows[0].id, personId, adminId],
    );
    companyContactId = Number(contacts.rows[0].id);
    otherCompanyContactId = Number(contacts.rows[1].id);
    const vehicles = await database.query<{ id: number }>(
      `insert into vehicles
        (vehicle_no, plate_display, normalized_plate, vin, make, model,
         current_person_customer_id, current_company_account_id, created_by)
       values
        ('VEH-202608-0001', '7012 AB', '7012AB', '1HGBH41JXMN109186',
         'Honda', 'CR-V', $1, null, $3),
        ('VEH-202608-0002', '4321 AB', '4321AB', '1N4AL11D75C109151',
         'Nissan', 'X-Trail', null, $2, $3)
       returning id`,
      [personId, company.rows[0].id, adminId],
    );
    personVehicleId = Number(vehicles.rows[0].id);
    companyVehicleId = Number(vehicles.rows[1].id);
    service = new BusinessOrderService(testDatabase(database));
  });

  afterEach(async () => database.close());

  it("creates a formal Business Order from the vehicle payer snapshot", async () => {
    const order = await service.createBusinessOrder({
      vehicleId: personVehicleId,
      context: context(frontDeskId, "req-create-person-order"),
    });
    expect(order).toMatchObject({
      orderNo: "KGN-WH-2026082400001",
      vehicleId: personVehicleId,
      status: "waiting_assignment",
      payer: {
        type: "person",
        displayName: "张伟",
        phone: "+18765550101",
        trn: "123456789",
      },
      vehicle: {
        plate: "7012 AB",
        description: "Honda CR-V",
        vin: "1HGBH41JXMN109186",
      },
      currentChargeVersionNo: 1,
      version: 1,
    });
    const charge = await service.getCurrentCharges({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    });
    expect(charge).toMatchObject({
      versionNo: 1,
      totals: {
        grossMinor: 0,
        lineDiscountMinor: 0,
        categoryDiscountMinor: 0,
        wholeOrderDiscountMinor: 0,
        totalDueMinor: 0,
        includedGctMinor: 0,
      },
      items: [],
      notes: [],
    });
    const audits = await database.query<{ event_type: string }>(
      "select event_type from audit_events where request_id = 'req-create-person-order' order by id",
    );
    expect(audits.rows.map((row) => row.event_type)).toEqual([
      "business_order.created",
    ]);
  });

  it("stores an explicit original and keeps Business Order and repair-round descriptions independent", async () => {
    const empty = await service.createBusinessOrder({
      vehicleId: personVehicleId,
      problemDescriptionZh: "   ",
      context: context(frontDeskId, "req-create-empty-problem"),
    });
    await expect(service.getProblemDescriptionContext({
      businessOrderId: empty.id,
      viewerAccountId: ownerId,
    })).resolves.toMatchObject({
      original: {
        contentZh: null,
        contentEn: null,
        sourceType: "creation",
      },
      current: null,
      currentRound: null,
    });

    const order = await service.createBusinessOrder({
      vehicleId: personVehicleId,
      problemDescriptionZh: "发动机故障灯偶发点亮",
      problemDescriptionEn: "The engine warning light comes on intermittently.",
      context: context(frontDeskId, "req-create-problem"),
    });
    const created = await service.getProblemDescriptionContext({
      businessOrderId: order.id,
      viewerAccountId: ownerId,
    });
    expect(created).toMatchObject({
      original: {
        contentZh: "发动机故障灯偶发点亮",
        contentEn: "The engine warning light comes on intermittently.",
        sourceType: "creation",
      },
      current: {
        versionNo: 1,
        contentZh: "发动机故障灯偶发点亮",
        sourceType: "creation",
      },
      currentRound: {
        roundNo: 1,
        versionNo: 1,
        contentZh: "发动机故障灯偶发点亮",
        sourceType: "creation",
      },
    });

    await service.appendProblemDescriptionVersion({
      businessOrderId: order.id,
      scope: "business_order",
      expectedVersion: 1,
      contentZh: "发动机故障灯偶发点亮并伴随怠速不稳",
      contentEn: null,
      reason: "补充客户描述",
      sourceType: "manual",
      context: context(frontDeskId, "req-edit-order-problem"),
    });
    const afterOrderEdit = await service.getProblemDescriptionContext({
      businessOrderId: order.id,
      viewerAccountId: frontDeskId,
    });
    expect(afterOrderEdit.current).toMatchObject({
      versionNo: 2,
      contentZh: "发动机故障灯偶发点亮并伴随怠速不稳",
    });
    expect(afterOrderEdit.currentRound).toMatchObject({
      versionNo: 1,
      contentZh: "发动机故障灯偶发点亮",
    });

    await service.appendProblemDescriptionVersion({
      businessOrderId: order.id,
      repairRoundId: created.currentRound?.repairRoundId,
      scope: "repair_round",
      expectedVersion: 1,
      contentZh: "本轮先完成诊断，不追加维修项目",
      contentEn: null,
      reason: "明确本轮范围",
      sourceType: "manual",
      context: context(frontDeskId, "req-edit-round-problem"),
    });
    const afterRoundEdit = await service.getProblemDescriptionContext({
      businessOrderId: order.id,
      viewerAccountId: frontDeskId,
    });
    expect(afterRoundEdit.current).toMatchObject({
      versionNo: 2,
      contentZh: "发动机故障灯偶发点亮并伴随怠速不稳",
    });
    expect(afterRoundEdit.currentRound).toMatchObject({
      versionNo: 2,
      contentZh: "本轮先完成诊断，不追加维修项目",
    });
    expect(afterRoundEdit.businessOrderHistory.map((version) => version.versionNo))
      .toEqual([2, 1]);
    expect(afterRoundEdit.currentRoundHistory.map((version) => version.versionNo))
      .toEqual([2, 1]);

    await expect(service.appendProblemDescriptionVersion({
      businessOrderId: order.id,
      scope: "business_order",
      expectedVersion: 1,
      contentZh: "过期窗口保存",
      contentEn: null,
      reason: "测试冲突",
      sourceType: "manual",
      context: context(frontDeskId, "req-stale-problem"),
    })).rejects.toBeInstanceOf(BusinessOrderConflictError);

    const audits = await database.query<{
      event_type: string;
      after_state: Record<string, unknown> | null;
    }>(
      `select event_type, after_state
       from audit_events
       where request_id in ('req-edit-order-problem', 'req-edit-round-problem')
       order by id`,
    );
    expect(audits.rows.map((row) => row.event_type)).toEqual([
      "business_order.problem_description_appended",
      "repair_round.problem_description_appended",
    ]);
    expect(JSON.stringify(audits.rows)).not.toContain("发动机故障灯");
    expect(JSON.stringify(audits.rows)).not.toContain("本轮先完成诊断");
  });

  it("requires an active contact belonging to a company vehicle payer", async () => {
    await expect(
      service.createBusinessOrder({
        vehicleId: companyVehicleId,
        context: context(frontDeskId, "req-company-no-contact"),
      }),
    ).rejects.toBeInstanceOf(BusinessOrderValidationError);
    await expect(
      service.createBusinessOrder({
        vehicleId: companyVehicleId,
        companyContactId: otherCompanyContactId,
        context: context(frontDeskId, "req-company-wrong-contact"),
      }),
    ).rejects.toBeInstanceOf(BusinessOrderValidationError);

    await expect(
      service.createBusinessOrder({
        vehicleId: companyVehicleId,
        companyContactId,
        context: context(frontDeskId, "req-company-order"),
      }),
    ).resolves.toMatchObject({
      payer: {
        type: "company",
        displayName: "Kingston Logistics Ltd",
        contactName: "张伟",
      },
    });
  });

  it("creates a new immutable charge version with explicit discounts and included GCT", async () => {
    const order = await service.createBusinessOrder({
      vehicleId: personVehicleId,
      context: context(frontDeskId, "req-create-charge-order"),
    });
    const charges = await service.replaceChargeVersion({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      reason: "客户确认收费内容",
      laborDiscount: "1000",
      partDiscount: "500",
      otherDiscount: "0",
      wholeOrderDiscount: "1500",
      items: [
        {
          kind: "labor",
          nameZh: "发动机诊断工时",
          nameEn: "Engine diagnosis labor",
          descriptionZh: "诊断发动机异响",
          descriptionEn: "Diagnose engine noise",
          unitItemId: hourUnitId,
          quantity: "2",
          unitPrice: "10000",
          itemDiscount: "2000",
        },
        {
          kind: "part",
          nameZh: "发动机支架",
          nameEn: "Engine mount",
          unitItemId: eachUnitId,
          quantity: "1",
          unitPrice: "10000",
          itemDiscount: "1000",
        },
        {
          kind: "other",
          nameZh: "拖车服务",
          nameEn: "Towing service",
          unitItemId: eachUnitId,
          quantity: "1",
          unitPrice: "7500",
          itemDiscount: "0",
        },
      ],
      notes: [
        {
          kind: "liability_notice",
          contentZh: "已提前告知客户旧件可能在拆卸时损坏。",
          contentEn: "The customer was advised that the old part may be damaged during removal.",
        },
      ],
      context: context(frontDeskId, "req-replace-charge"),
    });
    expect(charges).toMatchObject({
      versionNo: 2,
      totals: {
        grossMinor: 3_750_000,
        lineDiscountMinor: 300_000,
        laborDiscountMinor: 100_000,
        partDiscountMinor: 50_000,
        otherDiscountMinor: 0,
        categoryDiscountMinor: 150_000,
        wholeOrderDiscountMinor: 0,
        totalDueMinor: 3_300_000,
        includedGctMinor: 430_435,
      },
      items: [
        expect.objectContaining({
          kind: "labor",
          subtotalMinor: 1_800_000,
        }),
        expect.objectContaining({
          kind: "part",
          subtotalMinor: 900_000,
        }),
        expect.objectContaining({
          kind: "other",
          subtotalMinor: 750_000,
        }),
      ],
      notes: [expect.objectContaining({ kind: "liability_notice" })],
      businessOrderVersion: 2,
    });
    await expect(
      database.query(
        "update business_order_charge_items set subtotal_minor = 1 where charge_version_id = $1",
        [charges.id],
      ),
    ).rejects.toThrow(/charge facts are append-only/);
  });

  it("rejects discounts that exceed their scope and stale aggregate versions", async () => {
    const order = await service.createBusinessOrder({
      vehicleId: personVehicleId,
      context: context(frontDeskId, "req-create-invalid-charge-order"),
    });
    await expect(
      service.replaceChargeVersion({
        businessOrderId: order.id,
        expectedBusinessOrderVersion: order.version,
        reason: "错误折扣",
        laborDiscount: "10001",
        partDiscount: "0",
        otherDiscount: "0",
        wholeOrderDiscount: "0",
        items: [{
          kind: "labor",
          nameZh: "诊断",
          unitItemId: hourUnitId,
          quantity: "1",
          unitPrice: "10000",
          itemDiscount: "0",
        }],
        notes: [],
        context: context(frontDeskId, "req-invalid-discount"),
      }),
    ).rejects.toBeInstanceOf(BusinessOrderValidationError);

    await service.replaceChargeVersion({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      reason: "有效收费",
      laborDiscount: "0",
      partDiscount: "0",
      otherDiscount: "0",
      wholeOrderDiscount: "0",
      items: [{
        kind: "labor",
        nameZh: "诊断",
        unitItemId: hourUnitId,
        quantity: "1",
        unitPrice: "10000",
        itemDiscount: "0",
      }],
      notes: [],
      context: context(frontDeskId, "req-valid-charge"),
    });
    await expect(
      service.replaceChargeVersion({
        businessOrderId: order.id,
        expectedBusinessOrderVersion: order.version,
        reason: "过期窗口再次保存",
        laborDiscount: "0",
        partDiscount: "0",
        otherDiscount: "0",
        wholeOrderDiscount: "0",
        items: [],
        notes: [],
        context: context(frontDeskId, "req-stale-charge"),
      }),
    ).rejects.toBeInstanceOf(BusinessOrderConflictError);
  });

  it("keeps the owner read-only and voids only an untouched waiting order with a reason", async () => {
    await expect(
      service.createBusinessOrder({
        vehicleId: personVehicleId,
        context: context(ownerId, "req-owner-create"),
      }),
    ).rejects.toBeInstanceOf(BusinessOrderWriteDeniedError);
    const order = await service.createBusinessOrder({
      vehicleId: personVehicleId,
      context: context(frontDeskId, "req-create-void-order"),
    });
    await service.voidBusinessOrder({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      reason: "客户未确认，取消本次预约",
      context: context(adminId, "req-void-order"),
    });
    await expect(
      service.getBusinessOrder({
        businessOrderId: order.id,
        viewerAccountId: ownerId,
      }),
    ).resolves.toMatchObject({
      id: order.id,
      voided: true,
      voidReason: "客户未确认，取消本次预约",
      version: 2,
    });
    const audits = await database.query<{ event_type: string; reason: string }>(
      "select event_type, reason from audit_events where request_id = 'req-void-order'",
    );
    expect(audits.rows).toEqual([{
      event_type: "business_order.voided",
      reason: "客户未确认，取消本次预约",
    }]);
  });
});
