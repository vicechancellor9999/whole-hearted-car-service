import { existsSync } from "node:fs";
import path from "node:path";
import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { BusinessOrderService } from "@/modules/business-order/business-order-service";
import { CustomerVehicleService } from "@/modules/customer-vehicle/customer-vehicle-service";
import { MasterDataService } from "@/modules/master-data/master-data-service";

const envFile = path.join(process.cwd(), ".env.local");
if (!existsSync(envFile)) throw new Error("缺少 .env.local，不能连接正式演示数据库");
process.loadEnvFile(envFile);

const apply = process.argv.includes("--apply");
const scopedTables = [
  "audit_events",
  "business_order_document_snapshots",
  "refund_evidence_files",
  "payment_receipts",
  "business_order_refunds",
  "business_order_payments",
  "formal_handoff_cancellations",
  "formal_handoffs",
  "inspection_report_findings",
  "inspection_reports",
  "vehicle_pickup_notices",
  "vehicle_mileage_records",
  "repair_round_work_returns",
  "repair_round_intake_photos",
  "repair_round_events",
  "repair_rounds",
  "business_order_notes",
  "business_order_charge_items",
  "business_order_charge_versions",
  "business_orders",
  "vehicle_disputes",
  "vehicle_attachments",
  "vehicle_owner_history",
  "vehicles",
  "stored_files",
  "company_contacts",
  "customer_trn_registry",
  "company_accounts",
  "personal_customers",
  "staff_team_assignment_versions",
  "employee_salary_versions",
  "staff_members",
  "repair_team_retirements",
  "repair_teams",
  "payroll_parameter_versions",
  "dictionary_items",
] as const;

const databaseClient = createDatabaseClient(process.env);
const database = createPostgresAuthSqlDatabase(databaseClient.sql);

try {
  const accounts = await database.query<{
    id: number;
    normalized_username: string;
    role: string;
    is_active: boolean;
  }>(
    `select id, normalized_username, role, is_active
     from staff_accounts order by id`,
  );
  const activeAdmins = accounts.filter((account) => account.role === "super_admin" && account.is_active);
  const otherAccounts = accounts.filter((account) => account.role !== "super_admin");
  if (activeAdmins.length !== 1 || otherAccounts.length > 0) {
    throw new Error("账号范围不是“唯一超级管理员”，已停止重置，避免误删正式账号");
  }

  const counts: Array<{ tableName: string; count: number }> = [];
  for (const tableName of scopedTables) {
    const rows = await database.query<{ count: number }>(
      `select count(*)::integer as count from "${tableName}"`,
    );
    counts.push({ tableName, count: Number(rows[0]?.count ?? 0) });
  }
  process.stdout.write("正式演示数据重置范围（账号与登录会话不动）：\n");
  for (const item of counts.filter((entry) => entry.count > 0)) {
    process.stdout.write(`- ${item.tableName}: ${item.count}\n`);
  }
  if (!apply) {
    process.stdout.write("\n仅预览。确认范围后使用 --apply 执行。\n");
    process.exitCode = 0;
  } else {
    await database.query(
      `truncate table ${scopedTables.map((tableName) => `"${tableName}"`).join(", ")}
       restart identity cascade`,
    );

    const actorAccountId = Number(activeAdmins[0].id);
    const now = new Date();
    let requestSequence = 0;
    const context = () => ({
      actorAccountId,
      requestId: `formal-demo-reset-${++requestSequence}`,
      now,
      ipAddress: "127.0.0.1",
      userAgent: "Formal demo reset",
    });
    const masterData = new MasterDataService(database);
    const customerVehicles = new CustomerVehicleService(database);
    const businessOrders = new BusinessOrderService(database);

    const laborUnit = await masterData.createDictionaryItem({
      category: "charge_unit", code: "labor_hour", labelZh: "工时", labelEn: "Hour",
      context: context(),
    });
    const itemUnit = await masterData.createDictionaryItem({
      category: "charge_unit", code: "piece", labelZh: "件", labelEn: "Piece",
      context: context(),
    });
    await masterData.createDictionaryItem({
      category: "staff_position", code: "mechanic", labelZh: "维修工", labelEn: "Mechanic",
      context: context(),
    });
    for (const paymentMethod of [
      { code: "cash", labelZh: "现金", labelEn: "Cash" },
      { code: "bank_transfer", labelZh: "银行转账", labelEn: "Bank transfer" },
      { code: "card", labelZh: "银行卡", labelEn: "Card" },
    ]) {
      await masterData.createDictionaryItem({
        category: "payment_method", ...paymentMethod, context: context(),
      });
    }

    const personalOwner = await customerVehicles.createPersonalCustomer({
      fullName: "戴维·布莱克 / David Blake",
      phone: "+18765550102",
      whatsapp: "+18765550102",
      address: "Kingston, Jamaica",
      context: context(),
    });
    const companyContactPerson = await customerVehicles.createPersonalCustomer({
      fullName: "德韦恩·克拉克 / Dwayne Clarke",
      phone: "+18765550112",
      address: "Kingston, Jamaica",
      context: context(),
    });
    const company = await customerVehicles.createCompanyAccount({
      legalName: "North Coast Logistics Ltd",
      trn: "123456789",
      phone: "+18765550122",
      address: "Montego Bay, Jamaica",
      context: context(),
    });
    await customerVehicles.addCompanyContact({
      companyId: company.id,
      personalCustomerId: companyContactPerson.id,
      jobTitle: "车队负责人 / Fleet Supervisor",
      isPrimary: true,
      canSign: true,
      receivesInvoice: true,
      receivesCollection: true,
      context: context(),
    });

    const personalVehicle = await customerVehicles.createVehicle({
      plate: "4321 AB",
      vin: "JN1BJ0RR9HM123456",
      engineNumber: "MR20DE123456",
      make: "Nissan",
      makeZh: "日产",
      model: "X-Trail",
      modelZh: "奇骏",
      modelYear: 2021,
      color: "银色",
      bodyType: "运动型多用途车",
      fuelType: "汽油",
      engineCc: 1997,
      seating: 5,
      usage: "个人用车",
      specialNotes: "接车后核对随车工具及备胎情况。",
      ownerType: "person",
      ownerId: personalOwner.id,
      context: context(),
    });
    await customerVehicles.createVehicle({
      plate: "4789 CP",
      vin: "JTFSX22P406123456",
      engineNumber: "2KD9876543",
      make: "Toyota",
      makeZh: "丰田",
      model: "Hiace",
      modelZh: "海狮",
      modelYear: 2020,
      color: "白色",
      bodyType: "厢式客车",
      fuelType: "柴油",
      engineCc: 2494,
      seating: 12,
      usage: "公司营运",
      specialNotes: "公司车辆；费用由公司账户承担，现场联系人为车队负责人。",
      ownerType: "company",
      ownerId: company.id,
      context: context(),
    });

    const order = await businessOrders.createBusinessOrder({
      vehicleId: personalVehicle.id,
      context: context(),
    });
    await businessOrders.replaceChargeVersion({
      businessOrderId: order.id,
      expectedBusinessOrderVersion: order.version,
      reason: "建立可编辑、可计算的正式演示收费内容",
      laborDiscount: "0",
      partDiscount: "0",
      otherDiscount: "0",
      wholeOrderDiscount: "500",
      items: [
        {
          kind: "labor",
          nameZh: "发动机诊断工时",
          nameEn: "Engine diagnosis labor",
          descriptionZh: "读取故障码并检查发动机运行数据",
          descriptionEn: "Read fault codes and inspect live engine data",
          unitItemId: laborUnit.id,
          quantity: "2",
          unitPrice: "10000",
          itemDiscount: "0",
        },
        {
          kind: "part",
          nameZh: "机油滤清器",
          nameEn: "Engine oil filter",
          descriptionZh: "更换适配车型的机油滤清器",
          descriptionEn: "Replace the correct engine oil filter",
          unitItemId: itemUnit.id,
          quantity: "1",
          unitPrice: "5500",
          itemDiscount: "500",
        },
      ],
      notes: [
        {
          kind: "customer_concern",
          contentZh: "客户反映发动机故障灯偶发点亮，并伴随怠速不稳。",
          contentEn: "Customer reports an intermittent engine warning light and unstable idle.",
        },
        {
          kind: "liability_notice",
          contentZh: "本次先完成诊断；如需追加维修项目，须再次与客户确认。",
          contentEn: "This visit covers diagnosis first. Additional repair work requires customer confirmation.",
        },
      ],
      context: context(),
    });

    const summary = await Promise.all([
      database.query<{ count: number }>("select count(*)::integer as count from personal_customers"),
      database.query<{ count: number }>("select count(*)::integer as count from company_accounts"),
      database.query<{ count: number }>("select count(*)::integer as count from vehicles"),
      database.query<{ count: number }>("select count(*)::integer as count from business_orders"),
    ]);
    process.stdout.write(
      `\n重置完成：个人客户 ${summary[0][0].count}，公司账户 ${summary[1][0].count}，车辆 ${summary[2][0].count}，Business Order ${summary[3][0].count}。\n`,
    );
  }
} finally {
  await databaseClient.close();
}
