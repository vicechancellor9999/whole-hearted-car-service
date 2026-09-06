import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let database: PGlite;

describe("business-order category migration", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(`
      create table business_orders (
        id bigint primary key,
        current_charge_version_no integer not null default 0
      );
      create table business_order_problem_originals (
        business_order_id bigint primary key,
        content_zh text,
        content_en text
      );
      create table business_order_charge_versions (
        id bigint primary key,
        business_order_id bigint not null,
        version_no integer not null
      );
      create table business_order_charge_items (
        charge_version_id bigint not null,
        name_zh text not null,
        name_en text,
        description_zh text,
        description_en text,
        sort_order integer not null default 0
      );
      insert into business_orders (id) values (1), (2), (3);
      insert into business_order_problem_originals
        (business_order_id, content_zh, content_en)
      values
        (1, '客户说不要更换水泵，只做清洁', null),
        (2, null, 'contest entry only'),
        (3, '检查异响并做机油保养，确认后维修', null);
    `);
    await database.exec(await readFile(resolve(process.cwd(), "drizzle/0049_business_order_categories.sql"), "utf8"));
    await database.exec(await readFile(resolve(process.cwd(), "drizzle/0050_conservative_business_order_categories.sql"), "utf8"));
  });

  afterEach(async () => database.close());

  it("keeps uncertain historical descriptions unclassified and preserves positive multi-category facts", async () => {
    const result = await database.query<{ id: number; categories: string }>(
      "select id, categories::text from business_orders order by id",
    );
    expect(result.rows).toEqual([
      { id: 1, categories: "{}" },
      { id: 2, categories: "{}" },
      { id: 3, categories: "{maintenance,repair,inspection}" },
    ]);
  });
});
