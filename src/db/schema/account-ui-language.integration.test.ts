import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let database: PGlite;

describe("staff account UI language migration", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    for (const migration of ["0000_foundation.sql", "0037_staff_account_ui_language.sql"]) {
      await database.exec(await readFile(resolve(process.cwd(), "drizzle", migration), "utf8"));
    }
  });

  afterEach(async () => database.close());

  it("defaults existing account creation to Chinese and persists English", async () => {
    const inserted = await database.query<{ id: number; ui_language: string }>(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role)
       values ('LiJian', 'lijian', 'hash', 'super_admin')
       returning id, ui_language::text`,
    );
    expect(inserted.rows[0].ui_language).toBe("zh");

    const updated = await database.query<{ ui_language: string }>(
      `update staff_accounts set ui_language = 'en' where id = $1 returning ui_language::text`,
      [inserted.rows[0].id],
    );
    expect(updated.rows[0].ui_language).toBe("en");
  });

  it("rejects unsupported language values", async () => {
    await expect(database.query(
      `insert into staff_accounts
        (display_name, normalized_username, password_hash, role, ui_language)
       values ('Test', 'test', 'hash', 'front_desk', 'fr')`,
    )).rejects.toThrow(/ui_language|invalid input value/i);
  });
});
