import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const foundationMigrationPath = resolve(
  process.cwd(),
  "drizzle/0000_foundation.sql",
);
const accountPermissionsMigrationPath = resolve(
  process.cwd(),
  "drizzle/0001_account_permissions.sql",
);

let database: PGlite;

async function applyMigrations() {
  await database.exec(await readFile(foundationMigrationPath, "utf8"));
  await database.exec(await readFile(accountPermissionsMigrationPath, "utf8"));
}

async function createAccount(input: {
  username: string;
  role: "super_admin" | "front_desk" | "owner" | "mechanic";
}) {
  const result = await database.query<{ id: number }>(
    `insert into staff_accounts
      (display_name, normalized_username, password_hash, role)
     values ($1, $2, 'argon2id-hash-placeholder', $3)
     returning id`,
    [input.username, input.username, input.role],
  );
  return result.rows[0].id;
}

describe("account permission grants migration", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await applyMigrations();
  });

  afterEach(async () => {
    await database.close();
  });

  it("stores one durable front-desk sensitive-operation grant with its grantor", async () => {
    const grantorId = await createAccount({
      username: "admin",
      role: "super_admin",
    });
    const frontDeskId = await createAccount({
      username: "frontdesk",
      role: "front_desk",
    });

    await database.query(
      `insert into staff_account_permission_grants
        (account_id, permission, granted_by, granted_at)
       values ($1, 'sensitive_operations.execute', $2, $3)`,
      [frontDeskId, grantorId, new Date("2026-08-25T01:00:00Z")],
    );

    const stored = await database.query<{
      account_id: number;
      permission: string;
      granted_by: number;
      granted_at: Date;
    }>(
      `select account_id, permission, granted_by, granted_at
       from staff_account_permission_grants`,
    );

    expect(stored.rows).toEqual([
      {
        account_id: frontDeskId,
        permission: "sensitive_operations.execute",
        granted_by: grantorId,
        granted_at: new Date("2026-08-25T01:00:00Z"),
      },
    ]);
    await expect(
      database.query(
        `insert into staff_account_permission_grants
          (account_id, permission, granted_by)
         values ($1, 'sensitive_operations.execute', $2)`,
        [frontDeskId, grantorId],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("rejects undeclared permission names and indexes both account foreign keys", async () => {
    const grantorId = await createAccount({
      username: "admin",
      role: "super_admin",
    });
    const frontDeskId = await createAccount({
      username: "frontdesk",
      role: "front_desk",
    });

    await expect(
      database.query(
        `insert into staff_account_permission_grants
          (account_id, permission, granted_by)
         values ($1, 'accounts.manage', $2)`,
        [frontDeskId, grantorId],
      ),
    ).rejects.toThrow(/delegated_permission|invalid input value/i);

    const indexes = await database.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'staff_account_permission_grants_pk',
           'staff_account_permission_grants_granted_by_idx'
         )
       order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "staff_account_permission_grants_granted_by_idx",
      "staff_account_permission_grants_pk",
    ]);
  });
});
