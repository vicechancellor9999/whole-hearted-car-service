import { describe, expect, it } from "vitest";
import { normalizeSqlParameters } from "@/db/auth-sql";

describe("PostgreSQL auth SQL parameter normalization", () => {
  it("serializes Date parameters before unsafe PostgreSQL queries", () => {
    const occurredAt = new Date("2026-08-24T14:00:00.000Z");

    expect(normalizeSqlParameters([
      "account.bootstrap_created",
      occurredAt,
      1,
      null,
    ])).toEqual([
      "account.bootstrap_created",
      "2026-08-24T14:00:00.000Z",
      1,
      null,
    ]);
  });
});
