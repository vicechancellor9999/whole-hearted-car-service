export type LocalPostgresConfig = {
  database: string;
  databaseDir: string;
  host: string;
  password: string;
  port: number;
  uploadRoot: string;
  user: string;
};

export type LocalPostgresLifecycle = {
  ensureDatabase(): Promise<void>;
  initialise(): Promise<void>;
  isInitialised(): Promise<boolean>;
  start(): Promise<void>;
};

export async function prepareLocalPostgres(
  lifecycle: LocalPostgresLifecycle,
): Promise<void> {
  if (!(await lifecycle.isInitialised())) await lifecycle.initialise();
  await lifecycle.start();
  await lifecycle.ensureDatabase();
}

export function getLocalPostgresConfig(
  source: Record<string, string | undefined>,
  projectRoot: string,
): LocalPostgresConfig {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const externalRoot = `${path.resolve("/Volumes/公司文件")}${path.sep}`;
  if (!resolvedProjectRoot.startsWith(externalRoot)) {
    throw new Error("本地正式系统运行目录必须位于外置卷 /Volumes/公司文件");
  }

  if (!source.DATABASE_URL) throw new Error("缺少 DATABASE_URL");
  const databaseUrl = new URL(source.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error("DATABASE_URL 必须使用 PostgreSQL");
  }
  if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
    throw new Error("未部署测试阶段必须使用本地 PostgreSQL");
  }

  const uploadRoot = source.UPLOAD_ROOT
    ? path.resolve(source.UPLOAD_ROOT)
    : path.join(resolvedProjectRoot, ".runtime", "uploads");
  if (!uploadRoot.startsWith(externalRoot)) {
    throw new Error("上传目录必须位于外置卷 /Volumes/公司文件");
  }

  const database = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(databaseUrl.username);
  const password = decodeURIComponent(databaseUrl.password);
  if (!database || !user || !password) {
    throw new Error("DATABASE_URL 必须包含数据库名、用户名和密码");
  }

  return {
    database,
    databaseDir: path.join(resolvedProjectRoot, ".runtime", "postgresql"),
    host: databaseUrl.hostname,
    password,
    port: databaseUrl.port ? Number(databaseUrl.port) : 5432,
    uploadRoot,
    user,
  };
}
import path from "node:path";
