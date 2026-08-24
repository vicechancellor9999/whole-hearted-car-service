import { bigint } from "drizzle-orm/pg-core";

export function identityPrimaryKey() {
  return bigint("id", { mode: "number" })
    .primaryKey()
    .generatedAlwaysAsIdentity();
}
