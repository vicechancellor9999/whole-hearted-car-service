import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  getLocalPostgresConfig,
  prepareLocalPostgres,
  type LocalPostgresConfig,
} from "./local-postgres";

export type UnifiedRuntimeConfig = {
  projectRoot: string;
  webRoot: string;
  appHost: "127.0.0.1";
  appPort: number;
  appOrigin: string;
  nextMode: "dev" | "start";
  databaseUrl: string;
  database: LocalPostgresConfig;
  childEnvironment: NodeJS.ProcessEnv;
};

export function getUnifiedRuntimeConfig(
  source: Record<string, string | undefined>,
  projectRoot: string,
): UnifiedRuntimeConfig {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const appHost = "127.0.0.1" as const;
  const appPort = parsePort(source.UNIFIED_APP_PORT ?? "3210", "UNIFIED_APP_PORT");
  const nextMode = source.UNIFIED_NEXT_MODE === "dev" ? "dev" : "start";
  if (!source.DATABASE_URL) throw new Error("缺少 DATABASE_URL");
  const databaseUrl = new URL(source.DATABASE_URL);
  databaseUrl.port = String(parsePort(
    source.UNIFIED_DATABASE_PORT ?? (databaseUrl.port || "5432"),
    "UNIFIED_DATABASE_PORT",
  ));
  const appOrigin = source.UNIFIED_APP_ORIGIN ?? `http://${appHost}:${appPort}`;
  const parsedOrigin = new URL(appOrigin);
  const originPort = parsedOrigin.port
    ? Number(parsedOrigin.port)
    : parsedOrigin.protocol === "https:" ? 443 : 80;
  if (
    parsedOrigin.protocol !== "http:"
    || !["127.0.0.1", "localhost"].includes(parsedOrigin.hostname)
    || originPort !== appPort
    || parsedOrigin.pathname !== "/"
    || parsedOrigin.search
    || parsedOrigin.hash
  ) {
    throw new Error("APP_ORIGIN 必须指向统一应用的本地端口");
  }

  const uploadRoot = source.UNIFIED_UPLOAD_ROOT
    ?? path.join(resolvedProjectRoot, ".runtime", "uploads");
  const databaseUrlString = databaseUrl.toString();
  const database = getLocalPostgresConfig({
    ...source,
    DATABASE_URL: databaseUrlString,
    UPLOAD_ROOT: uploadRoot,
  }, resolvedProjectRoot);
  const childEnvironment: NodeJS.ProcessEnv = {
    ...source,
    NODE_ENV: nextMode === "start" ? "production" : "development",
    DATABASE_URL: databaseUrlString,
    APP_ORIGIN: appOrigin,
    UPLOAD_ROOT: database.uploadRoot,
    NEXT_PUBLIC_USE_MOCK: "false",
    VEHICLE_DOCUMENT_AI_SETTINGS_PATH: source.VEHICLE_DOCUMENT_AI_SETTINGS_PATH
      ?? path.join(resolvedProjectRoot, ".runtime", "vehicle-document-ai-settings.json"),
  };
  delete childEnvironment.FORMAL_BACKEND_ORIGIN;
  delete childEnvironment.NEXT_PUBLIC_FORMAL_AUTH;
  delete childEnvironment.NEXT_PUBLIC_FORMAL_CUSTOMER_VEHICLE;

  return {
    projectRoot: resolvedProjectRoot,
    webRoot: path.join(resolvedProjectRoot, "apps", "web"),
    appHost,
    appPort,
    appOrigin,
    nextMode,
    databaseUrl: databaseUrlString,
    database,
    childEnvironment,
  };
}

function parsePort(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} 必须是有效端口`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} 必须是有效端口`);
  }
  return port;
}

async function main() {
  const projectRoot = process.cwd();
  const rootEnvFile = path.join(projectRoot, ".env.local");
  if (!existsSync(rootEnvFile)) {
    throw new Error("缺少 .env.local，无法启动统一正式系统");
  }
  process.loadEnvFile(rootEnvFile);
  const webEnvFile = path.join(projectRoot, "apps", "web", ".env.local");
  if (existsSync(webEnvFile)) process.loadEnvFile(webEnvFile);
  const config = getUnifiedRuntimeConfig(process.env, projectRoot);
  await mkdir(config.database.uploadRoot, { recursive: true });

  const localPostgres = new EmbeddedPostgres({
    databaseDir: config.database.databaseDir,
    user: config.database.user,
    password: config.database.password,
    port: config.database.port,
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

  let databaseStarted = false;
  let nextProcess: ChildProcess | undefined;
  let stopping = false;
  async function stop(signal: NodeJS.Signals = "SIGTERM") {
    if (stopping) return;
    stopping = true;
    if (nextProcess?.exitCode === null) nextProcess.kill(signal);
    if (databaseStarted) await localPostgres.stop();
  }
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
  try {
    await prepareLocalPostgres({
      isInitialised: async () => existsSync(path.join(config.database.databaseDir, "PG_VERSION")),
      initialise: async () => localPostgres.initialise(),
      start: async () => {
        await localPostgres.start();
        databaseStarted = true;
      },
      ensureDatabase: async () => ensureDatabase(config),
    });

    const { createDatabaseClient } = await import("../src/db/client");
    const databaseClient = createDatabaseClient(config.childEnvironment);
    try {
      await migrate(databaseClient.db, {
        migrationsFolder: path.join(config.projectRoot, "drizzle"),
      });
    } finally {
      await databaseClient.close();
    }

    const nextBin = path.join(config.projectRoot, "node_modules", "next", "dist", "bin", "next");
    nextProcess = spawn(process.execPath, [
      nextBin,
      config.nextMode,
      "-H",
      config.appHost,
      "-p",
      String(config.appPort),
    ], {
      cwd: config.webRoot,
      env: config.childEnvironment,
      stdio: "inherit",
    });
    process.stdout.write(`[统一应用] 正在启动 ${config.appOrigin}\n`);
    nextProcess.once("error", (error) => {
      process.stderr.write(`[统一应用] 启动失败：${error.message}\n`);
      void stop();
    });
    const exitCode = await new Promise<number>((resolve) => {
      nextProcess!.once("exit", (code) => resolve(code ?? 0));
    });
    process.exitCode = exitCode;
  } finally {
    await stop();
  }
}

async function ensureDatabase(config: UnifiedRuntimeConfig): Promise<void> {
  const adminUrl = new URL(config.databaseUrl);
  adminUrl.pathname = "/postgres";
  const sql = postgres(adminUrl.toString(), { max: 1 });
  try {
    const rows = await sql<{ exists: boolean }[]>`
      select exists(
        select 1 from pg_database where datname = ${config.database.database}
      ) as exists
    `;
    if (!rows[0]?.exists) {
      if (!/^[A-Za-z0-9_]+$/.test(config.database.database)) {
        throw new Error("本地数据库名只允许字母、数字和下划线");
      }
      await sql.unsafe(`create database "${config.database.database}"`);
    }
  } finally {
    await sql.end();
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "统一应用启动失败";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
