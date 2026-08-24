import { toBusinessDateKey } from "@/lib/time";
import type {
  AuthSqlDatabase,
  AuthSqlExecutor,
} from "@/modules/auth/session-repository";
import { writeAuditEvent } from "@/modules/audit/audit-service";
import {
  calculateCharges,
  type ChargeTotals,
} from "@/modules/business-order/business-order-calculation";
import {
  BusinessOrderConflictError,
  BusinessOrderNotFoundError,
  BusinessOrderReadDeniedError,
  BusinessOrderValidationError,
  BusinessOrderWriteDeniedError,
} from "@/modules/business-order/business-order-errors";
import {
  createBusinessOrderSchema,
  replaceChargeVersionSchema,
  type BusinessOrderNoteInput,
  type ChargeItemInput,
  type ParsedBusinessOrderNote,
  voidBusinessOrderSchema,
} from "@/modules/business-order/business-order-schemas";

export {
  BusinessOrderConflictError,
  BusinessOrderNotFoundError,
  BusinessOrderReadDeniedError,
  BusinessOrderValidationError,
  BusinessOrderWriteDeniedError,
} from "@/modules/business-order/business-order-errors";

export type BusinessOrderActionContext = {
  actorAccountId: number;
  requestId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type BusinessOrderRecord = {
  id: number;
  orderNo: string;
  vehicleId: number;
  payer: {
    type: "person" | "company";
    displayName: string;
    phone: string | null;
    trn: string | null;
    contactName: string | null;
  };
  vehicle: { plate: string; description: string; vin: string | null };
  status:
    | "waiting_assignment"
    | "assigned"
    | "in_repair"
    | "return_pending_review"
    | "formally_handed_off";
  currentChargeVersionNo: number;
  createdAt: Date;
  voided: boolean;
  voidReason: string | null;
  version: number;
};

export type BusinessOrderChargeSnapshot = {
  id: number;
  businessOrderId: number;
  versionNo: number;
  reason: string;
  totals: ChargeTotals;
  items: Array<{
    id: number;
    kind: "labor" | "part" | "other";
    nameZh: string;
    nameEn: string | null;
    descriptionZh: string | null;
    descriptionEn: string | null;
    unitItemId: number;
    quantity: string;
    unitPriceMinor: number;
    itemDiscountMinor: number;
    subtotalMinor: number;
    sortOrder: number;
  }>;
  notes: Array<{
    id: number;
    kind: ParsedBusinessOrderNote["kind"];
    contentZh: string | null;
    contentEn: string | null;
    sortOrder: number;
  }>;
  businessOrderVersion: number;
};

type BusinessOrderRow = {
  id: number;
  order_no: string;
  vehicle_id: number;
  payer_person_customer_id: number | null;
  payer_company_account_id: number | null;
  payer_display_name_snapshot: string;
  payer_phone_snapshot: string | null;
  payer_trn_snapshot: string | null;
  payer_contact_name_snapshot: string | null;
  vehicle_plate_snapshot: string;
  vehicle_description_snapshot: string;
  vehicle_vin_snapshot: string | null;
  status: BusinessOrderRecord["status"];
  current_charge_version_no: number;
  created_at: Date;
  voided_at: Date | null;
  void_reason: string | null;
  version: number;
};

type VehiclePayerRow = {
  id: number;
  plate_display: string;
  vin: string | null;
  make: string;
  model: string;
  current_person_customer_id: number | null;
  current_company_account_id: number | null;
  person_name: string | null;
  person_phone: string | null;
  person_trn: string | null;
  company_name: string | null;
  company_phone: string | null;
  company_trn: string | null;
};

type ChargeVersionRow = {
  id: number;
  business_order_id: number;
  version_no: number;
  change_reason: string;
  labor_discount_minor: number;
  part_discount_minor: number;
  other_discount_minor: number;
  whole_order_discount_minor: number;
  gross_minor: number;
  line_discount_minor: number;
  category_discount_minor: number;
  total_due_minor: number;
  included_gct_minor: number;
};

export class BusinessOrderService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async createBusinessOrder(input: {
    vehicleId: number;
    companyContactId?: number | null;
    context: BusinessOrderActionContext;
  }): Promise<BusinessOrderRecord> {
    const fields = createBusinessOrderSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        const vehicles = await transaction.query<VehiclePayerRow>(
          `select vehicle.id, vehicle.plate_display, vehicle.vin,
                  vehicle.make, vehicle.model,
                  vehicle.current_person_customer_id,
                  vehicle.current_company_account_id,
                  person.full_name as person_name,
                  person.normalized_phone as person_phone,
                  person.trn as person_trn,
                  company.legal_name as company_name,
                  company.phone as company_phone,
                  company.trn as company_trn
           from vehicles as vehicle
           left join personal_customers as person
             on person.id = vehicle.current_person_customer_id
            and person.is_active = true
           left join company_accounts as company
             on company.id = vehicle.current_company_account_id
            and company.is_active = true
           where vehicle.id = $1 and vehicle.is_active = true
           for update of vehicle`,
          [fields.vehicleId],
        );
        const vehicle = vehicles[0];
        if (!vehicle) throw new BusinessOrderNotFoundError("车辆不存在或已停用");
        const isCompany = vehicle.current_company_account_id !== null;
        if (!isCompany && fields.companyContactId !== null) {
          throw new BusinessOrderValidationError("个人车辆不需要选择公司联系人");
        }
        let contactName: string | null = null;
        if (isCompany) {
          if (fields.companyContactId === null) {
            throw new BusinessOrderValidationError("公司车辆必须选择本公司的联系人");
          }
          const contacts = await transaction.query<{ full_name: string }>(
            `select person.full_name
             from company_contacts as contact
             join personal_customers as person
               on person.id = contact.personal_customer_id
             where contact.id = $1
               and contact.company_id = $2
               and contact.is_active = true
               and person.is_active = true
             limit 1`,
            [fields.companyContactId, vehicle.current_company_account_id],
          );
          if (!contacts[0]) {
            throw new BusinessOrderValidationError("所选联系人不属于当前付款公司或已经停用");
          }
          contactName = contacts[0].full_name;
        }
        const payerId = isCompany
          ? vehicle.current_company_account_id
          : vehicle.current_person_customer_id;
        const payerName = isCompany ? vehicle.company_name : vehicle.person_name;
        if (!payerId || !payerName) {
          throw new BusinessOrderValidationError("车辆当前付款责任档案无效");
        }
        await transaction.query("lock table business_orders in share row exclusive mode");
        const orderNo = await nextBusinessOrderNumber(transaction, now);
        const rows = await transaction.query<BusinessOrderRow>(
          `insert into business_orders
            (order_no, vehicle_id, payer_person_customer_id,
             payer_company_account_id, payer_company_contact_id,
             payer_display_name_snapshot, payer_phone_snapshot,
             payer_trn_snapshot, payer_contact_name_snapshot,
             vehicle_plate_snapshot, vehicle_description_snapshot,
             vehicle_vin_snapshot, current_charge_version_no,
             created_at, updated_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   $12, 0, $13, $13, $14)
           returning ${businessOrderColumns()}`,
          [
            orderNo,
            fields.vehicleId,
            isCompany ? null : payerId,
            isCompany ? payerId : null,
            fields.companyContactId,
            payerName,
            isCompany ? vehicle.company_phone : vehicle.person_phone,
            isCompany ? vehicle.company_trn : vehicle.person_trn,
            contactName,
            vehicle.plate_display,
            `${vehicle.make} ${vehicle.model}`.trim(),
            vehicle.vin,
            now,
            input.context.actorAccountId,
          ],
        );
        const insertedOrder = mapBusinessOrder(rows[0]);
        await transaction.query(
          `insert into business_order_charge_versions
            (business_order_id, version_no, change_reason,
             labor_discount_minor, part_discount_minor,
             other_discount_minor, whole_order_discount_minor,
             gross_minor, line_discount_minor, category_discount_minor,
             total_due_minor, included_gct_minor, created_at, created_by)
           values ($1, 1, 'Business Order 创建', 0, 0, 0, 0,
                   0, 0, 0, 0, 0, $2, $3)`,
          [insertedOrder.id, now, input.context.actorAccountId],
        );
        await transaction.query(
          `update business_orders
           set current_charge_version_no = 1, updated_at = $2
           where id = $1`,
          [insertedOrder.id, now],
        );
        await transaction.query(
          `insert into repair_rounds
            (business_order_id, round_no, source, status,
             created_at, created_by, updated_at)
           values ($1, 1, 'initial', 'waiting_assignment', $2, $3, $2)`,
          [insertedOrder.id, now, input.context.actorAccountId],
        );
        const order = { ...insertedOrder, currentChargeVersionNo: 1 };
        await audit(transaction, input.context, now, {
          eventType: "business_order.created",
          objectId: String(order.id),
          after: order,
        });
        return order;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async getBusinessOrder(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<BusinessOrderRecord> {
    await requireReader(this.database, input.viewerAccountId);
    const rows = await selectBusinessOrder(this.database, input.businessOrderId);
    if (!rows[0]) throw new BusinessOrderNotFoundError();
    return mapBusinessOrder(rows[0]);
  }

  async listBusinessOrders(input: {
    viewerAccountId: number;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    await requireReader(this.database, input.viewerAccountId);
    const pageSize = positivePageSize(input.pageSize);
    const requestedPage = positivePage(input.page);
    const search = input.search?.normalize("NFKC").trim() || null;
    const like = search ? `%${search}%` : null;
    const counts = await this.database.query<{ total: number }>(
      `select count(*)::integer as total from business_orders
       where ($1::text is null or order_no ilike $2
          or vehicle_plate_snapshot ilike $2
          or payer_display_name_snapshot ilike $2)`,
      [search, like],
    );
    const total = Number(counts[0]?.total ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const rows = await this.database.query<BusinessOrderRow>(
      `select ${businessOrderColumns()} from business_orders
       where ($1::text is null or order_no ilike $2
          or vehicle_plate_snapshot ilike $2
          or payer_display_name_snapshot ilike $2)
       order by created_at desc, id desc offset $3 limit $4`,
      [search, like, (page - 1) * pageSize, pageSize],
    );
    return {
      items: rows.map(mapBusinessOrder),
      page,
      pageSize,
      pageCount,
      total,
    };
  }

  async getCurrentCharges(input: {
    businessOrderId: number;
    viewerAccountId: number;
  }): Promise<BusinessOrderChargeSnapshot> {
    await requireReader(this.database, input.viewerAccountId);
    const orders = await selectBusinessOrder(this.database, input.businessOrderId);
    const order = orders[0];
    if (!order) throw new BusinessOrderNotFoundError();
    return selectChargeSnapshot(
      this.database,
      input.businessOrderId,
      order.current_charge_version_no,
      order.version,
    );
  }

  async replaceChargeVersion(input: {
    businessOrderId: number;
    expectedBusinessOrderVersion: number;
    reason: string;
    laborDiscount: string;
    partDiscount: string;
    otherDiscount: string;
    wholeOrderDiscount: string;
    items: ChargeItemInput[];
    notes: BusinessOrderNoteInput[];
    context: BusinessOrderActionContext;
  }): Promise<BusinessOrderChargeSnapshot> {
    const fields = replaceChargeVersionSchema.parse(input);
    const calculated = calculateCharges(fields);
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireWriter(transaction, input.context.actorAccountId);
      const orders = await transaction.query<BusinessOrderRow>(
        `select ${businessOrderColumns()}
         from business_orders where id = $1 for update`,
        [fields.businessOrderId],
      );
      const order = orders[0];
      if (!order) throw new BusinessOrderNotFoundError();
      if (order.voided_at) {
        throw new BusinessOrderValidationError("已作废的 Business Order 不能修改收费");
      }
      if (order.version !== fields.expectedBusinessOrderVersion) {
        throw new BusinessOrderConflictError();
      }
      await requireChargeUnits(transaction, calculated.items.map((item) => item.unitItemId));
      const versionNo = order.current_charge_version_no + 1;
      const versions = await transaction.query<{ id: number }>(
        `insert into business_order_charge_versions
          (business_order_id, version_no, change_reason,
           labor_discount_minor, part_discount_minor,
           other_discount_minor, whole_order_discount_minor,
           gross_minor, line_discount_minor, category_discount_minor,
           total_due_minor, included_gct_minor, created_at, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14) returning id`,
        [
          fields.businessOrderId,
          versionNo,
          fields.reason,
          calculated.totals.laborDiscountMinor,
          calculated.totals.partDiscountMinor,
          calculated.totals.otherDiscountMinor,
          calculated.totals.wholeOrderDiscountMinor,
          calculated.totals.grossMinor,
          calculated.totals.lineDiscountMinor,
          calculated.totals.categoryDiscountMinor,
          calculated.totals.totalDueMinor,
          calculated.totals.includedGctMinor,
          now,
          input.context.actorAccountId,
        ],
      );
      const chargeVersionId = Number(versions[0].id);
      await insertChargeItems(transaction, chargeVersionId, calculated.items);
      await insertNotes(transaction, chargeVersionId, fields.notes);
      const updated = await transaction.query<{ version: number }>(
        `update business_orders
         set current_charge_version_no = $2, updated_at = $3,
             version = version + 1
         where id = $1 and version = $4 returning version`,
        [fields.businessOrderId, versionNo, now, fields.expectedBusinessOrderVersion],
      );
      if (!updated[0]) throw new BusinessOrderConflictError();
      await audit(transaction, input.context, now, {
        eventType: "business_order.charges_replaced",
        objectId: String(fields.businessOrderId),
        reason: fields.reason,
        before: { chargeVersionNo: order.current_charge_version_no },
        after: { chargeVersionNo: versionNo, totals: calculated.totals },
      });
      return selectChargeSnapshot(
        transaction,
        fields.businessOrderId,
        versionNo,
        Number(updated[0].version),
      );
    });
  }

  async voidBusinessOrder(input: {
    businessOrderId: number;
    expectedBusinessOrderVersion: number;
    reason: string;
    context: BusinessOrderActionContext;
  }): Promise<void> {
    const fields = voidBusinessOrderSchema.parse(input);
    const now = input.context.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      await requireWriter(transaction, input.context.actorAccountId);
      const orders = await transaction.query<BusinessOrderRow & { total_due_minor: number }>(
        `select ${businessOrderColumns("business_orders")}, charge.total_due_minor
         from business_orders
         join business_order_charge_versions as charge
           on charge.business_order_id = business_orders.id
          and charge.version_no = business_orders.current_charge_version_no
         where business_orders.id = $1 for update of business_orders`,
        [fields.businessOrderId],
      );
      const order = orders[0];
      if (!order) throw new BusinessOrderNotFoundError();
      if (order.version !== fields.expectedBusinessOrderVersion) {
        throw new BusinessOrderConflictError();
      }
      if (
        order.voided_at || order.status !== "waiting_assignment" ||
        order.current_charge_version_no !== 1 || Number(order.total_due_minor) !== 0
      ) {
        throw new BusinessOrderValidationError(
          "只有尚未派单、尚未修改收费的 Business Order 可以直接作废",
        );
      }
      const updated = await transaction.query<{ version: number }>(
        `update business_orders
         set voided_at = $2, voided_by = $3, void_reason = $4,
             updated_at = $2, version = version + 1
         where id = $1 and version = $5 and voided_at is null returning version`,
        [fields.businessOrderId, now, input.context.actorAccountId,
          fields.reason, fields.expectedBusinessOrderVersion],
      );
      if (!updated[0]) throw new BusinessOrderConflictError();
      await audit(transaction, input.context, now, {
        eventType: "business_order.voided",
        objectId: String(fields.businessOrderId),
        reason: fields.reason,
        before: { voided: false, version: order.version },
        after: { voided: true, version: Number(updated[0].version) },
      });
    });
  }
}

async function insertChargeItems(
  executor: AuthSqlExecutor,
  chargeVersionId: number,
  items: ReturnType<typeof calculateCharges>["items"],
) {
  for (const [index, item] of items.entries()) {
    await executor.query(
      `insert into business_order_charge_items
        (charge_version_id, kind, name_zh, name_en, description_zh,
         description_en, unit_item_id, quantity, unit_price_minor,
         item_discount_minor, subtotal_minor, sort_order)
       values ($1, $2::charge_item_kind, $3, $4, $5, $6, $7,
               $8::numeric, $9, $10, $11, $12)`,
      [chargeVersionId, item.kind, item.nameZh, item.nameEn,
        item.descriptionZh, item.descriptionEn, item.unitItemId, item.quantity,
        item.unitPriceMinor, item.itemDiscountMinor, item.subtotalMinor, index + 1],
    );
  }
}

async function insertNotes(
  executor: AuthSqlExecutor,
  chargeVersionId: number,
  notes: ParsedBusinessOrderNote[],
) {
  for (const [index, note] of notes.entries()) {
    await executor.query(
      `insert into business_order_notes
        (charge_version_id, kind, content_zh, content_en, sort_order)
       values ($1, $2::business_order_note_kind, $3, $4, $5)`,
      [chargeVersionId, note.kind, note.contentZh, note.contentEn, index + 1],
    );
  }
}

async function selectChargeSnapshot(
  executor: AuthSqlExecutor,
  businessOrderId: number,
  versionNo: number,
  businessOrderVersion: number,
): Promise<BusinessOrderChargeSnapshot> {
  const versions = await executor.query<ChargeVersionRow>(
    `select id, business_order_id, version_no, change_reason,
            labor_discount_minor, part_discount_minor,
            other_discount_minor, whole_order_discount_minor,
            gross_minor, line_discount_minor, category_discount_minor,
            total_due_minor, included_gct_minor
     from business_order_charge_versions
     where business_order_id = $1 and version_no = $2 limit 1`,
    [businessOrderId, versionNo],
  );
  const version = versions[0];
  if (!version) throw new BusinessOrderNotFoundError("收费版本不存在");
  const items = await executor.query<{
    id: number; kind: "labor" | "part" | "other";
    name_zh: string; name_en: string | null;
    description_zh: string | null; description_en: string | null;
    unit_item_id: number; quantity: string; unit_price_minor: number;
    item_discount_minor: number; subtotal_minor: number; sort_order: number;
  }>(
    `select id, kind, name_zh, name_en, description_zh, description_en,
            unit_item_id, quantity::text as quantity, unit_price_minor,
            item_discount_minor, subtotal_minor, sort_order
     from business_order_charge_items
     where charge_version_id = $1 order by sort_order, id`,
    [version.id],
  );
  const notes = await executor.query<{
    id: number; kind: ParsedBusinessOrderNote["kind"];
    content_zh: string | null; content_en: string | null; sort_order: number;
  }>(
    `select id, kind, content_zh, content_en, sort_order
     from business_order_notes
     where charge_version_id = $1 order by sort_order, id`,
    [version.id],
  );
  return {
    id: Number(version.id),
    businessOrderId: Number(version.business_order_id),
    versionNo: version.version_no,
    reason: version.change_reason,
    totals: {
      grossMinor: Number(version.gross_minor),
      lineDiscountMinor: Number(version.line_discount_minor),
      laborDiscountMinor: Number(version.labor_discount_minor),
      partDiscountMinor: Number(version.part_discount_minor),
      otherDiscountMinor: Number(version.other_discount_minor),
      categoryDiscountMinor: Number(version.category_discount_minor),
      wholeOrderDiscountMinor: Number(version.whole_order_discount_minor),
      totalDueMinor: Number(version.total_due_minor),
      includedGctMinor: Number(version.included_gct_minor),
    },
    items: items.map((item) => ({
      id: Number(item.id), kind: item.kind, nameZh: item.name_zh,
      nameEn: item.name_en, descriptionZh: item.description_zh,
      descriptionEn: item.description_en, unitItemId: Number(item.unit_item_id),
      quantity: item.quantity, unitPriceMinor: Number(item.unit_price_minor),
      itemDiscountMinor: Number(item.item_discount_minor),
      subtotalMinor: Number(item.subtotal_minor), sortOrder: item.sort_order,
    })),
    notes: notes.map((note) => ({
      id: Number(note.id), kind: note.kind, contentZh: note.content_zh,
      contentEn: note.content_en, sortOrder: note.sort_order,
    })),
    businessOrderVersion,
  };
}

async function selectBusinessOrder(executor: AuthSqlExecutor, id: number) {
  return executor.query<BusinessOrderRow>(
    `select ${businessOrderColumns()} from business_orders where id = $1 limit 1`,
    [id],
  );
}

function businessOrderColumns(prefix?: string) {
  const p = prefix ? `${prefix}.` : "";
  return `${p}id, ${p}order_no, ${p}vehicle_id,
          ${p}payer_person_customer_id, ${p}payer_company_account_id,
          ${p}payer_display_name_snapshot, ${p}payer_phone_snapshot,
          ${p}payer_trn_snapshot, ${p}payer_contact_name_snapshot,
          ${p}vehicle_plate_snapshot, ${p}vehicle_description_snapshot,
          ${p}vehicle_vin_snapshot, ${p}status,
          ${p}current_charge_version_no, ${p}created_at,
          ${p}voided_at, ${p}void_reason, ${p}version`;
}

function mapBusinessOrder(row: BusinessOrderRow | undefined): BusinessOrderRecord {
  if (!row) throw new Error("Business Order 写入后无法读取");
  return {
    id: Number(row.id), orderNo: row.order_no, vehicleId: Number(row.vehicle_id),
    payer: {
      type: row.payer_company_account_id !== null ? "company" : "person",
      displayName: row.payer_display_name_snapshot,
      phone: row.payer_phone_snapshot, trn: row.payer_trn_snapshot,
      contactName: row.payer_contact_name_snapshot,
    },
    vehicle: {
      plate: row.vehicle_plate_snapshot,
      description: row.vehicle_description_snapshot,
      vin: row.vehicle_vin_snapshot,
    },
    status: row.status, currentChargeVersionNo: row.current_charge_version_no,
    createdAt: new Date(row.created_at), voided: row.voided_at !== null,
    voidReason: row.void_reason, version: row.version,
  };
}

async function nextBusinessOrderNumber(executor: AuthSqlExecutor, now: Date) {
  const prefix = `BO-${toBusinessDateKey(now).replaceAll("-", "")}-`;
  const rows = await executor.query<{ current_number: number }>(
    `select coalesce(max(right(order_no, 4)::integer), 0)::integer as current_number
     from business_orders where order_no like $1`,
    [`${prefix}%`],
  );
  const next = Number(rows[0]?.current_number ?? 0) + 1;
  if (next > 9_999) throw new BusinessOrderConflictError("当天 Business Order 编号已经用尽");
  return `${prefix}${String(next).padStart(4, "0")}`;
}

async function requireReader(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ role: string }>(
    `select role from staff_accounts where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk', 'owner') limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new BusinessOrderReadDeniedError();
}

async function requireWriter(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ role: string }>(
    `select role from staff_accounts where id = $1 and is_active = true
       and role in ('super_admin', 'front_desk') limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new BusinessOrderWriteDeniedError();
}

async function requireChargeUnits(executor: AuthSqlExecutor, unitIds: number[]) {
  const unique = [...new Set(unitIds)];
  if (unique.length === 0) return;
  const rows = await executor.query<{ id: number }>(
    `select id from dictionary_items where id = any($1::bigint[])
       and category = 'charge_unit' and is_active = true`,
    [unique],
  );
  if (rows.length !== unique.length) {
    throw new BusinessOrderValidationError("收费单位不存在或已经停用");
  }
}

async function audit(
  executor: AuthSqlExecutor,
  context: BusinessOrderActionContext,
  occurredAt: Date,
  input: {
    eventType: string; objectId: string; reason?: string | null;
    before?: Record<string, unknown> | null; after?: Record<string, unknown> | null;
  },
) {
  await writeAuditEvent(executor, {
    occurredAt, actorAccountId: context.actorAccountId,
    eventType: input.eventType, objectType: "business_order",
    objectId: input.objectId, reason: input.reason,
    before: input.before, after: input.after, requestId: context.requestId,
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });
}

function positivePage(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : 1;
}

function positivePageSize(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value as number, 100) : 20;
}

function rethrowConflict(error: unknown): never {
  if (
    error instanceof BusinessOrderReadDeniedError ||
    error instanceof BusinessOrderWriteDeniedError ||
    error instanceof BusinessOrderNotFoundError ||
    error instanceof BusinessOrderConflictError ||
    error instanceof BusinessOrderValidationError
  ) throw error;
  if (databaseErrorCode(error) === "23505") {
    throw new BusinessOrderConflictError("Business Order 编号或版本发生冲突，请重试");
  }
  throw error;
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : null;
}
