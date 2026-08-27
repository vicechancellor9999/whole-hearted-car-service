import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import {
  customerDriverLicenseSubjectSchema,
  customerDriverLicenseWriteSchema,
  type CustomerDriverLicenseProfile,
  type LicenseSubject,
} from "@formal/modules/customer-vehicle/customer-driver-license-schemas";
import type { StoredCustomerDriverLicenseUpload } from "@formal/modules/customer-vehicle/customer-driver-license-storage";

export type CustomerDriverLicenseActionContext = {
  actorAccountId: number;
  requestId: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type CustomerDriverLicenseRecord = {
  id: number;
  subject: LicenseSubject;
  fileId: number;
  profile: CustomerDriverLicenseProfile;
  status: "pending_verification" | "verified" | "needs_reverification";
  verifiedBy: number | null;
  verifiedAt: Date | null;
  supersededBy: number | null;
  supersededAt: Date | null;
  createdBy: number;
  createdAt: Date;
  version: number;
};

export type CustomerDriverLicenseFileRecord = {
  recordId: number;
  storageKey: string;
  originalName: string;
  mediaType: "image/jpeg" | "image/png";
  sizeBytes: number;
  sha256Hex: string;
};

type LicenseRow = {
  id: number;
  subject_type: LicenseSubject["type"];
  personal_customer_id: number | null;
  company_account_id: number | null;
  company_contact_id: number | null;
  file_id: number;
  document_name: string;
  birth_date: string;
  sex: "M" | "F";
  document_address: string;
  status: CustomerDriverLicenseRecord["status"];
  verified_by: number | null;
  verified_at: Date | null;
  superseded_by: number | null;
  superseded_at: Date | null;
  created_by: number;
  created_at: Date;
  version: number;
};

export class CustomerDriverLicenseReadDeniedError extends Error {
  readonly status = 403;
  readonly code = "customer_driver_license_read_denied";
  constructor() {
    super("当前账号没有客户证件读取权限");
    this.name = "CustomerDriverLicenseReadDeniedError";
  }
}

export class CustomerDriverLicenseWriteDeniedError extends Error {
  readonly status = 403;
  readonly code = "customer_driver_license_write_denied";
  constructor() {
    super("当前账号没有客户证件写入权限");
    this.name = "CustomerDriverLicenseWriteDeniedError";
  }
}

export class CustomerDriverLicenseNotFoundError extends Error {
  readonly status = 404;
  readonly code = "customer_driver_license_not_found";
  constructor(message = "客户驾驶证记录不存在") {
    super(message);
    this.name = "CustomerDriverLicenseNotFoundError";
  }
}

export class CustomerDriverLicenseConflictError extends Error {
  readonly status = 409;
  readonly code = "customer_driver_license_conflict";
  constructor(message = "当前客户已经有驾驶证记录，请使用替换操作") {
    super(message);
    this.name = "CustomerDriverLicenseConflictError";
  }
}

type WriteInput = {
  subject: LicenseSubject;
  file: StoredCustomerDriverLicenseUpload;
  profile: CustomerDriverLicenseProfile;
  verified: boolean;
  context: CustomerDriverLicenseActionContext;
};

export class CustomerDriverLicenseService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async record(input: WriteInput): Promise<CustomerDriverLicenseRecord> {
    const fields = customerDriverLicenseWriteSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireLicenseWriter(transaction, input.context.actorAccountId);
        await requireSubject(transaction, fields.subject);
        const fileId = await insertStoredFile(transaction, fields.file, input.context.actorAccountId, now);
        await applyLicenseProfile(transaction, fields.subject, fields.profile, now);
        const record = await insertLicenseRecord(
          transaction,
          { ...fields, context: input.context },
          fileId,
          now,
        );
        await auditLicense(transaction, input.context, now, {
          eventType: fields.verified
            ? "customer.driver_license_verified"
            : "customer.driver_license_recorded",
          record,
        });
        return record;
      });
    } catch (error) {
      rethrowLicenseConflict(error);
    }
  }

  async replace(input: WriteInput): Promise<CustomerDriverLicenseRecord> {
    const fields = customerDriverLicenseWriteSchema.parse(input);
    const now = input.context.now ?? new Date();
    try {
      return await this.database.transaction(async (transaction) => {
        await requireLicenseWriter(transaction, input.context.actorAccountId);
        await requireSubject(transaction, fields.subject);
        const current = await selectCurrentRecord(transaction, fields.subject, true);
        if (!current) throw new CustomerDriverLicenseNotFoundError("当前驾驶证记录不存在");
        await transaction.query(
          `update customer_driver_license_records
           set superseded_at = $2, superseded_by = $3
           where id = $1`,
          [current.id, now, input.context.actorAccountId],
        );
        await auditLicense(transaction, input.context, now, {
          eventType: "customer.driver_license_superseded",
          record: { ...current, supersededAt: now, supersededBy: input.context.actorAccountId },
        });

        const fileId = await insertStoredFile(transaction, fields.file, input.context.actorAccountId, now);
        await applyLicenseProfile(transaction, fields.subject, fields.profile, now);
        const replacement = await insertLicenseRecord(
          transaction,
          { ...fields, context: input.context },
          fileId,
          now,
        );
        await auditLicense(transaction, input.context, now, {
          eventType: fields.verified
            ? "customer.driver_license_verified"
            : "customer.driver_license_recorded",
          record: replacement,
        });
        return replacement;
      });
    } catch (error) {
      rethrowLicenseConflict(error);
    }
  }

  async history(input: {
    viewerAccountId: number;
    subject: LicenseSubject;
  }): Promise<CustomerDriverLicenseRecord[]> {
    const subject = customerDriverLicenseSubjectSchema.parse(input.subject);
    await requireLicenseReader(this.database, input.viewerAccountId);
    await requireSubject(this.database, subject);
    const rows = await this.database.query<LicenseRow>(
      `${licenseSelect}
       where (
         $1::customer_license_subject_type = 'individual_customer'
         and record.subject_type = 'individual_customer'
         and record.personal_customer_id = $2
       ) or (
         $1::customer_license_subject_type = 'organization_primary_contact'
         and record.subject_type = 'organization_primary_contact'
         and record.company_account_id = $3
       )
       order by record.created_at desc, record.id desc`,
      [
        subject.type,
        subject.type === "individual_customer" ? subject.personalCustomerId : null,
        subject.type === "organization_primary_contact" ? subject.companyAccountId : null,
      ],
    );
    return rows.map(mapLicenseRecord);
  }

  async getFile(input: {
    viewerAccountId: number;
    recordId: number;
  }): Promise<CustomerDriverLicenseFileRecord> {
    await requireLicenseReader(this.database, input.viewerAccountId);
    const rows = await this.database.query<{
      record_id: number;
      storage_key: string;
      original_name: string;
      media_type: "image/jpeg" | "image/png";
      size_bytes: number;
      sha256_hex: string;
    }>(
      `select record.id as record_id, file.storage_key, file.original_name,
              file.media_type, file.size_bytes, file.sha256_hex
       from customer_driver_license_records as record
       join stored_files as file on file.id = record.file_id
       where record.id = $1
       limit 1`,
      [input.recordId],
    );
    if (!rows[0]) throw new CustomerDriverLicenseNotFoundError();
    return {
      recordId: Number(rows[0].record_id),
      storageKey: rows[0].storage_key,
      originalName: rows[0].original_name,
      mediaType: rows[0].media_type,
      sizeBytes: Number(rows[0].size_bytes),
      sha256Hex: rows[0].sha256_hex,
    };
  }
}

export async function markPersonalDriverLicenseNeedsReverification(
  executor: AuthSqlExecutor,
  input: {
    personalCustomerId: number;
    newFormalName: string;
    context: CustomerDriverLicenseActionContext;
    now: Date;
  },
): Promise<void> {
  const rows = await executor.query<{ id: number; status: CustomerDriverLicenseRecord["status"] }>(
    `select id, status
     from customer_driver_license_records
     where subject_type = 'individual_customer'
       and personal_customer_id = $1
       and superseded_at is null
       and document_name is distinct from $2
       and status <> 'needs_reverification'
     for update`,
    [input.personalCustomerId, input.newFormalName],
  );
  if (!rows[0]) return;
  await executor.query(
    `update customer_driver_license_records
     set status = 'needs_reverification', verified_by = null, verified_at = null,
         version = version + 1
     where id = $1`,
    [rows[0].id],
  );
  await writeAuditEvent(executor, {
    occurredAt: input.now,
    actorAccountId: input.context.actorAccountId,
    eventType: "customer.driver_license_reverification_required",
    objectType: "customer_driver_license_record",
    objectId: String(rows[0].id),
    before: { status: rows[0].status },
    after: { status: "needs_reverification", subjectType: "individual_customer",
      personalCustomerId: input.personalCustomerId },
    requestId: input.context.requestId,
    ipAddress: input.context.ipAddress ?? null,
    userAgent: input.context.userAgent ?? null,
  });
}

const licenseSelect = `select record.id, record.subject_type,
  record.personal_customer_id, record.company_account_id, record.company_contact_id,
  record.file_id, record.document_name, record.birth_date::text, record.sex,
  record.document_address, record.status, record.verified_by, record.verified_at,
  record.superseded_by, record.superseded_at, record.created_by, record.created_at,
  record.version
  from customer_driver_license_records as record`;

async function requireLicenseReader(executor: AuthSqlExecutor, accountId: number): Promise<void> {
  const rows = await executor.query<{ role: string }>(
    `select role from staff_accounts where id = $1 and is_active = true
     and role in ('super_admin', 'front_desk', 'owner') limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new CustomerDriverLicenseReadDeniedError();
}

async function requireLicenseWriter(executor: AuthSqlExecutor, accountId: number): Promise<void> {
  const rows = await executor.query<{ role: string }>(
    `select role from staff_accounts where id = $1 and is_active = true
     and role in ('super_admin', 'front_desk') limit 1`,
    [accountId],
  );
  if (!rows[0]) throw new CustomerDriverLicenseWriteDeniedError();
}

async function requireSubject(executor: AuthSqlExecutor, subject: LicenseSubject): Promise<void> {
  if (subject.type === "individual_customer") {
    const rows = await executor.query<{ id: number }>(
      "select id from personal_customers where id = $1 and is_active = true limit 1",
      [subject.personalCustomerId],
    );
    if (!rows[0]) throw new CustomerDriverLicenseNotFoundError("个人客户不存在或已停用");
    return;
  }
  const company = await executor.query<{ id: number }>(
    "select id from company_accounts where id = $1 and is_active = true limit 1",
    [subject.companyAccountId],
  );
  if (!company[0]) throw new CustomerDriverLicenseNotFoundError("公司客户不存在或已停用");
  if (!subject.companyContactId || !subject.personalCustomerId) {
    throw new CustomerDriverLicenseNotFoundError("公司主要联系人尚未建立正式关系");
  }
  const contact = await executor.query<{ id: number }>(
    `select id from company_contacts
     where id = $1 and company_id = $2 and personal_customer_id = $3
       and is_primary = true and is_active = true
     limit 1`,
    [subject.companyContactId, subject.companyAccountId, subject.personalCustomerId],
  );
  if (!contact[0]) throw new CustomerDriverLicenseNotFoundError("公司主要联系人关系不匹配");
}

async function selectCurrentRecord(
  executor: AuthSqlExecutor,
  subject: LicenseSubject,
  forUpdate = false,
): Promise<CustomerDriverLicenseRecord | null> {
  const rows = await executor.query<LicenseRow>(
    `${licenseSelect}
     where record.superseded_at is null and (
       ($1::customer_license_subject_type = 'individual_customer'
        and record.subject_type = 'individual_customer' and record.personal_customer_id = $2)
       or
       ($1::customer_license_subject_type = 'organization_primary_contact'
        and record.subject_type = 'organization_primary_contact' and record.company_account_id = $3)
     )
     limit 1${forUpdate ? " for update" : ""}`,
    [
      subject.type,
      subject.type === "individual_customer" ? subject.personalCustomerId : null,
      subject.type === "organization_primary_contact" ? subject.companyAccountId : null,
    ],
  );
  return rows[0] ? mapLicenseRecord(rows[0]) : null;
}

async function insertStoredFile(
  executor: AuthSqlExecutor,
  file: StoredCustomerDriverLicenseUpload,
  actorAccountId: number,
  now: Date,
): Promise<number> {
  const rows = await executor.query<{ id: number }>(
    `insert into stored_files
      (storage_key, original_name, media_type, size_bytes, sha256_hex, uploaded_by, uploaded_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [file.storageKey, file.originalName, file.mediaType, file.sizeBytes,
      file.sha256Hex, actorAccountId, now],
  );
  return Number(rows[0].id);
}

async function applyLicenseProfile(
  executor: AuthSqlExecutor,
  subject: LicenseSubject,
  profile: CustomerDriverLicenseProfile,
  now: Date,
): Promise<void> {
  const personalCustomerId = subject.type === "individual_customer"
    ? subject.personalCustomerId
    : subject.personalCustomerId;
  if (!personalCustomerId) return;
  await executor.query(
    `update personal_customers
     set full_name = $2, birth_date = $3::date, gender = $4, address = $5,
         updated_at = $6, version = version + 1
     where id = $1`,
    [personalCustomerId, profile.name, profile.birthDate, profile.sex, profile.address, now],
  );
}

async function insertLicenseRecord(
  executor: AuthSqlExecutor,
  input: WriteInput,
  fileId: number,
  now: Date,
): Promise<CustomerDriverLicenseRecord> {
  const status = input.verified ? "verified" : "pending_verification";
  const rows = await executor.query<LicenseRow>(
    `insert into customer_driver_license_records
      (subject_type, personal_customer_id, company_account_id, company_contact_id,
       file_id, document_name, birth_date, sex, document_address, status,
       verified_by, verified_at, created_by, created_at)
     values ($1::customer_license_subject_type, $2, $3, $4, $5, $6, $7::date,
             $8, $9, $10::customer_license_status, $11, $12, $13, $14)
     returning id, subject_type, personal_customer_id, company_account_id,
               company_contact_id, file_id, document_name, birth_date::text,
               sex, document_address, status, verified_by, verified_at,
               superseded_by, superseded_at, created_by, created_at, version`,
    [
      input.subject.type,
      input.subject.type === "individual_customer"
        ? input.subject.personalCustomerId
        : input.subject.personalCustomerId,
      input.subject.type === "organization_primary_contact" ? input.subject.companyAccountId : null,
      input.subject.type === "organization_primary_contact" ? input.subject.companyContactId : null,
      fileId,
      input.profile.name,
      input.profile.birthDate,
      input.profile.sex,
      input.profile.address,
      status,
      input.verified ? input.context.actorAccountId : null,
      input.verified ? now : null,
      input.context.actorAccountId,
      now,
    ],
  );
  return mapLicenseRecord(rows[0]);
}

async function auditLicense(
  executor: AuthSqlExecutor,
  context: CustomerDriverLicenseActionContext,
  now: Date,
  input: { eventType: string; record: CustomerDriverLicenseRecord },
): Promise<void> {
  await writeAuditEvent(executor, {
    occurredAt: now,
    actorAccountId: context.actorAccountId,
    eventType: input.eventType,
    objectType: "customer_driver_license_record",
    objectId: String(input.record.id),
    after: {
      recordId: input.record.id,
      subjectType: input.record.subject.type,
      personalCustomerId: input.record.subject.personalCustomerId,
      companyAccountId: input.record.subject.type === "organization_primary_contact"
        ? input.record.subject.companyAccountId
        : null,
      status: input.record.status,
      supersededAt: input.record.supersededAt,
    },
    requestId: context.requestId,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });
}

function mapLicenseRecord(row: LicenseRow): CustomerDriverLicenseRecord {
  const subject: LicenseSubject = row.subject_type === "individual_customer"
    ? { type: "individual_customer", personalCustomerId: Number(row.personal_customer_id) }
    : {
        type: "organization_primary_contact",
        companyAccountId: Number(row.company_account_id),
        companyContactId: row.company_contact_id === null ? null : Number(row.company_contact_id),
        personalCustomerId: row.personal_customer_id === null ? null : Number(row.personal_customer_id),
      };
  return {
    id: Number(row.id),
    subject,
    fileId: Number(row.file_id),
    profile: {
      name: row.document_name,
      birthDate: row.birth_date,
      sex: row.sex,
      address: row.document_address,
    },
    status: row.status,
    verifiedBy: row.verified_by === null ? null : Number(row.verified_by),
    verifiedAt: row.verified_at === null ? null : new Date(row.verified_at),
    supersededBy: row.superseded_by === null ? null : Number(row.superseded_by),
    supersededAt: row.superseded_at === null ? null : new Date(row.superseded_at),
    createdBy: Number(row.created_by),
    createdAt: new Date(row.created_at),
    version: row.version,
  };
}

function rethrowLicenseConflict(error: unknown): never {
  if (error instanceof CustomerDriverLicenseReadDeniedError ||
      error instanceof CustomerDriverLicenseWriteDeniedError ||
      error instanceof CustomerDriverLicenseNotFoundError ||
      error instanceof CustomerDriverLicenseConflictError) {
    throw error;
  }
  if (typeof error === "object" && error !== null && "code" in error &&
      (error.code === "23505" || error.code === "23514" || error.code === "23503")) {
    throw new CustomerDriverLicenseConflictError();
  }
  throw error;
}
