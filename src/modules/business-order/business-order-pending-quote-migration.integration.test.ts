import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("adds pending pricing without changing any legacy price, discount or subtotal", async () => {
  const database = new PGlite();
  try {
    await database.exec(`create table business_order_charge_items (
      id bigint primary key, unit_price_minor bigint not null,
      item_discount_minor bigint not null, subtotal_minor bigint not null
    );
    insert into business_order_charge_items values (1, 0, 0, 0), (2, 1500000, 10000, 1490000);`);
    const before = (await database.query("select * from business_order_charge_items order by id")).rows;
    const migration = await readFile(resolve(process.cwd(), "drizzle/0051_business_order_pending_quotes.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await database.exec(statement);
    }
    const after = (await database.query("select * from business_order_charge_items order by id")).rows;
    expect(after).toEqual(before.map(row => ({ ...row, pending_quote: false })));
  } finally {
    await database.close();
  }
});
