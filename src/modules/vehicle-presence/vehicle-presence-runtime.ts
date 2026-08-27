import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { VehiclePresenceService } from "@/modules/vehicle-presence/vehicle-presence-service";
export function createVehiclePresenceRuntime(source: Record<string, unknown> = process.env) {
  const client = createDatabaseClient(source);
  return { service: new VehiclePresenceService(createPostgresAuthSqlDatabase(client.sql)), close: client.close };
}
