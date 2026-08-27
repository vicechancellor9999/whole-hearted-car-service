import type { MockCustomerVehicleE2EScenario } from "../../api/mock-customers";
import {
  LicenseExtractionError,
  validateLicenseExtractionResult,
  type LicenseExtractionClient,
  type LicenseExtractionInput,
  type LicenseExtractionResult,
} from "./types";

type Scenario = NonNullable<MockCustomerVehicleE2EScenario["licenseExtraction"]>;
const scenarioAttemptIndexes = new WeakMap<object, number>();

function cancelled(): LicenseExtractionError {
  return new LicenseExtractionError("LICENSE_EXTRACTION_CANCELLED", "License extraction cancelled");
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const timer = globalThis.setTimeout(finish, Math.max(0, delayMs));
    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(cancelled());
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

function waitForRelease(releaseEvent: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const target = typeof window === "undefined" ? undefined : window;
    if (!target) {
      reject(new LicenseExtractionError("LICENSE_EXTRACTION_UNAVAILABLE", "Mock release event is unavailable"));
      return;
    }
    const eventTarget = target;
    function cleanup() {
      eventTarget.removeEventListener(releaseEvent, release);
      signal.removeEventListener("abort", abort);
    }
    function release() {
      cleanup();
      resolve();
    }
    function abort() {
      cleanup();
      reject(cancelled());
    }
    eventTarget.addEventListener(releaseEvent, release, { once: true });
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function extractConfigured(
  scenario: Scenario,
  input: LicenseExtractionInput,
): Promise<LicenseExtractionResult> {
  if (input.signal.aborted) throw cancelled();
  if (scenario.kind === "error") {
    throw new LicenseExtractionError(scenario.code, "Mock license extraction failed");
  }
  if (scenario.kind === "deferred") {
    await waitForRelease(scenario.releaseEvent, input.signal);
    if (input.signal.aborted) throw cancelled();
    input.onProgress?.(100);
    return validateLicenseExtractionResult(scenario.result);
  }

  const attemptIndex = scenarioAttemptIndexes.get(scenario) ?? 0;
  scenarioAttemptIndexes.set(scenario, attemptIndex + 1);
  const configuredAttempt = scenario.attempts?.[attemptIndex];
  if (configuredAttempt) await waitForDelay(configuredAttempt.delayMs, input.signal);
  if (input.signal.aborted) throw cancelled();
  input.onProgress?.(100);
  return validateLicenseExtractionResult(configuredAttempt?.result ?? scenario.result);
}

export function createMockLicenseExtractionClient(scenario: Scenario): LicenseExtractionClient {
  return { extract: (input) => extractConfigured(scenario, input) };
}
