import {
  bigint,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
} from "drizzle-orm/pg-core";
import { staffAccounts } from "@/db/schema/accounts";

export const delegatedPermission = pgEnum("delegated_permission", [
  "sensitive_operations.execute",
]);

export const staffAccountPermissionGrants = pgTable(
  "staff_account_permission_grants",
  {
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    permission: delegatedPermission("permission").notNull(),
    grantedBy: bigint("granted_by", { mode: "number" })
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.permission],
      name: "staff_account_permission_grants_pk",
    }),
    index("staff_account_permission_grants_granted_by_idx").on(
      table.grantedBy,
    ),
  ],
);

export type StaffAccountPermissionGrant =
  typeof staffAccountPermissionGrants.$inferSelect;
