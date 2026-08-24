import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  readHiddenLine,
  runCreateSuperAdmin,
} from "./create-super-admin";

class FakeTtyInput extends EventEmitter {
  readonly isTTY = true;
  readonly rawModeChanges: boolean[] = [];

  setRawMode(enabled: boolean) {
    this.rawModeChanges.push(enabled);
  }

  resume() {}

  pause() {}
}

class FakeTtyOutput {
  readonly chunks: string[] = [];

  write(chunk: string | Uint8Array) {
    this.chunks.push(String(chunk));
    return true;
  }
}

describe("create-super-admin command", () => {
  it("reads a terminal password without echoing any password characters", async () => {
    const input = new FakeTtyInput();
    const output = new FakeTtyOutput();

    const pending = readHiddenLine("密码：", input, output);
    queueMicrotask(() => {
      input.emit("data", Buffer.from("Formal secret 2026!\r"));
    });

    await expect(pending).resolves.toBe("Formal secret 2026!");
    expect(output.chunks.join("")).toBe("密码：\n");
    expect(output.chunks.join("")).not.toContain("Formal secret 2026!");
    expect(input.rawModeChanges).toEqual([true, false]);
  });

  it("prints only the created username after a successful bootstrap", async () => {
    const output: string[] = [];
    const visibleAnswers = ["首位超级管理员", " First.Admin "];
    const secretAnswers = ["Formal secret 2026!", "Formal secret 2026!"];
    const calls: unknown[] = [];

    await runCreateSuperAdmin({
      readLine: async () => visibleAnswers.shift() ?? "",
      readSecret: async () => secretAnswers.shift() ?? "",
      write: (message) => output.push(message),
      requestId: "req-bootstrap-command",
      service: {
        async bootstrapFirstSuperAdmin(input) {
          calls.push(input);
          return {
            id: 1,
            displayName: "首位超级管理员",
            normalizedUsername: "first.admin",
            role: "super_admin",
            isActive: true,
            mustChangePassword: true,
            sessionEpoch: 1,
            version: 1,
            delegatedPermissions: [],
          };
        },
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      displayName: "首位超级管理员",
      username: " First.Admin ",
      password: "Formal secret 2026!",
      context: { requestId: "req-bootstrap-command" },
    });
    expect(output.join("")).toBe("已创建超级管理员：first.admin\n");
    expect(output.join("")).not.toContain("Formal secret 2026!");
  });
});
