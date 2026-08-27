import { describe, expect, it } from "vitest";
import {
  getLocalPostgresConfig,
  prepareLocalPostgres,
} from "./local-postgres";

const externalProjectRoot =
  "/Volumes/公司文件/Whole Hearted Car Service 正式系统";

describe("local PostgreSQL runtime config", () => {
  it("keeps the database and uploads inside the formal project on the external volume", () => {
    expect(getLocalPostgresConfig({
      DATABASE_URL: "postgres://wholehearted:database-secret@127.0.0.1:5432/wholehearted",
      UPLOAD_ROOT: `${externalProjectRoot}/.runtime/uploads`,
    }, externalProjectRoot)).toEqual({
      database: "wholehearted",
      databaseDir: `${externalProjectRoot}/.runtime/postgresql`,
      host: "127.0.0.1",
      password: "database-secret",
      port: 5432,
      uploadRoot: `${externalProjectRoot}/.runtime/uploads`,
      user: "wholehearted",
    });
  });

  it("rejects a local runtime that would write to Macintosh HD", () => {
    expect(() => getLocalPostgresConfig({
      DATABASE_URL: "postgres://wholehearted:database-secret@127.0.0.1:5432/wholehearted",
      UPLOAD_ROOT: "/Users/lijianfu/formal/uploads",
    }, "/Users/lijianfu/formal")).toThrow("外置卷");
  });

  it("rejects a non-local database host for the undeployed test runtime", () => {
    expect(() => getLocalPostgresConfig({
      DATABASE_URL: "postgres://wholehearted:database-secret@db.example.com:5432/wholehearted",
      UPLOAD_ROOT: `${externalProjectRoot}/.runtime/uploads`,
    }, externalProjectRoot)).toThrow("本地 PostgreSQL");
  });

  it("initialises an empty cluster before starting it and ensuring the database", async () => {
    const calls: string[] = [];
    await prepareLocalPostgres({
      isInitialised: async () => false,
      initialise: async () => { calls.push("initialise"); },
      start: async () => { calls.push("start"); },
      ensureDatabase: async () => { calls.push("ensure-database"); },
    });

    expect(calls).toEqual(["initialise", "start", "ensure-database"]);
  });

  it("does not reinitialise an existing cluster", async () => {
    const calls: string[] = [];
    await prepareLocalPostgres({
      isInitialised: async () => true,
      initialise: async () => { calls.push("initialise"); },
      start: async () => { calls.push("start"); },
      ensureDatabase: async () => { calls.push("ensure-database"); },
    });

    expect(calls).toEqual(["start", "ensure-database"]);
  });
});
