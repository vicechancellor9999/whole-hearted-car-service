import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { BusinessOrderService } from "@formal/modules/business-order/business-order-service";
import { RepairRoundService } from "@formal/modules/business-order/repair-round-service";
import { FormalHandoffService } from "@formal/modules/business-order/formal-handoff-service";
import { InspectionReportService } from "@formal/modules/inspection-report/inspection-report-service";
import { PaymentService } from "@formal/modules/payment/payment-service";
import { BusinessOrderDocumentService } from "@formal/modules/business-order/business-order-document-service";
import { BusinessOrderCollaborationService } from "@formal/modules/business-order/business-order-collaboration-service";
import { BusinessOrderAttachmentService } from "@formal/modules/business-order/business-order-attachment-service";

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
    payments: new PaymentService(database),
    documents: new BusinessOrderDocumentService(database),
    collaboration: new BusinessOrderCollaborationService(database),
    attachments: new BusinessOrderAttachmentService(database),
    close: databaseClient.close,
  };
}
