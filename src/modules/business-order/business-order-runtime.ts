import { createPostgresAuthSqlDatabase } from "@/db/auth-sql";
import { createDatabaseClient } from "@/db/client";
import { BusinessOrderService } from "@/modules/business-order/business-order-service";
import { RepairRoundService } from "@/modules/business-order/repair-round-service";
import { FormalHandoffService } from "@/modules/business-order/formal-handoff-service";
import { InspectionReportService } from "@/modules/inspection-report/inspection-report-service";

export function createBusinessOrderRuntime(
  source: Record<string, unknown> = process.env,
) {
  const databaseClient = createDatabaseClient(source);
  const database = createPostgresAuthSqlDatabase(databaseClient.sql);
  return {
    service: new BusinessOrderService(database),
    repairRounds: new RepairRoundService(database),
    formalHandoffs: new FormalHandoffService(database),
    inspectionReports: new InspectionReportService(database),
    close: databaseClient.close,
  };
}
