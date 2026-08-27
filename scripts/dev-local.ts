import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  getLocalPostgresConfig,
  prepareLocalPostgres,
} from "./local-postgres";

const projectRoot = process.cwd();
const envFile = path.join(projectRoot, ".env.local");
if (!existsSync(envFile)) {
  throw new Error("缺少 .env.local，无法启动正式系统本地环境");
}
process.loadEnvFile(envFile);

const config = getLocalPostgresConfig(process.env, projectRoot);
await mkdir(config.uploadRoot, { recursive: true });

const localPostgres = new EmbeddedPostgres({
  databaseDir: config.databaseDir,
  user: config.user,
  password: config.password,
  port: config.port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8"],
  postgresFlags: ["-c", "timezone=America/Jamaica"],
  onLog: (message) => {
    if (/ready to accept connections|database system is shut down/i.test(String(message))) {
      process.stdout.write(`[PostgreSQL] ${String(message).trim()}\n`);
    }
  },
  onError: (error) => process.stderr.write(`[PostgreSQL] ${String(error)}\n`),
});

await prepareLocalPostgres({
  isInitialised: async () => existsSync(path.join(config.databaseDir, "PG_VERSION")),
  initialise: async () => localPostgres.initialise(),
  start: async () => localPostgres.start(),
  ensureDatabase: async () => {
    const adminUrl = new URL(process.env.DATABASE_URL!);
    adminUrl.pathname = "/postgres";
    const sql = postgres(adminUrl.toString(), { max: 1 });
    try {
      const rows = await sql<{ exists: boolean }[]>`
        select exists(
          select 1 from pg_database where datname = ${config.database}
        ) as exists
      `;
      if (!rows[0]?.exists) {
        if (!/^[A-Za-z0-9_]+$/.test(config.database)) {
          throw new Error("本地数据库名只允许字母、数字和下划线");
        }
        await sql.unsafe(`create database "${config.database}"`);
      }
    } finally {
      await sql.end();
    }
  },
});

const { createDatabaseClient } = await import("../src/db/client");
const databaseClient = createDatabaseClient(process.env);
try {
  await migrate(databaseClient.db, { migrationsFolder: "drizzle" });
} finally {
  await databaseClient.close();
}

process.stdout.write("[正式系统] 数据库已就绪，正在启动 http://127.0.0.1:3211\n");
const nextProcess = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3211"],
  { cwd: projectRoot, env: process.env, stdio: "inherit" },
);

let stopping = false;
async function stop(signal?: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  if (nextProcess.exitCode === null) nextProcess.kill(signal ?? "SIGTERM");
  await localPostgres.stop();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

const exitCode = await new Promise<number>((resolve) => {
  nextProcess.once("exit", (code) => resolve(code ?? 0));
});
await stop();
process.exitCode = exitCode;
