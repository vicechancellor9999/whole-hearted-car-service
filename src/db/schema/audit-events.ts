import {
  bigint,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@formal/db/schema/accounts";
import { identityPrimaryKey } from "@formal/db/schema/common";

export type AuditState = Record<string, unknown>;

export const auditEvents = pgTable(
  "audit_events",
  {
    id: identityPrimaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorAccountId: bigint("actor_account_id", { mode: "number" }).references(
      () => staffAccounts.id,
      { onDelete: "set null" },
    ),
    eventType: text("event_type").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    reason: text("reason"),
    beforeState: jsonb("before_state").$type<AuditState>(),
    afterState: jsonb("after_state").$type<AuditState>(),
    requestId: text("request_id").notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("audit_events_actor_occurred_at_idx").on(
      table.actorAccountId,
      table.occurredAt,
    ),
    index("audit_events_object_occurred_at_idx").on(
      table.objectType,
      table.objectId,
      table.occurredAt,
    ),
    index("audit_events_event_type_occurred_at_idx").on(
      table.eventType,
      table.occurredAt,
    ),
    index("audit_events_request_id_idx").on(table.requestId),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
