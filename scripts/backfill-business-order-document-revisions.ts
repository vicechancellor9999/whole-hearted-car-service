import { createPostgresAuthSqlDatabase } from "@formal/db/auth-sql";
import { createDatabaseClient } from "@formal/db/client";
import { BusinessOrderDocumentService } from "@formal/modules/business-order/business-order-document-service";
import { BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION } from "@formal/modules/business-order/business-order-document-pdf";
import { resolve } from "node:path";

const source = { ...process.env };
if (source.DATABASE_URL && source.UNIFIED_DATABASE_PORT) {
  const databaseUrl = new URL(source.DATABASE_URL);
  databaseUrl.port = source.UNIFIED_DATABASE_PORT;
  source.DATABASE_URL = databaseUrl.toString();
}
source.UPLOAD_ROOT = source.UNIFIED_UPLOAD_ROOT ?? resolve(process.cwd(), ".runtime", "uploads");
const client = createDatabaseClient(source);
const database = createPostgresAuthSqlDatabase(client.sql);
const service = new BusinessOrderDocumentService(database, { storageRoot: source.UPLOAD_ROOT });

try {
  const missing = await database.query<{ id: number; actor_id: number; latest_revision_no: number }>(
    `select document.id,
            coalesce(active_generator.id, fallback_admin.id) as actor_id
            ,coalesce(latest.revision_no, 0)::integer as latest_revision_no
     from business_order_document_snapshots as document
     left join staff_accounts as active_generator
       on active_generator.id = document.generated_by
      and active_generator.is_active = true
      and active_generator.role in ('super_admin', 'front_desk')
     left join lateral (
       select id from staff_accounts
       where is_active = true and role = 'super_admin'
       order by id limit 1
     ) as fallback_admin on true
     left join lateral (
       select revision_no, renderer_version
       from business_order_document_revisions
       where document_snapshot_id = document.id
       order by revision_no desc limit 1
     ) as latest on true
     where (latest.revision_no is null or latest.renderer_version <> $1)
       and coalesce(active_generator.id, fallback_admin.id) is not null
     order by document.id`,
    [BUSINESS_ORDER_DOCUMENT_RENDERER_VERSION],
  );
  for (const row of missing) {
    await service.createRevision({
      documentId: Number(row.id),
      expectedLatestRevisionNo: Number(row.latest_revision_no),
      fieldOverrides: {},
      context: {
        actorAccountId: Number(row.actor_id),
        requestId: `backfill-document-revision-${row.id}`,
        now: new Date(),
        userAgent: "business-order-document-revision-backfill",
      },
    });
  }
  console.log(`BACKFILL_OK business_order_document_revisions=${missing.length}`);
} finally {
  await client.close();
}
