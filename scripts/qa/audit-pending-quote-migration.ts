import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

// Read-only fingerprint comparison; no customer/financial rows are exported.
const root = process.cwd();
if (!root.startsWith("/Volumes/公司文件/") || !root.endsWith("/3210-single-runtime")) throw new Error("Candidate checkout required");
process.loadEnvFile(path.join(root, ".env.local"));
const webEnv = path.join(root, "apps/web/.env.local");
if (existsSync(webEnv)) process.loadEnvFile(webEnv);
const url = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Local database required");
url.port = "55433";
const sql = postgres(url.toString(), { max: 1, prepare: false });
const output = "/Volumes/公司文件/Whole Hearted QA/2026-09-05-core-paths";
const phase = process.argv[2];
if (phase !== "before" && phase !== "after") throw new Error("Specify before or after");
try {
  const facts = await sql.begin("isolation level repeatable read read only", async (tx) => {
    const tables = await tx<{ tablename: string }[]>`select tablename from pg_tables where schemaname = 'public' and tablename ~ '^(business_order|formal_handoff|payment_|repair_round|performance_|refund_)' order by tablename`;
    const results = [];
    for (const { tablename } of tables) {
      const [row] = await tx`select count(*)::integer as count, md5(coalesce(string_agg(md5((to_jsonb(record) - 'pending_quote')::text), ',' order by (to_jsonb(record) - 'pending_quote')::text), '')) as hash from ${tx(tablename)} record`;
      results.push({ table: tablename, count: row.count, hash: row.hash });
    }
    return results;
  });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, `pending-quote-facts-${phase}.json`), JSON.stringify(facts, null, 2) + "\n");
  if (phase === "after") {
    const before = JSON.parse(await readFile(path.join(output, "pending-quote-facts-before.json"), "utf8"));
    if (JSON.stringify(before) !== JSON.stringify(facts)) throw new Error("Business fact fingerprints changed; inspect before continuing");
    const [pending] = await sql`select count(*)::integer as count from business_order_charge_items where pending_quote`;
    console.log(JSON.stringify({ factsUnchanged: true, tables: facts.length, historicalPendingCount: pending.count }));
  } else console.log(JSON.stringify({ fingerprintSaved: true, tables: facts.length }));
} finally { await sql.end(); }
