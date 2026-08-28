import { describe, expect, it, vi } from "vitest";
import type { AuthSqlDatabase } from "@formal/modules/auth/session-repository";
import { processRecordDeletionFileTasks } from "@formal/modules/record-deletion/record-deletion-file-cleanup";

describe("processRecordDeletionFileTasks", () => {
  it("marks successful removals complete and failed removals retryable", async () => {
    const queries: string[] = [];
    const database = {
      async query<Row extends Record<string, unknown>>(text: string) {
        queries.push(text);
        if (text.includes("select id, storage_key")) {
          return [
            { id: 1, storage_key: "vehicle-files/2026/08/ok.jpg" },
            { id: 2, storage_key: "customer-license-files/2026/08/fail.jpg" },
          ] as unknown as Row[];
        }
        return [];
      },
      async transaction<Result>(callback: (tx: AuthSqlDatabase) => Promise<Result>) {
        return callback(this);
      },
    } satisfies AuthSqlDatabase;
    const remove = vi.fn(async (storageKey: string) => {
      if (storageKey.includes("fail")) throw new Error("disk unavailable");
    });

    await expect(processRecordDeletionFileTasks(database, { remove }))
      .resolves.toEqual({ completed: 1, failed: 1 });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(queries.some((query) => query.includes("state = 'completed'"))).toBe(true);
    expect(queries.some((query) => query.includes("state = 'failed'"))).toBe(true);
  });
});
