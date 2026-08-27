import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptPath = join(projectRoot, "start-dev.sh");

function runStartScript(port) {
  const fakeBin = mkdtempSync(join(tmpdir(), "wh-start-dev-"));
  const fakeNpm = join(fakeBin, "npm");
  writeFileSync(
    fakeNpm,
    '#!/bin/sh\nprintf "cwd=%s\\n" "$PWD"\nprintf "args=%s\\n" "$*"\n',
    "utf8",
  );
  chmodSync(fakeNpm, 0o755);

  const env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
  };
  if (port === undefined) {
    delete env.PORT;
  } else {
    env.PORT = String(port);
  }

  const result = spawnSync("/bin/bash", [scriptPath], {
    cwd: tmpdir(),
    env,
    encoding: "utf8",
    timeout: 2_000,
  });
  rmSync(fakeBin, { recursive: true, force: true });
  return result;
}

test("start-dev runs the current worktree on the requested port", () => {
  const result = runStartScript(4317);
  assert.equal(
    result.status,
    0,
    `status=${result.status} signal=${result.signal} stderr=${result.stderr}`,
  );
  assert.match(result.stdout, new RegExp(`cwd=${projectRoot.replaceAll("/", "\\/")}`));
  assert.match(result.stdout, /args=run dev -- --port 4317/);
});

test("start-dev defaults to port 3000", () => {
  const result = runStartScript();
  assert.equal(
    result.status,
    0,
    `status=${result.status} signal=${result.signal} stderr=${result.stderr}`,
  );
  assert.match(result.stdout, /args=run dev -- --port 3000/);
});
