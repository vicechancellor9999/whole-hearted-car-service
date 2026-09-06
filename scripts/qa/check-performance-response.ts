import path from "node:path";
import postgres from "postgres";
import { createPostgresAuthSqlDatabase } from "../../src/db/auth-sql";
import { RepairRoundService } from "../../src/modules/business-order/repair-round-service";
import { assertPerformanceWorkspace } from "../../apps/web/src/lib/api/formal-performance-response";

// Exercise the same read services and JSON serialization as the API, never a write action.
const root = process.cwd();
if (!root.startsWith("/Volumes/公司文件/") || !root.endsWith("/3210-single-runtime")) throw new Error("Candidate checkout required");
process.loadEnvFile(path.join(root, ".env.local"));
process.loadEnvFile(path.join(root, "apps/web/.env.local"));
const url = new URL(process.env.DATABASE_URL!);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Local database required");
url.port = "55433";
const sql = postgres(url.toString(), { max: 1, prepare: false, connection: { default_transaction_read_only: "on" } });
try {
  const [mode] = await sql`show default_transaction_read_only`;
  if (mode.default_transaction_read_only !== "on") throw new Error("Read-only session required");
  const service = new RepairRoundService(createPostgresAuthSqlDatabase(sql));
  const input = { businessOrderId: 1, viewerAccountId: 1 };
  const [current, history, auditTrail, afterSalesRoundDeletion] = await Promise.all([
    service.getCurrentRound(input), service.listRepairRounds(input), service.listAuditTrail(input), service.getAfterSalesRoundDeletionPreview(input),
  ]);
  const response: unknown = JSON.parse(JSON.stringify({ current, history, auditTrail, afterSalesRoundDeletion }));
  assertPerformanceWorkspace(response, 1, false);
  console.log(JSON.stringify({ readonly: true, businessOrderId: 1, responseValid: true, historyCount: history.length }));
} finally { await sql.end(); }
