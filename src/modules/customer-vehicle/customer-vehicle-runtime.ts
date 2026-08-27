import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { CustomerVehicleService } from "@formal/modules/customer-vehicle/customer-vehicle-service";

export function createCustomerVehicleRuntime(source: Record<string, unknown> = process.env) {
  const databaseClient = createDatabaseClient(source);
  return {
    service: new CustomerVehicleService(createPostgresAuthSqlDatabase(databaseClient.sql)),
    close: databaseClient.close,
  };
}
