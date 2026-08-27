import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthSqlDatabase, AuthSqlExecutor } from "@formal/modules/auth/session-repository";
import { CustomerVehicleService } from "@formal/modules/customer-vehicle/customer-vehicle-service";

let database: PGlite;
let service: CustomerVehicleService;

function executor(source: PGlite | Transaction): AuthSqlExecutor {
  return {
    async query<Row extends Record<string, unknown>>(text: string, parameters: readonly unknown[] = []) {
      return (await source.query<Row>(text, [...parameters])).rows;
    },
  };
}

describe("formal vehicle presence", () => {
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(`
      create table staff_accounts (
        id bigint primary key,
        role text not null,
        is_active boolean not null
      );
      create table business_orders (
        id bigint primary key,
        vehicle_id bigint not null,
        status text not null,
        voided_at timestamptz
      );
      create table repair_rounds (
        id bigint primary key,
        business_order_id bigint not null
      );
      create table repair_round_events (
        id bigint primary key,
        repair_round_id bigint not null,
        event_type text not null,
        occurred_at timestamptz not null
      );
      create table vehicle_pickup_notices (
        id bigint primary key,
        vehicle_id bigint not null,
        origin_business_order_id bigint not null,
        picked_up_at timestamptz
      );
      insert into staff_accounts values (9, 'owner', true);
      insert into business_orders values
        (1, 101, 'waiting_assignment', null),
        (2, 102, 'assigned', null),
        (3, 103, 'in_repair', null),
        (4, 104, 'formally_handed_off', null),
        (5, 105, 'formally_handed_off', null),
        (6, 106, 'in_repair', null);
      insert into repair_rounds values
        (11, 1), (12, 2), (13, 3), (14, 4), (15, 5), (16, 6);
      insert into repair_round_events values
        (21, 12, 'assigned', '2026-08-26T08:00:00Z'),
        (22, 13, 'accepted', '2026-08-26T09:00:00Z'),
        (23, 14, 'accepted', '2026-08-26T09:30:00Z'),
        (24, 15, 'accepted', '2026-08-26T10:00:00Z'),
        (25, 16, 'accepted', '2026-08-26T11:00:00Z');
      insert into vehicle_pickup_notices values
        (31, 105, 5, '2026-08-26T10:30:00Z'),
        (32, 106, 6, '2026-08-26T10:30:00Z');
    `);
    const authDatabase: AuthSqlDatabase = {
      ...executor(database),
      transaction: (callback) => database.transaction((transaction) => callback(executor(transaction))),
    };
    service = new CustomerVehicleService(authDatabase);
  });

  afterEach(async () => database.close());

  it("starts on-site after mechanic acceptance and ends only after actual pickup", async () => {
    await expect(service.listOnSiteVehicleIds({
      viewerAccountId: 9,
      vehicleIds: [101, 102, 103, 104, 105, 106],
    })).resolves.toEqual([103, 104, 106]);
  });
});
