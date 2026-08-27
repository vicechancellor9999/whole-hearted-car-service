import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { CustomerDriverLicenseService } from "@formal/modules/customer-vehicle/customer-driver-license-service";
import { CustomerVehicleService } from "@formal/modules/customer-vehicle/customer-vehicle-service";

export function createCustomerVehicleRuntime(source: Record<string, unknown> = process.env) {
  const databaseClient = createDatabaseClient(source);
  const database = createPostgresAuthSqlDatabase(databaseClient.sql);
  return {
    service: new CustomerVehicleService(database),
    driverLicenseService: new CustomerDriverLicenseService(database),
    close: databaseClient.close,
  };
}
