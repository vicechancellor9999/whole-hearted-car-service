import {
  getAiServiceSettings,
  type AiProviderId,
  type AiServiceSettings,
  type AiTaskId,
} from "@/lib/server/ai-service-settings";

export type AiAttemptContext = {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  baseUrl: string | null;
};

export type AiRouteEvent = {
  timestamp: string;
  task: AiTaskId;
  provider: AiProviderId;
  model: string;
  outcome: "success" | "fallback" | "failed";
  reason: AiFailureReason | null;
};

export type AiFailureReason =
  | "not_configured"
  | "rate_limited"
  | "authentication"
  | "timeout"
  | "network"
  | "upstream"
  | "invalid_output";

export type AiTaskResult<T> = {
  value: T;
  provider: AiProviderId;
  model: string;
  fallbackUsed: boolean;
  partial: boolean;
};

export class AiRouteUnavailableError extends Error {
  constructor(message = "已配置的 AI 服务暂时不可用") {
    super(message);
    this.name = "AiRouteUnavailableError";
  }
}

export async function executeAiTask<T>(options: {
  task: AiTaskId;
  attempt: (context: AiAttemptContext) => Promise<T>;
  assess?: (value: T) => { acceptable: boolean; score: number };
  settings?: AiServiceSettings;
  recordEvent?: (event: AiRouteEvent) => Promise<void>;
}): Promise<AiTaskResult<T>> {
  const settings = options.settings ?? await getAiServiceSettings();
  const route = settings.routes[options.task];
  if (!route.enabled) throw new AiRouteUnavailableError("这项 AI 任务已关闭");

  let eligibleIndex = -1;
  let best: (AiTaskResult<T> & { score: number }) | null = null;
  let hadEligibleStep = false;
  for (const step of route.steps) {
    const provider = settings.providers[step.provider];
    if (!provider.enabled || !provider.apiKey || (step.provider === "compatible" && !provider.baseUrl)) {
      await safeRecord(options.recordEvent, {
        timestamp: new Date().toISOString(),
        task: options.task,
        provider: step.provider,
        model: step.model,
        outcome: route.autoFallback ? "fallback" : "failed",
        reason: "not_configured",
      });
      if (!route.autoFallback) break;
      continue;
    }
    hadEligibleStep = true;
    eligibleIndex += 1;
    try {
      const value = await options.attempt({
        provider: step.provider,
        model: step.model,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
      });
      const assessment = options.assess?.(value) ?? { acceptable: true, score: 1 };
      if (assessment.acceptable) {
        await safeRecord(options.recordEvent, {
          timestamp: new Date().toISOString(), task: options.task, provider: step.provider,
          model: step.model, outcome: "success", reason: null,
        });
        return { value, provider: step.provider, model: step.model, fallbackUsed: eligibleIndex > 0, partial: false };
      }
      if (!best || assessment.score > best.score) {
        best = { value, provider: step.provider, model: step.model, fallbackUsed: eligibleIndex > 0, partial: true, score: assessment.score };
      }
      await safeRecord(options.recordEvent, {
        timestamp: new Date().toISOString(), task: options.task, provider: step.provider,
        model: step.model, outcome: route.autoFallback ? "fallback" : "failed", reason: "invalid_output",
      });
      if (!route.autoFallback) break;
    } catch (error) {
      if (isUserCancellation(error)) throw error;
      await safeRecord(options.recordEvent, {
        timestamp: new Date().toISOString(), task: options.task, provider: step.provider,
        model: step.model, outcome: route.autoFallback ? "fallback" : "failed", reason: classifyFailure(error),
      });
      if (!route.autoFallback) break;
    }
  }
  if (best) {
    return {
      value: best.value,
      provider: best.provider,
      model: best.model,
      fallbackUsed: best.fallbackUsed,
      partial: best.partial,
    };
  }
  throw new AiRouteUnavailableError(hadEligibleStep ? undefined : "尚未配置可用的 AI 服务");
}

function isUserCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function classifyFailure(error: unknown): AiFailureReason {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "authentication";
  if (status >= 500) return "upstream";
  if (error instanceof TypeError) return "network";
  return "invalid_output";
}

async function safeRecord(record: ((event: AiRouteEvent) => Promise<void>) | undefined, event: AiRouteEvent) {
  if (!record) return;
  try {
    await record(event);
  } catch {
    // Event persistence must never prevent the requested AI task.
  }
}
