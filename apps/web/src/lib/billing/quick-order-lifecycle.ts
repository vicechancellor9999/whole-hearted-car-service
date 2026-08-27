export type QuickOrderLifecycleKind =
  | "void"
  | "restore"
  | "record_paid_full"
  | "cancel_paid_full";

type QuickOrderLifecycleMutationCommon = Readonly<{
  contract: "quick_order_lifecycle_mutation_v1";
  orderId: string;
  expectedRevision: number;
  mutationId: string;
}>;

export type QuickOrderLifecycleMutationInput =
  | Readonly<QuickOrderLifecycleMutationCommon & {
      kind: "void";
      reason: string;
    }>
  | Readonly<QuickOrderLifecycleMutationCommon & {
      kind: Exclude<QuickOrderLifecycleKind, "void">;
    }>;

export interface QuickOrderLifecycleMutationResult {
  readonly contract: "quick_order_lifecycle_mutation_result_v2";
  readonly revision: number;
  readonly kind: QuickOrderLifecycleKind;
  readonly orderId: string;
  readonly affectedOrderIds: ReadonlyArray<string>;
  readonly committedAt: string;
}

export interface QuickOrderLifecyclePreflight {
  readonly contract: "quick_order_lifecycle_preflight_v1";
  readonly revision: number;
  readonly orderId: string;
  readonly allowedKinds: ReadonlyArray<QuickOrderLifecycleKind>;
}

const INPUT_COMMON_FIELDS = [
  "contract", "kind", "orderId", "expectedRevision", "mutationId",
] as const;
const INPUT_VOID_FIELDS = [...INPUT_COMMON_FIELDS, "reason"] as const;
const RESULT_FIELDS = [
  "contract", "revision", "kind", "orderId", "affectedOrderIds", "committedAt",
] as const;
const PREFLIGHT_FIELDS = [
  "contract", "revision", "orderId", "allowedKinds",
] as const;
export const QUICK_ORDER_LIFECYCLE_KIND_ORDER = [
  "void", "restore", "record_paid_full", "cancel_paid_full",
] as const satisfies ReadonlyArray<QuickOrderLifecycleKind>;
const LIFECYCLE_KINDS = new Set<QuickOrderLifecycleKind>(QUICK_ORDER_LIFECYCLE_KIND_ORDER);

function assertClosedDataObject(
  value: unknown,
  fields: ReadonlyArray<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const expected = new Set(fields);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== fields.length) {
    throw new TypeError(`${label} has an unexpected field count`);
  }
  for (const key of ownKeys) {
    if (typeof key !== "string" || !expected.has(key)) {
      throw new TypeError(`${label} has an unexpected field: ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an own enumerable data field, not an accessor`);
    }
    if (descriptor.value === undefined) {
      throw new TypeError(`${label}.${key} must not be undefined`);
    }
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new TypeError(`${label}.${field} is missing`);
    }
  }
}

function ownDataValue(value: Record<string, unknown>, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new TypeError(`${field} must be an own enumerable data field, not an accessor`);
  }
  return descriptor.value;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty`);
  }
}

function assertSafeNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertCanonicalIsoTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${label} must be an ISO timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
}

function lifecycleKindFromDescriptor(value: unknown, label: string): QuickOrderLifecycleKind {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !("value" in descriptor)
    || descriptor.value === undefined
  ) {
    throw new TypeError(`${label}.kind must be an own enumerable data field, not an accessor`);
  }
  if (!LIFECYCLE_KINDS.has(descriptor.value as QuickOrderLifecycleKind)) {
    throw new TypeError(`${label}.kind is invalid`);
  }
  return descriptor.value as QuickOrderLifecycleKind;
}

function assertClosedDenseUniqueIds(
  value: unknown,
  targetOrderId: string,
  kind: QuickOrderLifecycleKind,
): asserts value is string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("QuickOrder lifecycle affectedOrderIds must be a plain array");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new TypeError("QuickOrder lifecycle affectedOrderIds length is invalid");
  }
  const length = lengthDescriptor.value as number;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1 || ownKeys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key;
  })) {
    throw new TypeError("QuickOrder lifecycle affectedOrderIds must be dense and have no extra fields");
  }

  const orderIds = new Set<string>();
  let targetCount = 0;
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !("value" in descriptor)
      || descriptor.value === undefined
    ) {
      throw new TypeError(`QuickOrder lifecycle affectedOrderIds[${index}] must be an own enumerable data field`);
    }
    assertNonEmptyString(descriptor.value, `QuickOrder lifecycle affectedOrderIds[${index}]`);
    if (orderIds.has(descriptor.value)) {
      throw new TypeError("QuickOrder lifecycle affectedOrderIds contains a duplicate order");
    }
    orderIds.add(descriptor.value);
    if (descriptor.value === targetOrderId) targetCount += 1;
  }
  if (targetCount !== 1) {
    throw new TypeError("QuickOrder lifecycle affectedOrderIds must contain its target exactly once");
  }
  if ((kind === "record_paid_full" || kind === "cancel_paid_full") && length !== 1) {
    throw new TypeError("Paid-full lifecycle mutations must affect only their target order");
  }
}

function assertClosedCanonicalAllowedKinds(
  value: unknown,
): asserts value is QuickOrderLifecycleKind[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("QuickOrder lifecycle preflight allowedKinds must be a plain array");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor
    || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) {
    throw new TypeError("QuickOrder lifecycle preflight allowedKinds length is invalid");
  }
  const length = lengthDescriptor.value as number;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1 || ownKeys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key;
  })) {
    throw new TypeError("QuickOrder lifecycle preflight allowedKinds must be dense and have no extra fields");
  }

  let previousIndex = -1;
  const allowedKinds: QuickOrderLifecycleKind[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !("value" in descriptor)
      || descriptor.value === undefined
      || !LIFECYCLE_KINDS.has(descriptor.value as QuickOrderLifecycleKind)
    ) {
      throw new TypeError(`QuickOrder lifecycle preflight allowedKinds[${index}] is invalid`);
    }
    const kind = descriptor.value as QuickOrderLifecycleKind;
    const canonicalIndex = QUICK_ORDER_LIFECYCLE_KIND_ORDER.indexOf(kind);
    if (canonicalIndex <= previousIndex) {
      throw new TypeError("QuickOrder lifecycle preflight allowedKinds must be unique and canonically ordered");
    }
    previousIndex = canonicalIndex;
    allowedKinds.push(kind);
  }
  if (allowedKinds.includes("restore") && allowedKinds.length !== 1) {
    throw new TypeError("Restore must be the only allowed lifecycle operation");
  }
  if (allowedKinds.includes("record_paid_full") && allowedKinds.includes("cancel_paid_full")) {
    throw new TypeError("Record and cancel paid-full operations cannot both be allowed");
  }
}

export function assertQuickOrderLifecycleMutationInput(
  value: unknown,
): asserts value is QuickOrderLifecycleMutationInput {
  const kind = lifecycleKindFromDescriptor(value, "QuickOrder lifecycle mutation input");
  assertClosedDataObject(
    value,
    kind === "void" ? INPUT_VOID_FIELDS : INPUT_COMMON_FIELDS,
    "QuickOrder lifecycle mutation input",
  );

  const contract = ownDataValue(value, "contract");
  if (contract !== "quick_order_lifecycle_mutation_v1") {
    throw new TypeError("QuickOrder lifecycle mutation contract is invalid");
  }
  assertNonEmptyString(ownDataValue(value, "orderId"), "QuickOrder lifecycle mutation orderId");
  assertSafeNonNegativeInteger(
    ownDataValue(value, "expectedRevision"),
    "QuickOrder lifecycle mutation expectedRevision",
  );
  assertNonEmptyString(ownDataValue(value, "mutationId"), "QuickOrder lifecycle mutation mutationId");
  if (kind === "void") {
    assertNonEmptyString(ownDataValue(value, "reason"), "QuickOrder lifecycle mutation reason");
  }
}

export function assertQuickOrderLifecycleMutationResult(
  value: unknown,
): asserts value is QuickOrderLifecycleMutationResult {
  const kind = lifecycleKindFromDescriptor(value, "QuickOrder lifecycle mutation result");
  assertClosedDataObject(value, RESULT_FIELDS, "QuickOrder lifecycle mutation result");

  if (ownDataValue(value, "contract") !== "quick_order_lifecycle_mutation_result_v2") {
    throw new TypeError("QuickOrder lifecycle mutation result contract is invalid");
  }
  const revision = ownDataValue(value, "revision");
  assertSafeNonNegativeInteger(revision, "QuickOrder lifecycle mutation result revision");
  const orderId = ownDataValue(value, "orderId");
  assertNonEmptyString(orderId, "QuickOrder lifecycle mutation result orderId");
  const committedAt = ownDataValue(value, "committedAt");
  assertCanonicalIsoTimestamp(committedAt, "QuickOrder lifecycle mutation result committedAt");
  const affectedOrderIds = ownDataValue(value, "affectedOrderIds");
  assertClosedDenseUniqueIds(affectedOrderIds, orderId, kind);
}

export function assertQuickOrderLifecyclePreflight(
  value: unknown,
): asserts value is QuickOrderLifecyclePreflight {
  assertClosedDataObject(value, PREFLIGHT_FIELDS, "QuickOrder lifecycle preflight");
  if (ownDataValue(value, "contract") !== "quick_order_lifecycle_preflight_v1") {
    throw new TypeError("QuickOrder lifecycle preflight contract is invalid");
  }
  assertSafeNonNegativeInteger(
    ownDataValue(value, "revision"),
    "QuickOrder lifecycle preflight revision",
  );
  assertNonEmptyString(
    ownDataValue(value, "orderId"),
    "QuickOrder lifecycle preflight orderId",
  );
  assertClosedCanonicalAllowedKinds(ownDataValue(value, "allowedKinds"));
}
