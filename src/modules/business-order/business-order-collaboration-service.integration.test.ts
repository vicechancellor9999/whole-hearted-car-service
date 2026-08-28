import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import { BusinessOrderCollaborationService } from "@formal/modules/business-order/business-order-collaboration-service";

let database: PGlite;
let service: BusinessOrderCollaborationService;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return { async query<Row extends Record<string, unknown>>(text: string, parameters: readonly unknown[] = []) {
    return (await source.query<Row>(text, [...parameters])).rows;
  } };
}

function wrapped(source: PGlite): AuthSqlDatabase {
  return { ...executor(source), transaction: (callback) => source.transaction((transaction) => callback(executor(transaction))) };
}

beforeEach(async () => {
  database = new PGlite();
  await database.exec(`
    create table staff_accounts (id bigint primary key generated always as identity, display_name text not null, role text not null, is_active boolean not null default true);
    create table staff_members (id bigint primary key generated always as identity, account_id bigint, status text, current_team_id bigint);
    create table business_orders (id bigint primary key generated always as identity, order_no text not null, current_repair_round_no integer not null default 1);
    create table repair_rounds (id bigint primary key generated always as identity, business_order_id bigint not null, round_no integer not null, assigned_team_id bigint);
    create table audit_events (id bigint primary key generated always as identity, occurred_at timestamptz not null, actor_account_id bigint, event_type text not null, object_type text not null, object_id text not null, reason text, before_state jsonb, after_state jsonb, request_id text not null, ip_address inet, user_agent text);
  `);
  const migration = await readFile(resolve(process.cwd(), "drizzle/0031_business_order_messages.sql"), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
  await database.exec(`
    insert into staff_accounts (display_name, role) values ('前台', 'front_desk'), ('老板', 'owner');
    insert into business_orders (order_no) values ('KGN-WH-TEST');
    insert into repair_rounds (business_order_id, round_no) values (1, 1);
  `);
  service = new BusinessOrderCollaborationService(wrapped(database));
});

afterEach(async () => { await database.close(); });

describe("BusinessOrderCollaborationService", () => {
  it("persists messages, mentions, read state and edited revisions", async () => {
    const created = await service.createMessage({
      businessOrderId: 1,
      body: "  请老板确认收费项目  ",
      mentionedAccountIds: [2, 2],
      context: { actorAccountId: 1, requestId: "create-message", now: new Date("2026-08-28T10:00:00Z") },
    });
    expect(created.body).toBe("请老板确认收费项目");
    expect(created.mentions.map((item) => item.accountId)).toEqual([2]);
    expect((await service.listMyMentions({ accountId: 2 })).items[0]?.readAt).toBeNull();
    expect(await service.markMentionsRead({ businessOrderId: 1, accountId: 2 })).toEqual({ updated: 1 });

    const edited = await service.editMessage({
      businessOrderId: 1,
      messageId: created.id,
      body: "请老板确认最终收费项目",
      mentionedAccountIds: [2],
      expectedVersion: 1,
      context: { actorAccountId: 1, requestId: "edit-message", now: new Date("2026-08-28T10:02:00Z") },
    });
    expect(edited.version).toBe(2);
    expect((await service.listMessages({ businessOrderId: 1, viewerAccountId: 2 })).items[0]?.body).toBe("请老板确认最终收费项目");
    const revisions = await database.query<{ previous_body: string }>("select previous_body from business_order_message_revisions");
    expect(revisions.rows[0]?.previous_body).toBe("请老板确认收费项目");
  });
});
