import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseClient } from "@/db/client";

const client = createDatabaseClient();

try {
  await migrate(client.db, { migrationsFolder: "drizzle" });
} finally {
  await client.close();
}
