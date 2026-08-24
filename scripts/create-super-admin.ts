import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import type { ManagedAccount } from "@/modules/accounts/account-service";
import { createAccountRuntime } from "@/modules/accounts/account-runtime";
import { createRequestId } from "@/lib/request-id";

export interface HiddenInput {
  readonly isTTY?: boolean;
  setRawMode(enabled: boolean): void;
  resume(): void;
  pause(): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): this;
  off(event: "data", listener: (chunk: Buffer | string) => void): this;
}

export interface HiddenOutput {
  write(chunk: string | Uint8Array): unknown;
}

export type BootstrapService = {
  bootstrapFirstSuperAdmin(input: {
    displayName: string;
    username: string;
    password: string;
    context: {
      requestId: string;
      now?: Date;
      ipAddress?: string | null;
      userAgent?: string | null;
    };
  }): Promise<ManagedAccount>;
};

export function readHiddenLine(
  prompt: string,
  input: HiddenInput = process.stdin,
  output: HiddenOutput = process.stdout,
): Promise<string> {
  if (!input.isTTY) {
    throw new Error("创建超级管理员必须在交互式终端中执行");
  }

  output.write(prompt);
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    const characters: string[] = [];
    const finish = (error?: Error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(characters.join(""));
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("已取消创建超级管理员"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          characters.pop();
          continue;
        }
        characters.push(character);
      }
    };

    input.on("data", onData);
  });
}

export async function runCreateSuperAdmin(input: {
  readLine(prompt: string): Promise<string>;
  readSecret(prompt: string): Promise<string>;
  write(message: string): unknown;
  requestId: string;
  service: BootstrapService;
}) {
  const displayName = await input.readLine("显示名：");
  const username = await input.readLine("登录名：");
  const password = await input.readSecret("密码：");
  const confirmation = await input.readSecret("再次输入密码：");
  if (password !== confirmation) {
    throw new Error("两次输入的密码不一致");
  }

  const account = await input.service.bootstrapFirstSuperAdmin({
    displayName,
    username,
    password,
    context: {
      requestId: input.requestId,
      userAgent: "account:create-super-admin",
    },
  });
  input.write(`已创建超级管理员：${account.normalizedUsername}\n`);
}

async function main() {
  const runtime = createAccountRuntime(process.env);
  try {
    await runCreateSuperAdmin({
      readLine: readVisibleLine,
      readSecret: (prompt) => readHiddenLine(prompt),
      write: (message) => process.stdout.write(message),
      requestId: createRequestId(),
      service: runtime.service,
    });
  } finally {
    await runtime.close();
  }
}

async function readVisibleLine(prompt: string): Promise<string> {
  const lines = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await lines.question(prompt);
  } finally {
    lines.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "创建失败";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
