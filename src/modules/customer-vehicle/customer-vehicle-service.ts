import { toBusinessMonthKey } from "@/lib/time";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@/modules/auth/session-repository";
import { writeAuditEvent } from "@/modules/audit/audit-service";
import {
  changeVehicleOwnerSchema,
  companyContactSchema,
  createCompanyAccountSchema,
  createPersonalCustomerSchema,
  createVehicleSchema,
  disputeNoteSchema,
  registerVehicleAttachmentSchema,
  updateCompanyAccountSchema,
  updateCompanyContactSchema,
  updatePersonalCustomerSchema,
  updateVehicleSchema,
} from "@/modules/customer-vehicle/customer-vehicle-schemas";

export type CustomerVehicleActionContext = {
  actorAccountId: number;
  requestId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PersonalCustomerRecord = {
  id: number;
  customerNo: string;
  fullName: string;
  normalizedPhone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  trn: string | null;
  isActive: boolean;
  version: number;
};

export type CompanyAccountRecord = {
  id: number;
  companyNo: string;
  legalName: string;
  trn: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  version: number;
};

export type CompanyContactRecord = {
  id: number;
  companyId: number;
  personalCustomerId: number;
  personalCustomerName: string;
  normalizedPhone: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
  canSign: boolean;
  receivesInvoice: boolean;
  receivesCollection: boolean;
  isActive: boolean;
  version: number;
};

export type VehicleOwner = { type: "person" | "company"; id: number; name?: string };

export type VehicleRecord = {
  id: number;
  vehicleNo: string;
  plateDisplay: string;
  normalizedPlate: string;
  vin: string | null;
  make: string;
  model: string;
  modelYear: number | null;
  color: string | null;
  currentOwner: VehicleOwner;
  hasOpenDispute: boolean;
  openDisputeId: number | null;
  isActive: boolean;
  version: number;
};

export type VehicleAttachmentRecord = {
  fileId: number;
  vehicleId: number;
  kind: "photo" | "document" | "dispute_evidence";
  caption: string | null;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  uploadedAt: Date;
};

export type VehicleAttachmentFileRecord = VehicleAttachmentRecord & {
  storageKey: string;
};

export type PageResult<Item> = {
  items: Item[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

type PersonalRow = {
  id: number;
  customer_no: string;
  full_name: string;
  normalized_phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  trn: string | null;
  is_active: boolean;
  version: number;
};

type CompanyRow = {
  id: number;
  company_no: string;
  legal_name: string;
  trn: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
  version: number;
};

type VehicleRow = {
  id: number;
  vehicle_no: string;
  plate_display: string;
  normalized_plate: string;
  vin: string | null;
  make: string;
  model: string;
  model_year: number | null;
  color: string | null;
  current_person_customer_id: number | null;
  current_company_account_id: number | null;
  owner_name?: string | null;
  has_open_dispute?: boolean;
  open_dispute_id?: number | null;
  is_active: boolean;
  version: number;
};

export class CustomerVehicleReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "customer_vehicle_read_denied";
  constructor() {
    super("当前账号不能查看客户和车辆档案");
    this.name = "CustomerVehicleReadDeniedError";
  }
}

export class CustomerVehicleWriteDeniedError extends Error {
  readonly status = 403;
  readonly code = "customer_vehicle_write_denied";
  constructor() {
    super("老板账号为全部只读，不能修改客户和车辆档案");
    this.name = "CustomerVehicleWriteDeniedError";
  }
}

export class CustomerVehicleNotFoundError extends Error {
  readonly status = 404;
  readonly code = "customer_vehicle_not_found";
  constructor(message = "客户、公司或车辆档案不存在") {
    super(message);
    this.name = "CustomerVehicleNotFoundError";
  }
}

export class CustomerVehicleConflictError extends Error {
  readonly status = 409;
  readonly code = "customer_vehicle_conflict";
  constructor(message = "手机号、TRN、公司名称、车牌或 VIN 已经存在") {
    super(message);
    this.name = "CustomerVehicleConflictError";
  }
}

export class CustomerVehicleService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async listPersonalCustomers(input: {
    viewerAccountId: number;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PageResult<PersonalCustomerRecord>> {
    await requireReader(this.database, input.viewerAccountId);
    const paging = normalizePaging(input.page, input.pageSize);
    const search = input.search?.normalize("NFKC").trim() || null;
    const like = search ? `%${search}%` : null;
    const counts = await this.database.query<{ total: number }>(
      `select count(*)::integer as total
       from personal_customers
       where ($1::text is null
          or full_name ilike $2
          or customer_no ilike $2
          or normalized_phone ilike $2
          or trn ilike $2)`,
      [search, like],
    );
    const page = effectivePage(paging.page, paging.pageSize, counts[0]?.total ?? 0);
    const rows = await this.database.query<PersonalRow>(
      `select id, customer_no, full_name, normalized_phone, whatsapp,
              email, address, trn, is_active, version
       from personal_customers
       where ($1::text is null
          or full_name ilike $2
          or customer_no ilike $2
          or normalized_phone ilike $2
          or trn ilike $2)
       order by created_at desc, id desc
       offset $3 limit $4`,
      [search, like, (page.page - 1) * paging.pageSize, paging.pageSize],
    );
    return { ...page, items: rows.map(mapPersonal) };
  }

  async listCompanyAccounts(input: {
    viewerAccountId: number;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PageResult<CompanyAccountRecord>> {
    await requireReader(this.database, input.viewerAccountId);
    const paging = normalizePaging(input.page, input.pageSize);
    const search = input.search?.normalize("NFKC").trim() || null;
    const like = search ? `%${search}%` : null;
    const counts = await this.database.query<{ total: number }>(
      `select count(*)::integer as total from company_accounts
       where ($1::text is null or legal_name ilike $2 or company_no ilike $2 or trn ilike $2)`,
      [search, like],
    );
    const page = effectivePage(paging.page, paging.pageSize, counts[0]?.total ?? 0);
    const rows = await this.database.query<CompanyRow>(
      `select id, company_no, legal_name, trn, phone, email, address, is_active, version
       from company_accounts
       where ($1::text is null or legal_name ilike $2 or company_no ilike $2 or trn ilike $2)
       order by created_at desc, id desc offset $3 limit $4`,
      [search, like, (page.page - 1) * paging.pageSize, paging.pageSize],
    );
    return { ...page, items: rows.map(mapCompany) };
  }

  async listCompanyContacts(input: {
    viewerAccountId: number;
    companyId: number;
  }): Promise<CompanyContactRecord[]> {
    await requireReader(this.database, input.viewerAccountId);
    return selectCompanyContacts(this.database, input.companyId);
  }

  async listVehicles(input: {
    viewerAccountId: number;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PageResult<VehicleRecord>> {
    await requireReader(this.database, input.viewerAccountId);
    const paging = normalizePaging(input.page, input.pageSize);
    const search = input.search?.normalize("NFKC").trim() || null;
    const like = search ? `%${search}%` : null;
    const normalized = search?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
    const counts = await this.database.query<{ total: number }>(
      `select count(*)::integer as total
       from vehicles as vehicle
       left join personal_customers as person on person.id = vehicle.current_person_customer_id
       left join company_accounts as company on company.id = vehicle.current_company_account_id
       where ($1::text is null
          or vehicle.normalized_plate ilike $2 or vehicle.plate_display ilike $3
          or vehicle.vin ilike $2 or vehicle.make ilike $3 or vehicle.model ilike $3
          or person.full_name ilike $3 or person.normalized_phone ilike $3
          or person.trn ilike $3 or company.legal_name ilike $3
          or company.trn ilike $3)`,
      [search, normalized ? `%${normalized}%` : null, like],
    );
    const page = effectivePage(paging.page, paging.pageSize, counts[0]?.total ?? 0);
    const rows = await this.database.query<VehicleRow>(
      `select vehicle.id, vehicle.vehicle_no, vehicle.plate_display,
              vehicle.normalized_plate, vehicle.vin, vehicle.make, vehicle.model,
              vehicle.model_year, vehicle.color, vehicle.current_person_customer_id,
              vehicle.current_company_account_id,
              coalesce(person.full_name, company.legal_name) as owner_name,
              (select dispute.id from vehicle_disputes as dispute
               where dispute.vehicle_id = vehicle.id and dispute.resolved_at is null
               order by dispute.opened_at desc, dispute.id desc limit 1) as open_dispute_id,
              vehicle.is_active, vehicle.version
       from vehicles as vehicle
       left join personal_customers as person on person.id = vehicle.current_person_customer_id
       left join company_accounts as company on company.id = vehicle.current_company_account_id
       where ($1::text is null
          or vehicle.normalized_plate ilike $2 or vehicle.plate_display ilike $3
          or vehicle.vin ilike $2 or vehicle.make ilike $3 or vehicle.model ilike $3
          or person.full_name ilike $3 or person.normalized_phone ilike $3
          or person.trn ilike $3 or company.legal_name ilike $3
          or company.trn ilike $3)
       order by vehicle.updated_at desc, vehicle.id desc offset $4 limit $5`,
      [search, normalized ? `%${normalized}%` : null, like, (page.page - 1) * paging.pageSize, paging.pageSize],
    );
    return { ...page, items: rows.map(mapVehicle) };
  }

  async listVehicleAttachments(input: {
    viewerAccountId: number;
    vehicleIds: number[];
  }): Promise<VehicleAttachmentRecord[]> {
    await requireReader(this.database, input.viewerAccountId);
    const vehicleIds = [...new Set(input.vehicleIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (vehicleIds.length === 0) return [];
    const rows = await this.database.query<{
      file_id: number; vehicle_id: number;
      kind: VehicleAttachmentRecord["kind"]; caption: string | null;
      original_name: string; media_type: string; size_bytes: number;
      uploaded_at: Date;
    }>(
      `select attachment.file_id, attachment.vehicle_id, attachment.kind,
              attachment.caption, file.original_name, file.media_type,
              file.size_bytes, file.uploaded_at
       from vehicle_attachments as attachment
       join stored_files as file on file.id = attachment.file_id
       where attachment.vehicle_id = any($1::bigint[])
       order by attachment.linked_at desc, attachment.file_id desc`,
      [vehicleIds],
    );
    return rows.map((row) => ({
      fileId: Number(row.file_id), vehicleId: Number(row.vehicle_id),
      kind: row.kind, caption: row.caption, originalName: row.original_name,
      mediaType: row.media_type, sizeBytes: Number(row.size_bytes),
      uploadedAt: new Date(row.uploaded_at),
    }));
  }

  async getVehicleAttachmentFile(input: {
    viewerAccountId: number;
    fileId: number;
  }): Promise<VehicleAttachmentFileRecord> {
    await requireReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<{
      file_id: number; vehicle_id: number;
      kind: VehicleAttachmentRecord["kind"]; caption: string | null;
      original_name: string; media_type: string; size_bytes: number;
      uploaded_at: Date; storage_key: string;
    }>(
      `select attachment.file_id, attachment.vehicle_id, attachment.kind,
              attachment.caption, file.original_name, file.media_type,
              file.size_bytes, file.uploaded_at, file.storage_key
       from vehicle_attachments as attachment
       join stored_files as file on file.id = attachment.file_id
       where attachment.file_id = $1
       limit 1`,
      [input.fileId],
    );
    if (!rows[0]) throw new CustomerVehicleNotFoundError("车辆附件不存在");
    const row = rows[0];
    return {
      fileId: Number(row.file_id), vehicleId: Number(row.vehicle_id),
      kind: row.kind, caption: row.caption, originalName: row.original_name,
      mediaType: row.media_type, sizeBytes: Number(row.size_bytes),
      uploadedAt: new Date(row.uploaded_at), storageKey: row.storage_key,
    };
  }

  async createPersonalCustomer(input: {
    fullName: string; phone?: string; whatsapp?: string; email?: string;
    address?: string; trn?: string; context: CustomerVehicleActionContext;
  }): Promise<PersonalCustomerRecord> {
    const fields = createPersonalCustomerSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        await transaction.query("lock table personal_customers in share row exclusive mode");
        const customerNo = await nextFormalNumber(transaction, "personal_customers", "customer_no", "CUST", now);
        const rows = await transaction.query<PersonalRow>(
          `insert into personal_customers
            (customer_no, full_name, normalized_phone, whatsapp, email, address,
             trn, created_at, updated_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
           returning id, customer_no, full_name, normalized_phone, whatsapp,
                     email, address, trn, is_active, version`,
          [customerNo, fields.fullName, fields.phone, fields.whatsapp, fields.email,
            fields.address, fields.trn, now, input.context.actorAccountId],
        );
        const customer = mapPersonal(rows[0]);
        await audit(transaction, input.context, now, {
          eventType: "customer.created", objectType: "personal_customer",
          objectId: String(customer.id), after: customer,
        });
        return customer;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async createCompanyAccount(input: {
    legalName: string; trn?: string; phone?: string; email?: string;
    address?: string; context: CustomerVehicleActionContext;
  }): Promise<CompanyAccountRecord> {
    const fields = createCompanyAccountSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        await transaction.query("lock table company_accounts in share row exclusive mode");
        const companyNo = await nextFormalNumber(transaction, "company_accounts", "company_no", "COMP", now);
        const rows = await transaction.query<CompanyRow>(
          `insert into company_accounts
            (company_no, legal_name, normalized_name, trn, phone, email, address,
             created_at, updated_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
           returning id, company_no, legal_name, trn, phone, email, address, is_active, version`,
          [companyNo, fields.legalName, normalizeName(fields.legalName), fields.trn,
            fields.phone, fields.email, fields.address, now, input.context.actorAccountId],
        );
        const company = mapCompany(rows[0]);
        await audit(transaction, input.context, now, {
          eventType: "company.created", objectType: "company_account",
          objectId: String(company.id), after: company,
        });
        return company;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async updatePersonalCustomer(input: {
    customerId: number; fullName: string; phone?: string; whatsapp?: string;
    email?: string; address?: string; trn?: string; isActive: boolean;
    version: number; context: CustomerVehicleActionContext;
  }): Promise<PersonalCustomerRecord> {
    const fields = updatePersonalCustomerSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        const existing = await transaction.query<PersonalRow>(
          `select id, customer_no, full_name, normalized_phone, whatsapp, email,
                  address, trn, is_active, version
           from personal_customers where id = $1 for update`,
          [input.customerId],
        );
        if (!existing[0]) throw new CustomerVehicleNotFoundError("个人客户不存在");
        const before = mapPersonal(existing[0]);
        const rows = await transaction.query<PersonalRow>(
          `update personal_customers set full_name = $2, normalized_phone = $3,
                  whatsapp = $4, email = $5, address = $6, trn = $7,
                  is_active = $8, updated_at = $9, version = version + 1
           where id = $1 and version = $10
           returning id, customer_no, full_name, normalized_phone, whatsapp,
                     email, address, trn, is_active, version`,
          [input.customerId, fields.fullName, fields.phone, fields.whatsapp,
            fields.email, fields.address, fields.trn, fields.isActive, now, fields.version],
        );
        if (!rows[0]) throw new CustomerVehicleConflictError("客户资料已被其他操作修改，请刷新后重试");
        const after = mapPersonal(rows[0]);
        await audit(transaction, input.context, now, {
          eventType: "customer.updated", objectType: "personal_customer",
          objectId: String(input.customerId), before, after,
        });
        return after;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async updateCompanyAccount(input: {
    companyId: number; legalName: string; trn?: string; phone?: string;
    email?: string; address?: string; isActive: boolean; version: number;
    context: CustomerVehicleActionContext;
  }): Promise<CompanyAccountRecord> {
    const fields = updateCompanyAccountSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        const existing = await transaction.query<CompanyRow>(
          `select id, company_no, legal_name, trn, phone, email, address, is_active, version
           from company_accounts where id = $1 for update`,
          [input.companyId],
        );
        if (!existing[0]) throw new CustomerVehicleNotFoundError("公司账户不存在");
        const before = mapCompany(existing[0]);
        const rows = await transaction.query<CompanyRow>(
          `update company_accounts set legal_name = $2, normalized_name = $3,
                  trn = $4, phone = $5, email = $6, address = $7,
                  is_active = $8, updated_at = $9, version = version + 1
           where id = $1 and version = $10
           returning id, company_no, legal_name, trn, phone, email, address, is_active, version`,
          [input.companyId, fields.legalName, normalizeName(fields.legalName),
            fields.trn, fields.phone, fields.email, fields.address, fields.isActive,
            now, fields.version],
        );
        if (!rows[0]) throw new CustomerVehicleConflictError("公司资料已被其他操作修改，请刷新后重试");
        const after = mapCompany(rows[0]);
        await audit(transaction, input.context, now, {
          eventType: "company.updated", objectType: "company_account",
          objectId: String(input.companyId), before, after,
        });
        return after;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async addCompanyContact(input: {
    companyId: number; personalCustomerId: number; jobTitle?: string;
    isPrimary: boolean; canSign: boolean; receivesInvoice: boolean;
    receivesCollection: boolean; context: CustomerVehicleActionContext;
  }): Promise<CompanyContactRecord> {
    const fields = companyContactSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        const company = await transaction.query<{ id: number }>(
          "select id from company_accounts where id = $1 and is_active = true for update",
          [fields.companyId],
        );
        const person = await transaction.query<{ id: number }>(
          "select id from personal_customers where id = $1 and is_active = true",
          [fields.personalCustomerId],
        );
        if (!company[0]) throw new CustomerVehicleNotFoundError("公司账户不存在或已停用");
        if (!person[0]) throw new CustomerVehicleNotFoundError("个人联系人不存在或已停用");
        if (fields.isPrimary) {
          await demoteOtherPrimaryContacts(
            transaction, fields.companyId, null, now, input.context,
          );
        }
        const rows = await transaction.query<{ id: number }>(
          `insert into company_contacts
            (company_id, personal_customer_id, job_title, is_primary, can_sign,
             receives_invoice, receives_collection, created_at, updated_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)
           returning id`,
          [fields.companyId, fields.personalCustomerId, fields.jobTitle, fields.isPrimary,
            fields.canSign, fields.receivesInvoice, fields.receivesCollection,
            now, input.context.actorAccountId],
        );
        await audit(transaction, input.context, now, {
          eventType: "company.contact_added", objectType: "company_contact",
          objectId: String(rows[0].id), after: fields,
        });
        const contacts = await selectCompanyContacts(transaction, fields.companyId);
        const result = contacts.find((contact) => contact.id === Number(rows[0].id));
        if (!result) throw new Error("公司联系人写入后无法读取");
        return result;
      });
    } catch (error) {
      rethrowConflict(error, "该联系人已经属于这个公司账户");
    }
  }

  async updateCompanyContact(input: {
    contactId: number; jobTitle?: string; isPrimary: boolean; canSign: boolean;
    receivesInvoice: boolean; receivesCollection: boolean; isActive: boolean;
    version: number; context: CustomerVehicleActionContext;
  }): Promise<CompanyContactRecord> {
    const fields = updateCompanyContactSchema.parse(input);
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireWriter(transaction, input.context.actorAccountId);
      const existing = await selectCompanyContactForUpdate(transaction, fields.contactId);
      if (!existing) throw new CustomerVehicleNotFoundError("公司联系人不存在");
      if (fields.isPrimary && fields.isActive) {
        await demoteOtherPrimaryContacts(
          transaction, existing.companyId, fields.contactId, now, input.context,
        );
      }
      const rows = await transaction.query<{ id: number }>(
        `update company_contacts set job_title = $2, is_primary = $3,
                can_sign = $4, receives_invoice = $5, receives_collection = $6,
                is_active = $7, updated_at = $8, version = version + 1
         where id = $1 and version = $9 returning id`,
        [fields.contactId, fields.jobTitle, fields.isActive && fields.isPrimary,
          fields.canSign, fields.receivesInvoice, fields.receivesCollection,
          fields.isActive, now, fields.version],
      );
      if (!rows[0]) throw new CustomerVehicleConflictError("联系人资料已被其他操作修改，请刷新后重试");
      const contacts = await selectCompanyContacts(transaction, existing.companyId);
      const after = contacts.find((contact) => contact.id === fields.contactId);
      if (!after) throw new Error("公司联系人更新后无法读取");
      await audit(transaction, input.context, now, {
        eventType: "company.contact_updated", objectType: "company_contact",
        objectId: String(fields.contactId), before: contactAuditState(existing),
        after: contactAuditState(after),
      });
      return after;
    });
  }

  async createVehicle(input: {
    plate: string; vin?: string; make: string; model: string;
    modelYear?: number | null; color?: string; ownerType: "person" | "company";
    ownerId: number; context: CustomerVehicleActionContext;
  }): Promise<VehicleRecord> {
    const fields = createVehicleSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        await requireOwnerExists(transaction, fields.ownerType, fields.ownerId);
        await transaction.query("lock table vehicles in share row exclusive mode");
        const vehicleNo = await nextFormalNumber(transaction, "vehicles", "vehicle_no", "VEH", now);
        const ownerColumns = ownerValues(fields.ownerType, fields.ownerId);
        const rows = await transaction.query<VehicleRow>(
          `insert into vehicles
            (vehicle_no, plate_display, normalized_plate, vin, make, model,
             model_year, color, current_person_customer_id,
             current_company_account_id, created_at, updated_at, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
           returning id, vehicle_no, plate_display, normalized_plate, vin, make,
                     model, model_year, color, current_person_customer_id,
                     current_company_account_id, is_active, version`,
          [vehicleNo, fields.plate.trim(), fields.normalizedPlate, fields.vin,
            fields.make, fields.model, fields.modelYear ?? null, fields.color,
            ownerColumns.personId, ownerColumns.companyId, now, input.context.actorAccountId],
        );
        const vehicle = mapVehicle(rows[0]);
        await transaction.query(
          `insert into vehicle_owner_history
            (vehicle_id, person_customer_id, company_account_id, started_at, changed_by)
           values ($1, $2, $3, $4, $5)`,
          [vehicle.id, ownerColumns.personId, ownerColumns.companyId, now, input.context.actorAccountId],
        );
        await audit(transaction, input.context, now, {
          eventType: "vehicle.created", objectType: "vehicle",
          objectId: String(vehicle.id), after: vehicle,
        });
        return vehicle;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async changeVehicleOwner(input: {
    vehicleId: number; ownerType: "person" | "company"; ownerId: number;
    reason: string; context: CustomerVehicleActionContext;
  }): Promise<VehicleRecord> {
    const fields = changeVehicleOwnerSchema.parse(input);
    const now = input.context.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await requireWriter(transaction, input.context.actorAccountId);
      await requireOwnerExists(transaction, fields.ownerType, fields.ownerId);
      const rows = await transaction.query<VehicleRow>(
        `select id, vehicle_no, plate_display, normalized_plate, vin, make, model,
                model_year, color, current_person_customer_id,
                current_company_account_id, is_active, version
         from vehicles where id = $1 and is_active = true for update`,
        [input.vehicleId],
      );
      if (!rows[0]) throw new CustomerVehicleNotFoundError("车辆档案不存在或已停用");
      const before = mapVehicle(rows[0]);
      if (before.currentOwner.type === fields.ownerType && before.currentOwner.id === fields.ownerId) {
        throw new CustomerVehicleConflictError("车辆当前已经属于这个客户或公司");
      }
      const ownerColumns = ownerValues(fields.ownerType, fields.ownerId);
      const closed = await transaction.query<{ id: number }>(
        `update vehicle_owner_history set ended_at = $2
         where vehicle_id = $1 and ended_at is null returning id`,
        [input.vehicleId, now],
      );
      if (closed.length !== 1) throw new CustomerVehicleConflictError("车辆当前归属历史异常");
      await transaction.query(
        `insert into vehicle_owner_history
          (vehicle_id, person_customer_id, company_account_id, started_at, reason, changed_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [input.vehicleId, ownerColumns.personId, ownerColumns.companyId,
          now, fields.reason, input.context.actorAccountId],
      );
      const updated = await transaction.query<VehicleRow>(
        `update vehicles set current_person_customer_id = $2,
              current_company_account_id = $3, updated_at = $4, version = version + 1
         where id = $1
         returning id, vehicle_no, plate_display, normalized_plate, vin, make,
                   model, model_year, color, current_person_customer_id,
                   current_company_account_id, is_active, version`,
        [input.vehicleId, ownerColumns.personId, ownerColumns.companyId, now],
      );
      const after = mapVehicle(updated[0]);
      await audit(transaction, input.context, now, {
        eventType: "vehicle.owner_changed", objectType: "vehicle",
        objectId: String(input.vehicleId), reason: fields.reason,
        before: before.currentOwner, after: after.currentOwner,
      });
      return after;
    });
  }

  async updateVehicle(input: {
    vehicleId: number; plate: string; vin?: string; make: string; model: string;
    modelYear?: number | null; color?: string; isActive: boolean; version: number;
    context: CustomerVehicleActionContext;
  }): Promise<VehicleRecord> {
    const fields = updateVehicleSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        const existing = await transaction.query<VehicleRow>(
          `select id, vehicle_no, plate_display, normalized_plate, vin, make,
                  model, model_year, color, current_person_customer_id,
                  current_company_account_id, is_active, version
           from vehicles where id = $1 for update`,
          [input.vehicleId],
        );
        if (!existing[0]) throw new CustomerVehicleNotFoundError("车辆档案不存在");
        const before = mapVehicle(existing[0]);
        const rows = await transaction.query<VehicleRow>(
          `update vehicles set plate_display = $2, normalized_plate = $3, vin = $4,
                  make = $5, model = $6, model_year = $7, color = $8,
                  is_active = $9, updated_at = $10, version = version + 1
           where id = $1 and version = $11
           returning id, vehicle_no, plate_display, normalized_plate, vin, make,
                     model, model_year, color, current_person_customer_id,
                     current_company_account_id, is_active, version`,
          [input.vehicleId, fields.plate.trim(), fields.normalizedPlate, fields.vin,
            fields.make, fields.model, fields.modelYear ?? null, fields.color,
            fields.isActive, now, fields.version],
        );
        if (!rows[0]) throw new CustomerVehicleConflictError("车辆资料已被其他操作修改，请刷新后重试");
        const after = mapVehicle(rows[0]);
        await audit(transaction, input.context, now, {
          eventType: "vehicle.updated", objectType: "vehicle",
          objectId: String(input.vehicleId), before, after,
        });
        return after;
      });
    } catch (error) {
      rethrowConflict(error);
    }
  }

  async openVehicleDispute(input: {
    vehicleId: number; note: string; context: CustomerVehicleActionContext;
  }): Promise<{ id: number; vehicleId: number; openedAt: Date; note: string }> {
    const note = disputeNoteSchema.parse(input.note);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        const vehicle = await transaction.query<{ id: number }>(
          "select id from vehicles where id = $1 and is_active = true for update",
          [input.vehicleId],
        );
        if (!vehicle[0]) throw new CustomerVehicleNotFoundError("车辆档案不存在或已停用");
        const rows = await transaction.query<{ id: number; vehicle_id: number; opened_at: Date; opened_note: string }>(
          `insert into vehicle_disputes (vehicle_id, opened_at, opened_note, opened_by)
           values ($1, $2, $3, $4) returning id, vehicle_id, opened_at, opened_note`,
          [input.vehicleId, now, note, input.context.actorAccountId],
        );
        const dispute = { id: Number(rows[0].id), vehicleId: Number(rows[0].vehicle_id), openedAt: new Date(rows[0].opened_at), note: rows[0].opened_note };
        await audit(transaction, input.context, now, {
          eventType: "vehicle.dispute_opened", objectType: "vehicle_dispute",
          objectId: String(dispute.id), reason: note,
          after: { vehicleId: dispute.vehicleId, openedAt: dispute.openedAt },
        });
        return dispute;
      });
    } catch (error) {
      rethrowConflict(error, "这辆车已经有一个尚未解决的客户争议");
    }
  }

  async resolveVehicleDispute(input: {
    disputeId: number; note: string; context: CustomerVehicleActionContext;
  }): Promise<void> {
    const note = disputeNoteSchema.parse(input.note);
    const now = input.context.now ?? new Date();
    await this.database.transaction(async (transaction) => {
      await requireWriter(transaction, input.context.actorAccountId);
      const rows = await transaction.query<{ id: number; vehicle_id: number }>(
        `select id, vehicle_id from vehicle_disputes
         where id = $1 and resolved_at is null for update`,
        [input.disputeId],
      );
      if (!rows[0]) throw new CustomerVehicleNotFoundError("未解决的车辆争议不存在");
      await transaction.query(
        `update vehicle_disputes set resolved_at = $2, resolved_note = $3, resolved_by = $4
         where id = $1`,
        [input.disputeId, now, note, input.context.actorAccountId],
      );
      await audit(transaction, input.context, now, {
        eventType: "vehicle.dispute_resolved", objectType: "vehicle_dispute",
        objectId: String(input.disputeId), reason: note,
        after: { vehicleId: Number(rows[0].vehicle_id), resolvedAt: now },
      });
    });
  }

  async registerVehicleAttachment(input: {
    vehicleId: number; storageKey: string; originalName: string; mediaType: string;
    sizeBytes: number; sha256Hex: string;
    kind: "photo" | "document" | "dispute_evidence"; caption?: string;
    context: CustomerVehicleActionContext;
  }): Promise<{ fileId: number; vehicleId: number; kind: string; originalName: string }> {
    const fields = registerVehicleAttachmentSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireWriter(transaction, input.context.actorAccountId);
        const vehicle = await transaction.query<{ id: number }>("select id from vehicles where id = $1", [fields.vehicleId]);
        if (!vehicle[0]) throw new CustomerVehicleNotFoundError("车辆档案不存在");
        const files = await transaction.query<{ id: number }>(
          `insert into stored_files
            (storage_key, original_name, media_type, size_bytes, sha256_hex, uploaded_by, uploaded_at)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [fields.storageKey, fields.originalName, fields.mediaType, fields.sizeBytes,
            fields.sha256Hex, input.context.actorAccountId, now],
        );
        const fileId = Number(files[0].id);
        await transaction.query(
          `insert into vehicle_attachments
            (vehicle_id, file_id, kind, caption, linked_by, linked_at)
           values ($1, $2, $3::vehicle_attachment_kind, $4, $5, $6)`,
          [fields.vehicleId, fileId, fields.kind, fields.caption,
            input.context.actorAccountId, now],
        );
        const after = { fileId, vehicleId: fields.vehicleId, kind: fields.kind, originalName: fields.originalName };
        await audit(transaction, input.context, now, {
          eventType: "vehicle.attachment_linked", objectType: "vehicle",
          objectId: String(fields.vehicleId), after,
        });
        return after;
      });
    } catch (error) {
      rethrowConflict(error, "这份附件已经登记");
    }
  }
}

async function requireReader(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ role: string }>(
    `select role from staff_accounts where id = $1 and is_active = true
     and role in ('super_admin', 'front_desk', 'owner') limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new CustomerVehicleReadDeniedError();
}

async function requireWriter(executor: AuthSqlExecutor, accountId: number) {
  const rows = await executor.query<{ role: string }>(
    `select role from staff_accounts where id = $1 and is_active = true
     and role in ('super_admin', 'front_desk') limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new CustomerVehicleWriteDeniedError();
}

async function requireOwnerExists(executor: AuthSqlExecutor, type: "person" | "company", id: number) {
  const table = type === "person" ? "personal_customers" : "company_accounts";
  const rows = await executor.query<{ id: number }>(`select id from ${table} where id = $1 and is_active = true`, [id]);
  if (!rows[0]) throw new CustomerVehicleNotFoundError(type === "person" ? "个人客户不存在或已停用" : "公司账户不存在或已停用");
}

function ownerValues(type: "person" | "company", id: number) {
  return type === "person" ? { personId: id, companyId: null } : { personId: null, companyId: id };
}

async function nextFormalNumber(
  executor: AuthSqlExecutor,
  table: "personal_customers" | "company_accounts" | "vehicles",
  column: "customer_no" | "company_no" | "vehicle_no",
  prefix: "CUST" | "COMP" | "VEH",
  now: Date,
) {
  const month = toBusinessMonthKey(now).replace("-", "");
  const numberPrefix = `${prefix}-${month}-`;
  const rows = await executor.query<{ current_number: number }>(
    `select coalesce(max(right(${column}, 4)::integer), 0)::integer as current_number
     from ${table} where ${column} like $1`,
    [`${numberPrefix}%`],
  );
  const next = Number(rows[0]?.current_number ?? 0) + 1;
  if (next > 9_999) throw new CustomerVehicleConflictError("本月正式编号已经用尽");
  return `${numberPrefix}${String(next).padStart(4, "0")}`;
}

function normalizeName(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizePaging(page = 1, pageSize = 20) {
  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20,
  };
}

function effectivePage(requested: number, pageSize: number, rawTotal: number) {
  const total = Number(rawTotal);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(requested, pageCount), pageSize, pageCount, total };
}

function mapPersonal(row: PersonalRow | undefined): PersonalCustomerRecord {
  if (!row) throw new Error("个人客户写入后无法读取");
  return {
    id: Number(row.id), customerNo: row.customer_no, fullName: row.full_name,
    normalizedPhone: row.normalized_phone, whatsapp: row.whatsapp, email: row.email,
    address: row.address, trn: row.trn, isActive: row.is_active, version: row.version,
  };
}

function mapCompany(row: CompanyRow | undefined): CompanyAccountRecord {
  if (!row) throw new Error("公司账户写入后无法读取");
  return {
    id: Number(row.id), companyNo: row.company_no, legalName: row.legal_name,
    trn: row.trn, phone: row.phone, email: row.email, address: row.address,
    isActive: row.is_active, version: row.version,
  };
}

function mapVehicle(row: VehicleRow | undefined): VehicleRecord {
  if (!row) throw new Error("车辆写入后无法读取");
  const isPerson = row.current_person_customer_id != null;
  return {
    id: Number(row.id), vehicleNo: row.vehicle_no, plateDisplay: row.plate_display,
    normalizedPlate: row.normalized_plate, vin: row.vin, make: row.make, model: row.model,
    modelYear: row.model_year, color: row.color,
    currentOwner: {
      type: isPerson ? "person" : "company",
      id: Number(isPerson ? row.current_person_customer_id : row.current_company_account_id),
      ...(row.owner_name ? { name: row.owner_name } : {}),
    },
    hasOpenDispute: row.open_dispute_id != null || row.has_open_dispute === true,
    openDisputeId: row.open_dispute_id == null ? null : Number(row.open_dispute_id),
    isActive: row.is_active, version: row.version,
  };
}

async function selectCompanyContacts(
  executor: AuthSqlExecutor,
  companyId: number,
): Promise<CompanyContactRecord[]> {
  const rows = await executor.query<{
    id: number; company_id: number; personal_customer_id: number;
    personal_customer_name: string; normalized_phone: string | null;
    job_title: string | null; is_primary: boolean; can_sign: boolean;
    receives_invoice: boolean; receives_collection: boolean;
    is_active: boolean; version: number;
  }>(
    `select contact.id, contact.company_id, contact.personal_customer_id,
            person.full_name as personal_customer_name, person.normalized_phone,
            contact.job_title, contact.is_primary, contact.can_sign,
            contact.receives_invoice, contact.receives_collection,
            contact.is_active, contact.version
     from company_contacts as contact
     join personal_customers as person on person.id = contact.personal_customer_id
     where contact.company_id = $1
     order by contact.is_active desc, contact.is_primary desc, person.full_name, contact.id`,
    [companyId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    companyId: Number(row.company_id),
    personalCustomerId: Number(row.personal_customer_id),
    personalCustomerName: row.personal_customer_name,
    normalizedPhone: row.normalized_phone,
    jobTitle: row.job_title,
    isPrimary: row.is_primary,
    canSign: row.can_sign,
    receivesInvoice: row.receives_invoice,
    receivesCollection: row.receives_collection,
    isActive: row.is_active,
    version: row.version,
  }));
}

async function selectCompanyContactForUpdate(
  executor: AuthSqlExecutor,
  contactId: number,
): Promise<CompanyContactRecord | null> {
  const rows = await executor.query<{
    id: number; company_id: number; personal_customer_id: number;
    personal_customer_name: string; normalized_phone: string | null;
    job_title: string | null; is_primary: boolean; can_sign: boolean;
    receives_invoice: boolean; receives_collection: boolean;
    is_active: boolean; version: number;
  }>(
    `select contact.id, contact.company_id, contact.personal_customer_id,
            person.full_name as personal_customer_name, person.normalized_phone,
            contact.job_title, contact.is_primary, contact.can_sign,
            contact.receives_invoice, contact.receives_collection,
            contact.is_active, contact.version
     from company_contacts as contact
     join personal_customers as person on person.id = contact.personal_customer_id
     where contact.id = $1
     for update of contact`,
    [contactId],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: Number(row.id), companyId: Number(row.company_id),
    personalCustomerId: Number(row.personal_customer_id),
    personalCustomerName: row.personal_customer_name,
    normalizedPhone: row.normalized_phone, jobTitle: row.job_title,
    isPrimary: row.is_primary, canSign: row.can_sign,
    receivesInvoice: row.receives_invoice,
    receivesCollection: row.receives_collection,
    isActive: row.is_active, version: row.version,
  };
}

async function demoteOtherPrimaryContacts(
  executor: AuthSqlExecutor,
  companyId: number,
  exceptContactId: number | null,
  now: Date,
  context: CustomerVehicleActionContext,
) {
  const existing = await executor.query<{ id: number }>(
    `select id from company_contacts
     where company_id = $1 and is_primary = true and is_active = true
       and ($2::bigint is null or id <> $2)
     order by id for update`,
    [companyId, exceptContactId],
  );
  for (const row of existing) {
    const before = await selectCompanyContactForUpdate(executor, Number(row.id));
    if (!before) continue;
    await executor.query(
      `update company_contacts set is_primary = false, updated_at = $2,
              version = version + 1 where id = $1`,
      [before.id, now],
    );
    await audit(executor, context, now, {
      eventType: "company.contact_updated", objectType: "company_contact",
      objectId: String(before.id), before: contactAuditState(before),
      after: contactAuditState({ ...before, isPrimary: false, version: before.version + 1 }),
    });
  }
}

function contactAuditState(contact: CompanyContactRecord): Record<string, unknown> {
  return {
    companyId: contact.companyId,
    personalCustomerId: contact.personalCustomerId,
    jobTitle: contact.jobTitle,
    isPrimary: contact.isPrimary,
    canSign: contact.canSign,
    receivesInvoice: contact.receivesInvoice,
    receivesCollection: contact.receivesCollection,
    isActive: contact.isActive,
    version: contact.version,
  };
}

async function audit(
  executor: AuthSqlExecutor,
  context: CustomerVehicleActionContext,
  now: Date,
  event: { eventType: string; objectType: string; objectId: string; reason?: string;
    before?: Record<string, unknown>; after?: Record<string, unknown> },
) {
  await writeAuditEvent(executor, {
    occurredAt: now, actorAccountId: context.actorAccountId,
    eventType: event.eventType, objectType: event.objectType, objectId: event.objectId,
    reason: event.reason, before: event.before, after: event.after,
    requestId: context.requestId, ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });
}

function rethrowConflict(error: unknown, message?: string): never {
  if (error instanceof CustomerVehicleConflictError ||
      error instanceof CustomerVehicleNotFoundError ||
      error instanceof CustomerVehicleWriteDeniedError ||
      error instanceof CustomerVehicleReadDeniedError) throw error;
  if (typeof error === "object" && error !== null && "code" in error &&
      (error.code === "23505" || error.code === "23514")) {
    throw new CustomerVehicleConflictError(message);
  }
  throw error;
}
