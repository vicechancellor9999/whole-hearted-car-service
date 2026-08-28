import { appendFile, chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiRouteEvent } from "@/lib/server/ai-route-executor";

function eventsPath(): string {
  return process.env.AI_SERVICE_EVENTS_PATH?.trim()
    || path.join(process.cwd(), ".runtime", "ai-service-events.jsonl");
}

export async function recordAiServiceEvent(event: AiRouteEvent): Promise<void> {
  const destination = eventsPath();
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await appendFile(destination, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(destination, 0o600);
  const info = await stat(/* turbopackIgnore: true */ destination);
  if (info.size > 1_000_000) {
    const content = await readFile(/* turbopackIgnore: true */ destination, "utf8");
    const bounded = content.trim().split("\n").filter(Boolean).slice(-200).join("\n");
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${bounded}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  }
}

export async function getRecentAiServiceEvents(limit = 20): Promise<AiRouteEvent[]> {
  try {
    const content = await readFile(/* turbopackIgnore: true */ eventsPath(), "utf8");
    const lines = content.trim().split("\n").filter(Boolean).slice(-Math.max(1, Math.min(limit, 50)));
    return lines.flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as AiRouteEvent;
        return parsed && typeof parsed.timestamp === "string" ? [parsed] : [];
      } catch {
        return [];
      }
    }).reverse();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
