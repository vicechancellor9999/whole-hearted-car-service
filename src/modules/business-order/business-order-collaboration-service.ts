import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import { writeAuditEvent } from "@formal/modules/audit/audit-service";
import type { BusinessOrderActionContext } from "@formal/modules/business-order/business-order-service";
import { linkBusinessOrderAttachmentsToMessage } from "@formal/modules/business-order/business-order-attachment-service";

export class BusinessOrderCollaborationError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "business_order_collaboration_error") {
    super(message);
    this.name = "BusinessOrderCollaborationError";
  }
}

type MessageRow = {
  id: number;
  business_order_id: number;
  author_account_id: number;
  author_display_name: string;
  author_role: string;
  body: string;
  version: number;
  created_at: Date;
  edited_at: Date | null;
};

type MentionRow = { message_id: number; account_id: number; display_name: string };
type MessageAttachmentRow = {
  id: number; message_id: number; original_name: string; media_type: string;
  size_bytes: number; caption: string | null;
};

export type BusinessOrderMessageRecord = {
  id: number;
  businessOrderId: number;
  authorAccountId: number;
  authorDisplayName: string;
  authorRole: string;
  body: string;
  version: number;
  createdAt: Date;
  editedAt: Date | null;
  mentions: Array<{ accountId: number; displayName: string }>;
  attachments: Array<{
    id: number; originalName: string; mediaType: string; sizeBytes: number; caption: string | null;
  }>;
};

export class BusinessOrderCollaborationService {
  constructor(private readonly database: AuthSqlDatabase) {}

  async listMessages(input: { businessOrderId: number; viewerAccountId: number }) {
    await requireOrderAccess(this.database, input.businessOrderId, input.viewerAccountId);
    const rows = await this.database.query<MessageRow>(
      `select id, business_order_id, author_account_id, author_display_name,
              author_role, body, version, created_at, edited_at
       from business_order_messages
       where business_order_id = $1
       order by created_at asc, id asc`,
      [input.businessOrderId],
    );
    return { items: await mapMessages(this.database, rows) };
  }

  async createMessage(input: {
    businessOrderId: number;
    body: string;
    mentionedAccountIds?: number[];
    attachmentIds?: number[];
    context: BusinessOrderActionContext;
  }) {
    const body = validBody(input.body);
    const mentionedAccountIds = uniquePositiveIds(input.mentionedAccountIds ?? []);
    return this.database.transaction(async (transaction) => {
      const actor = await requireOrderAccess(transaction, input.businessOrderId, input.context.actorAccountId);
      await requireActiveMentions(transaction, mentionedAccountIds);
      const now = input.context.now ?? new Date();
      const rows = await transaction.query<MessageRow>(
        `insert into business_order_messages
          (business_order_id, author_account_id, author_display_name, author_role,
           body, version, created_at)
         values ($1, $2, $3, $4, $5, 1, $6)
         returning id, business_order_id, author_account_id, author_display_name,
                   author_role, body, version, created_at, edited_at`,
        [input.businessOrderId, actor.id, actor.display_name, actor.role, body, now],
      );
      const message = rows[0];
      for (const accountId of mentionedAccountIds) {
        await transaction.query(
          `insert into business_order_message_mentions
            (message_id, mentioned_account_id, mentioned_at)
           values ($1, $2, $3)`,
          [message.id, accountId, now],
        );
      }
      await linkBusinessOrderAttachmentsToMessage(transaction, {
        businessOrderId: input.businessOrderId,
        messageId: Number(message.id),
        attachmentIds: input.attachmentIds ?? [],
        actorAccountId: input.context.actorAccountId,
        context: input.context,
      });
      await writeAuditEvent(transaction, {
        occurredAt: now,
        actorAccountId: actor.id,
        eventType: "business_order.message_created",
        objectType: "business_order",
        objectId: String(input.businessOrderId),
        after: { messageId: Number(message.id), mentionedAccountIds },
        requestId: input.context.requestId,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      });
      return (await mapMessages(transaction, rows))[0];
    });
  }

  async editMessage(input: {
    businessOrderId: number;
    messageId: number;
    body: string;
    mentionedAccountIds?: number[];
    expectedVersion: number;
    context: BusinessOrderActionContext;
  }) {
    const body = validBody(input.body);
    const mentionedAccountIds = uniquePositiveIds(input.mentionedAccountIds ?? []);
    return this.database.transaction(async (transaction) => {
      await requireOrderAccess(transaction, input.businessOrderId, input.context.actorAccountId);
      const existing = (await transaction.query<MessageRow>(
        `select id, business_order_id, author_account_id, author_display_name,
                author_role, body, version, created_at, edited_at
         from business_order_messages
         where id = $1 and business_order_id = $2 for update`,
        [input.messageId, input.businessOrderId],
      ))[0];
      if (!existing) throw new BusinessOrderCollaborationError("留言不存在", 404, "message_not_found");
      if (Number(existing.author_account_id) !== input.context.actorAccountId) {
        throw new BusinessOrderCollaborationError("只能编辑自己发布的留言", 403, "message_edit_denied");
      }
      if (Number(existing.version) !== input.expectedVersion) {
        throw new BusinessOrderCollaborationError("留言已在其他页面更新，请保留当前输入并刷新后重试", 409, "message_version_conflict");
      }
      await requireActiveMentions(transaction, mentionedAccountIds);
      const now = input.context.now ?? new Date();
      await transaction.query(
        `insert into business_order_message_revisions
          (message_id, replaced_version, previous_body, edited_by, edited_at)
         values ($1, $2, $3, $4, $5)`,
        [existing.id, existing.version, existing.body, input.context.actorAccountId, now],
      );
      const rows = await transaction.query<MessageRow>(
        `update business_order_messages
         set body = $2, version = version + 1, edited_at = $3
         where id = $1
         returning id, business_order_id, author_account_id, author_display_name,
                   author_role, body, version, created_at, edited_at`,
        [existing.id, body, now],
      );
      await transaction.query(`delete from business_order_message_mentions where message_id = $1`, [existing.id]);
      for (const accountId of mentionedAccountIds) {
        await transaction.query(
          `insert into business_order_message_mentions
            (message_id, mentioned_account_id, mentioned_at)
           values ($1, $2, $3)`,
          [existing.id, accountId, now],
        );
      }
      await writeAuditEvent(transaction, {
        occurredAt: now,
        actorAccountId: input.context.actorAccountId,
        eventType: "business_order.message_edited",
        objectType: "business_order",
        objectId: String(input.businessOrderId),
        before: { messageId: Number(existing.id), version: Number(existing.version) },
        after: { messageId: Number(existing.id), version: Number(existing.version) + 1, mentionedAccountIds },
        requestId: input.context.requestId,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      });
      return (await mapMessages(transaction, rows))[0];
    });
  }

  async markMentionsRead(input: { businessOrderId: number; accountId: number }) {
    await requireOrderAccess(this.database, input.businessOrderId, input.accountId);
    const rows = await this.database.query<{ id: number }>(
      `update business_order_message_mentions as mention
       set read_at = now()
       from business_order_messages as message
       where mention.message_id = message.id
         and message.business_order_id = $1
         and mention.mentioned_account_id = $2
         and mention.read_at is null
       returning mention.id`,
      [input.businessOrderId, input.accountId],
    );
    return { updated: rows.length };
  }

  async listMentionableAccounts(input: { accountId: number }) {
    await requireActiveAccount(this.database, input.accountId);
    const rows = await this.database.query<{ id: number; display_name: string; role: string }>(
      `select id, display_name, role from staff_accounts where is_active = true order by display_name, id`,
    );
    return rows.map((row) => ({ id: Number(row.id), displayName: row.display_name, role: row.role }));
  }

  async listMyMentions(input: { accountId: number }) {
    await requireActiveAccount(this.database, input.accountId);
    const rows = await this.database.query<{
      id: number; message_id: number; read_at: Date | null; mentioned_at: Date;
      business_order_id: number; order_no: string; body: string;
      author_display_name: string; created_at: Date;
    }>(
      `select mention.id, mention.message_id, mention.read_at, mention.mentioned_at,
              message.business_order_id, business_order.order_no, message.body,
              message.author_display_name, message.created_at
       from business_order_message_mentions as mention
       join business_order_messages as message on message.id = mention.message_id
       join business_orders as business_order on business_order.id = message.business_order_id
       where mention.mentioned_account_id = $1
       order by mention.mentioned_at desc, mention.id desc
       limit 100`,
      [input.accountId],
    );
    return { items: rows.map((row) => ({
      id: Number(row.id), messageId: Number(row.message_id), readAt: row.read_at,
      mentionedAt: new Date(row.mentioned_at), businessOrderId: Number(row.business_order_id),
      orderNo: row.order_no, body: row.body, authorDisplayName: row.author_display_name,
      createdAt: new Date(row.created_at),
    })) };
  }

  async countUnreadMentions(input: { accountId: number }) {
    await requireActiveAccount(this.database, input.accountId);
    const rows = await this.database.query<{ total: number }>(
      `select count(*)::integer as total from business_order_message_mentions
       where mentioned_account_id = $1 and read_at is null`, [input.accountId],
    );
    return Number(rows[0]?.total ?? 0);
  }
}

function validBody(value: string) {
  const body = value.trim();
  if (body.length < 1 || body.length > 4000) {
    throw new BusinessOrderCollaborationError("留言内容必须为 1 至 4000 个字符");
  }
  return body;
}

function uniquePositiveIds(values: number[]) {
  const unique = [...new Set(values)];
  if (unique.length > 50 || unique.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new BusinessOrderCollaborationError("提及账号无效");
  }
  return unique;
}

async function requireActiveMentions(executor: AuthSqlExecutor, accountIds: number[]) {
  if (accountIds.length === 0) return;
  const rows = await executor.query<{ id: number }>(
    `select id from staff_accounts where id = any($1::bigint[]) and is_active = true`, [accountIds],
  );
  if (rows.length !== accountIds.length) {
    throw new BusinessOrderCollaborationError("只能提及当前有效的系统账号");
  }
}

async function requireActiveAccount(executor: AuthSqlExecutor, accountId: number) {
  const row = (await executor.query<{ id: number }>(
    `select id from staff_accounts where id = $1 and is_active = true limit 1`, [accountId],
  ))[0];
  if (!row) throw new BusinessOrderCollaborationError("当前账号无效", 403, "collaboration_denied");
}

async function requireOrderAccess(executor: AuthSqlExecutor, businessOrderId: number, accountId: number) {
  const row = (await executor.query<{ id: number; display_name: string; role: string; current_team_id: number | null; assigned_team_id: number | null }>(
    `select account.id, account.display_name, account.role, member.current_team_id,
            repair_round.assigned_team_id
     from staff_accounts as account
     left join staff_members as member on member.account_id = account.id and member.status = 'active'
     cross join business_orders as business_order
     left join repair_rounds as repair_round
       on repair_round.business_order_id = business_order.id
      and repair_round.round_no = business_order.current_repair_round_no
     where account.id = $1 and account.is_active = true and business_order.id = $2
     limit 1`, [accountId, businessOrderId],
  ))[0];
  if (!row) throw new BusinessOrderCollaborationError("Business Order 不存在", 404, "business_order_not_found");
  if (["super_admin", "front_desk", "owner"].includes(row.role)) return row;
  if (row.role === "mechanic" && row.assigned_team_id !== null && Number(row.current_team_id) === Number(row.assigned_team_id)) return row;
  throw new BusinessOrderCollaborationError("无权读取此 Business Order 的沟通交流", 403, "collaboration_denied");
}

async function mapMessages(executor: AuthSqlExecutor, rows: MessageRow[]): Promise<BusinessOrderMessageRecord[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => Number(row.id));
  const mentions = await executor.query<MentionRow>(
    `select mention.message_id, account.id as account_id, account.display_name
     from business_order_message_mentions as mention
     join staff_accounts as account on account.id = mention.mentioned_account_id
     where mention.message_id = any($1::bigint[])
     order by account.display_name, account.id`, [ids],
  );
  const attachments = await executor.query<MessageAttachmentRow>(
    `select attachment.id, attachment.message_id, file.original_name,
            file.media_type, file.size_bytes, attachment.caption
     from business_order_attachments as attachment
     join stored_files as file on file.id = attachment.file_id
     where attachment.message_id = any($1::bigint[])
     order by attachment.linked_at, attachment.id`, [ids],
  );
  return rows.map((row) => ({
    id: Number(row.id), businessOrderId: Number(row.business_order_id),
    authorAccountId: Number(row.author_account_id), authorDisplayName: row.author_display_name,
    authorRole: row.author_role, body: row.body, version: Number(row.version),
    createdAt: new Date(row.created_at), editedAt: row.edited_at ? new Date(row.edited_at) : null,
    mentions: mentions.filter((mention) => Number(mention.message_id) === Number(row.id)).map((mention) => ({ accountId: Number(mention.account_id), displayName: mention.display_name })),
    attachments: attachments
      .filter((attachment) => Number(attachment.message_id) === Number(row.id))
      .map((attachment) => ({
        id: Number(attachment.id),
        originalName: attachment.original_name,
        mediaType: attachment.media_type,
        sizeBytes: Number(attachment.size_bytes),
        caption: attachment.caption,
      })),
  }));
}
