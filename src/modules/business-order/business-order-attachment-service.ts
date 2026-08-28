import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";
import type { StoredBusinessOrderUpload } from "@formal/modules/business-order/business-order-attachment-storage";

export const BUSINESS_ORDER_ATTACHMENT_CATEGORIES = [
  "customer_signature",
  "service_photo",
  "financial_evidence",
  "other",
] as const;

export type BusinessOrderAttachmentCategory = typeof BUSINESS_ORDER_ATTACHMENT_CATEGORIES[number];

export type BusinessOrderAttachmentRecord = {
  id: number;
  businessOrderId: number;
  fileId: number;
  category: BusinessOrderAttachmentCategory;
  caption: string | null;
  messageId: number | null;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  uploaderAccountId: number;
  uploaderDisplayName: string;
  linkedAt: Date;
};

type AttachmentRow = {
  id: number;
  business_order_id: number;
  file_id: number;
  category: BusinessOrderAttachmentCategory;
  caption: string | null;
  message_id: number | null;
  original_name: string;
  media_type: string;
  size_bytes: number;
  linked_by: number;
  uploader_display_name: string;
  linked_at: Date;
};

export class BusinessOrderAttachmentError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "business_order_attachment_error") {
    super(message);
    this.name = "BusinessOrderAttachmentError";
  }
}

export class BusinessOrderAttachmentService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async listAttachments(input: { businessOrderId: number; viewerAccountId: number }) {
    await requireOrderAccess(this.database, input.businessOrderId, input.viewerAccountId);
    const rows = await attachmentRows(this.database, input.businessOrderId);
    return { items: rows.map(mapAttachment) };
  }

  async registerAttachment(input: {
    businessOrderId: number;
    category: BusinessOrderAttachmentCategory;
    caption?: string | null;
    stored: StoredBusinessOrderUpload;
    context: BusinessOrderActionContext;
  }): Promise<BusinessOrderAttachmentRecord> {
    const category = validCategory(input.category);
    const caption = validCaption(input.caption);
    return this.database.transaction(async (transaction) => {
      await requireOrderAccess(transaction, input.businessOrderId, input.context.actorAccountId);
      const now = input.context.now ?? new Date();
      const files = await transaction.query<{ id: number }>(
        `insert into stored_files
          (storage_key, original_name, media_type, size_bytes, sha256_hex, uploaded_by, uploaded_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [input.stored.storageKey, input.stored.originalName, input.stored.mediaType,
          input.stored.sizeBytes, input.stored.sha256Hex, input.context.actorAccountId, now],
      );
      const fileId = Number(files[0]?.id);
      const links = await transaction.query<{ id: number }>(
        `insert into business_order_attachments
          (business_order_id, file_id, category, caption, linked_by, linked_at)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [input.businessOrderId, fileId, category, caption, input.context.actorAccountId, now],
      );
      const attachmentId = Number(links[0]?.id);
      await writeAuditEvent(transaction, {
        occurredAt: now,
        actorAccountId: input.context.actorAccountId,
        eventType: "business_order.attachment_uploaded",
        objectType: "business_order",
        objectId: String(input.businessOrderId),
        after: { attachmentId, fileId, category, mediaType: input.stored.mediaType, sizeBytes: input.stored.sizeBytes },
        requestId: input.context.requestId,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      });
      const row = (await attachmentRows(transaction, input.businessOrderId, [attachmentId]))[0];
      if (!row) throw new BusinessOrderAttachmentError("业务附件写入失败", 500, "attachment_write_failed");
      return mapAttachment(row);
    });
  }

  async linkAttachmentsToMessage(input: {
    businessOrderId: number;
    messageId: number;
    attachmentIds: number[];
    actorAccountId: number;
    context?: BusinessOrderActionContext;
  }): Promise<void> {
    const attachmentIds = uniquePositiveIds(input.attachmentIds);
    if (attachmentIds.length === 0) return;
    await this.database.transaction(async (transaction) => {
      await linkBusinessOrderAttachmentsToMessage(transaction, {
        ...input,
        attachmentIds,
        context: input.context ?? {
          actorAccountId: input.actorAccountId,
          requestId: `link-message-${input.messageId}`,
        },
      });
    });
  }

  async getAttachmentFile(input: { businessOrderId: number; attachmentId: number; viewerAccountId: number }) {
    await requireOrderAccess(this.database, input.businessOrderId, input.viewerAccountId);
    const rows = await this.database.query<{
      storage_key: string; original_name: string; media_type: string; size_bytes: number;
    }>(
      `select file.storage_key, file.original_name, file.media_type, file.size_bytes
       from business_order_attachments as attachment
       join stored_files as file on file.id = attachment.file_id
       where attachment.business_order_id = $1 and attachment.id = $2
       limit 1`,
      [input.businessOrderId, input.attachmentId],
    );
    const row = rows[0];
    if (!row) throw new BusinessOrderAttachmentError("业务附件不存在", 404, "attachment_not_found");
    return {
      storageKey: row.storage_key,
      originalName: row.original_name,
      mediaType: row.media_type,
      sizeBytes: Number(row.size_bytes),
    };
  }
}

export async function linkBusinessOrderAttachmentsToMessage(
  executor: AuthSqlExecutor,
  input: {
    businessOrderId: number;
    messageId: number;
    attachmentIds: number[];
    actorAccountId: number;
    context: BusinessOrderActionContext;
  },
): Promise<void> {
  const attachmentIds = uniquePositiveIds(input.attachmentIds);
  if (attachmentIds.length === 0) return;
  await requireOrderAccess(executor, input.businessOrderId, input.actorAccountId);
  const message = (await executor.query<{ id: number }>(
    `select id from business_order_messages where id = $1 and business_order_id = $2 limit 1`,
    [input.messageId, input.businessOrderId],
  ))[0];
  if (!message) throw new BusinessOrderAttachmentError("留言不存在", 404, "message_not_found");
  const attachments = await executor.query<{ id: number; linked_by: number; message_id: number | null }>(
    `select id, linked_by, message_id
     from business_order_attachments
     where business_order_id = $1 and id = any($2::bigint[])
     for update`,
    [input.businessOrderId, attachmentIds],
  );
  if (attachments.length !== attachmentIds.length) {
    throw new BusinessOrderAttachmentError("部分业务附件不存在", 404, "attachment_not_found");
  }
  if (attachments.some((attachment) => Number(attachment.linked_by) !== input.actorAccountId)) {
    throw new BusinessOrderAttachmentError("只能把自己本次上传的附件加入留言", 403, "attachment_link_denied");
  }
  if (attachments.some((attachment) => attachment.message_id !== null && Number(attachment.message_id) !== input.messageId)) {
    throw new BusinessOrderAttachmentError("业务附件已经关联其他留言", 409, "attachment_already_linked");
  }
  await executor.query(
    `update business_order_attachments set message_id = $2
     where id = any($1::bigint[]) and message_id is null`,
    [attachmentIds, input.messageId],
  );
  await writeAuditEvent(executor, {
    occurredAt: input.context.now ?? new Date(),
    actorAccountId: input.actorAccountId,
    eventType: "business_order.attachment_linked_to_message",
    objectType: "business_order",
    objectId: String(input.businessOrderId),
    after: { messageId: input.messageId, attachmentIds },
    requestId: input.context.requestId,
    ipAddress: input.context.ipAddress,
    userAgent: input.context.userAgent,
  });
}

async function attachmentRows(
  executor: AuthSqlExecutor,
  businessOrderId: number,
  attachmentIds?: number[],
): Promise<AttachmentRow[]> {
  return executor.query<AttachmentRow>(
    `select attachment.id, attachment.business_order_id, attachment.file_id,
            attachment.category, attachment.caption, attachment.message_id,
            file.original_name, file.media_type, file.size_bytes,
            attachment.linked_by, account.display_name as uploader_display_name,
            attachment.linked_at
     from business_order_attachments as attachment
     join stored_files as file on file.id = attachment.file_id
     join staff_accounts as account on account.id = attachment.linked_by
     where attachment.business_order_id = $1
       and ($2::bigint[] is null or attachment.id = any($2::bigint[]))
     order by attachment.linked_at desc, attachment.id desc`,
    [businessOrderId, attachmentIds ?? null],
  );
}

function mapAttachment(row: AttachmentRow): BusinessOrderAttachmentRecord {
  return {
    id: Number(row.id),
    businessOrderId: Number(row.business_order_id),
    fileId: Number(row.file_id),
    category: row.category,
    caption: row.caption,
    messageId: row.message_id === null ? null : Number(row.message_id),
    originalName: row.original_name,
    mediaType: row.media_type,
    sizeBytes: Number(row.size_bytes),
    uploaderAccountId: Number(row.linked_by),
    uploaderDisplayName: row.uploader_display_name,
    linkedAt: new Date(row.linked_at),
  };
}

function validCategory(value: string): BusinessOrderAttachmentCategory {
  if (!BUSINESS_ORDER_ATTACHMENT_CATEGORIES.includes(value as BusinessOrderAttachmentCategory)) {
    throw new BusinessOrderAttachmentError("业务附件分类无效");
  }
  return value as BusinessOrderAttachmentCategory;
}

function validCaption(value: string | null | undefined): string | null {
  const caption = value?.trim() ?? "";
  if (!caption) return null;
  if (caption.length > 500) throw new BusinessOrderAttachmentError("业务附件说明不能超过 500 个字符");
  return caption;
}

function uniquePositiveIds(values: number[]): number[] {
  const ids = [...new Set(values)];
  if (ids.length > 20 || ids.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new BusinessOrderAttachmentError("业务附件编号无效");
  }
  return ids;
}

async function requireOrderAccess(executor: AuthSqlExecutor, businessOrderId: number, accountId: number) {
  const row = (await executor.query<{
    id: number; role: string; current_team_id: number | null; assigned_team_id: number | null;
  }>(
    `select account.id, account.role, member.current_team_id, repair_round.assigned_team_id
     from staff_accounts as account
     left join staff_members as member on member.account_id = account.id and member.status = 'active'
     cross join business_orders as business_order
     left join repair_rounds as repair_round
       on repair_round.business_order_id = business_order.id
      and repair_round.round_no = business_order.current_repair_round_no
     where account.id = $1 and account.is_active = true and business_order.id = $2
     limit 1`,
    [accountId, businessOrderId],
  ))[0];
  if (!row) throw new BusinessOrderAttachmentError("Business Order 不存在", 404, "business_order_not_found");
  if (["super_admin", "front_desk", "owner"].includes(row.role)) return;
  if (row.role === "mechanic" && row.assigned_team_id !== null && Number(row.current_team_id) === Number(row.assigned_team_id)) return;
  throw new BusinessOrderAttachmentError("无权读取此 Business Order 的业务附件", 403, "attachment_access_denied");
}
