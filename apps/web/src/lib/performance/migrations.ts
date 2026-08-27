import type {
  MockPerformanceStateV2,
  PerformanceRuleVersion,
  PersistedPerformanceEnvelopeV1,
  PersistedPerformanceEnvelopeV2,
} from "./types";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isV1Envelope(value: unknown): value is PersistedPerformanceEnvelopeV1 {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<PersistedPerformanceEnvelopeV1>;
  const state = envelope.state;
  return envelope.schemaVersion === 1
    && !!state
    && typeof state === "object"
    && Number.isInteger(state.sourceRevision)
    && typeof state.currentMonth === "string"
    && !!state.currentTeams
    && !!state.lockedSnapshots
    && Array.isArray(state.salaryAdjustments);
}

export function migratePerformanceEnvelope(
  envelope: PersistedPerformanceEnvelopeV1,
): PersistedPerformanceEnvelopeV2 {
  if (!isV1Envelope(envelope)) throw new Error("绩效数据迁移失败：V1 数据不完整");
  const state = structuredClone(envelope.state);
  const seedSnapshot = state.lockedSnapshots.t1?.["2025-08"]
    ?? state.lockedSnapshots.t1?.[state.previousCompleteMonth];
  const appliedRule = seedSnapshot?.appliedRule ?? state.currentTeams.t1?.rule;
  if (!appliedRule) throw new Error("绩效数据迁移失败：无法确定 V1 规则");
  const v1: PerformanceRuleVersion = {
    id: appliedRule.ruleId || "rule-v1",
    version: "V1",
    effectiveMonth: "2025-08",
    status: "active",
    parameters: {
      commissionRate: appliedRule.commissionRate,
      cnyToJmdRate: appliedRule.cnyToJmdRate,
      minimumPayableCny: appliedRule.minimumPayableCny,
    },
    createdBy: "LiJian",
    createdAt: "2026-08-08T12:00:00-05:00",
    reason: "初始规则",
    previewInputHash: null,
    previewSourceRevision: null,
  };
  return {
    schemaVersion: 2,
    state: { ...state, ruleVersions: [v1] } as MockPerformanceStateV2,
  };
}

export function loadAndMigratePerformanceEnvelope(
  storage: StorageLike,
  key: string,
): PersistedPerformanceEnvelopeV2 {
  const serialized = storage.getItem(key);
  if (!serialized) throw new Error("绩效数据迁移失败：未找到数据");
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isV1Envelope(parsed)) throw new Error("V1 数据不完整");
    const migrated = migratePerformanceEnvelope(parsed);
    storage.setItem(key, JSON.stringify(migrated));
    return migrated;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("绩效数据迁移失败")) throw error;
    throw new Error(`绩效数据迁移失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
