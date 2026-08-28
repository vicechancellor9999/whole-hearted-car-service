import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import {
  BusinessOrderAttachmentError,
  BusinessOrderAttachmentService,
} from "@formal/modules/business-order/business-order-attachment-service";

let database: PGlite;
let service: BusinessOrderAttachmentService;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(text: string, parameters: readonly unknown[] = []) {
      return (await source.query<Row>(text, [...parameters])).rows;
    },
  };
}

function wrapped(source: PGlite): AuthSqlDatabase {
  return {
    ...executor(source),
    transaction: (callback) => source.transaction((transaction) => callback(executor(transaction))),
  };
}

beforeEach(async () => {
  database = new PGlite();
  await database.exec(`
    create table staff_accounts (id bigint primary key generated always as identity, display_name text not null, role text not null, is_active boolean not null default true);
    create table staff_members (id bigint primary key generated always as identity, account_id bigint, status text, current_team_id bigint);
    create table business_orders (id bigint primary key generated always as identity, order_no text not null, current_repair_round_no integer not null default 1);
    create table repair_rounds (id bigint primary key generated always as identity, business_order_id bigint not null, round_no integer not null, assigned_team_id bigint);
    create table business_order_messages (id bigint primary key generated always as identity, business_order_id bigint not null, author_account_id bigint not null, author_display_name text not null, author_role text not null, body text not null, version integer not null default 1, created_at timestamptz not null default now(), edited_at timestamptz);
    create table stored_files (id bigint primary key generated always as identity, storage_key text not null unique, original_name text not null, media_type text not null, size_bytes bigint not null, sha256_hex text not null, uploaded_by bigint not null, uploaded_at timestamptz not null default now());
    create table audit_events (id bigint primary key generated always as identity, occurred_at timestamptz not null, actor_account_id bigint, event_type text not null, object_type text not null, object_id text not null, reason text, before_state jsonb, after_state jsonb, request_id text not null, ip_address inet, user_agent text);
  `);
  const migration = await readFile(resolve(process.cwd(), "drizzle/0032_business_order_attachments.sql"), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
  await database.exec(`
    insert into staff_accounts (display_name, role) values ('前台', 'front_desk'), ('老板', 'owner'), ('其他维修工', 'mechanic');
    insert into staff_members (account_id, status, current_team_id) values (3, 'active', 99);
    insert into business_orders (order_no) values ('KGN-WH-ATTACHMENT');
    insert into repair_rounds (business_order_id, round_no, assigned_team_id) values (1, 1, 1);
    insert into business_order_messages (business_order_id, author_account_id, author_display_name, author_role, body) values (1, 1, '前台', 'front_desk', '查看照片');
  `);
  service = new BusinessOrderAttachmentService(wrapped(database));
});

afterEach(async () => { await database.close(); });

describe("BusinessOrderAttachmentService", () => {
  it("persists, lists, protects and links one canonical attachment to a message", async () => {
    const created = await service.registerAttachment({
      businessOrderId: 1,
      category: "service_photo",
      caption: "完工照片",
      stored: {
        storageKey: "business-order-files/2026/08/photo.jpg",
        originalName: "完工照片.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 12,
        sha256Hex: "a".repeat(64),
      },
      context: { actorAccountId: 1, requestId: "upload-photo", now: new Date("2026-08-28T12:00:00Z") },
    });
    expect(created).toMatchObject({
      businessOrderId: 1,
      category: "service_photo",
      caption: "完工照片",
      originalName: "完工照片.jpg",
      messageId: null,
    });
    expect((await service.listAttachments({ businessOrderId: 1, viewerAccountId: 2 })).items)
      .toHaveLength(1);
    await service.linkAttachmentsToMessage({
      businessOrderId: 1,
      messageId: 1,
      attachmentIds: [created.id],
      actorAccountId: 1,
    });
    expect((await service.listAttachments({ businessOrderId: 1, viewerAccountId: 1 })).items[0]?.messageId)
      .toBe(1);
    expect(await service.getAttachmentFile({ businessOrderId: 1, attachmentId: created.id, viewerAccountId: 2 }))
      .toMatchObject({ storageKey: "business-order-files/2026/08/photo.jpg", mediaType: "image/jpeg" });
    const audit = await database.query<{ event_type: string }>("select event_type from audit_events order by id");
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      "business_order.attachment_uploaded",
      "business_order.attachment_linked_to_message",
    ]);
  });

  it("denies an unassigned mechanic and rejects cross-actor message linking", async () => {
    await expect(service.listAttachments({ businessOrderId: 1, viewerAccountId: 3 }))
      .rejects.toBeInstanceOf(BusinessOrderAttachmentError);
    const created = await service.registerAttachment({
      businessOrderId: 1,
      category: "other",
      caption: null,
      stored: {
        storageKey: "business-order-files/2026/08/file.pdf",
        originalName: "资料.pdf",
        mediaType: "application/pdf",
        sizeBytes: 8,
        sha256Hex: "b".repeat(64),
      },
      context: { actorAccountId: 1, requestId: "upload-file" },
    });
    await expect(service.linkAttachmentsToMessage({
      businessOrderId: 1,
      messageId: 1,
      attachmentIds: [created.id],
      actorAccountId: 2,
    })).rejects.toMatchObject({ status: 403 });
  });
});
