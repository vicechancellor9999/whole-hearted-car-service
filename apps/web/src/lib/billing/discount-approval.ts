import { calculateQuotedChargeTotals, type QuotedChargeLine } from "./quoted-charges";

const EVIDENCE_FIELDS = new Set(["document", "operationAccount", "rawStrokes", "signedAt", "mutationId", "categoryRatios"]);
const DOCUMENT_FIELDS = new Set(["kind", "id"]);
const OPERATION_ACCOUNT_FIELDS = new Set(["id", "name"]);
const POINT_FIELDS = new Set(["x", "y", "time"]);
const CATEGORY_RATIOS_FIELDS = new Set(["labor", "parts"]);
const RATIO_FIELDS = new Set(["grossJmd", "discountJmd", "ratio", "exceedsThreshold"]);

export interface DiscountCategoryRatio {
  readonly grossJmd: number;
  readonly discountJmd: number;
  readonly ratio: number;
  readonly exceedsThreshold: boolean;
}

export interface DiscountApprovalRequirement {
  readonly required: boolean;
  readonly labor: DiscountCategoryRatio;
  readonly parts: DiscountCategoryRatio;
}

export interface SignatureStrokePoint {
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

export interface DiscountApprovalEvidence {
  readonly document: {
    readonly kind: "quotation" | "business_order" | "invoice";
    readonly id: string;
  };
  readonly operationAccount: {
    readonly id: string;
    readonly name: string;
  };
  readonly rawStrokes: ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>;
  readonly signedAt: string;
  readonly mutationId: string;
  readonly categoryRatios: {
    readonly labor: DiscountCategoryRatio;
    readonly parts: DiscountCategoryRatio;
  };
}

/** Stable store-wide identity for one exact ordered raw-stroke payload. */
export function discountSignatureStrokeDigest(
  rawStrokes: DiscountApprovalEvidence["rawStrokes"],
): string {
  const canonical = JSON.stringify(rawStrokes.map((stroke) => stroke.map((point) => [point.x, point.y, point.time])));
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `raw-strokes-fnv64-${hash.toString(16).padStart(16, "0")}`;
}

function ratio(grossJmd: number, discountJmd: number, exceedsThreshold: boolean): DiscountCategoryRatio {
  return {
    grossJmd,
    discountJmd,
    ratio: grossJmd === 0 ? 0 : discountJmd / grossJmd,
    exceedsThreshold,
  };
}

export function discountApprovalRequirement(lines: ReadonlyArray<QuotedChargeLine>): DiscountApprovalRequirement {
  const totals = calculateQuotedChargeTotals(lines);
  const labor = ratio(
    totals.laborGrossJmd,
    totals.laborDiscountJmd,
    totals.laborGrossJmd > 0
      && BigInt(totals.laborDiscountJmd) * 100n > BigInt(totals.laborGrossJmd) * 20n,
  );
  const parts = ratio(
    totals.partsGrossJmd,
    totals.partsDiscountJmd,
    totals.partsGrossJmd > 0
      && BigInt(totals.partsDiscountJmd) * 1_000n > BigInt(totals.partsGrossJmd) * 125n,
  );
  return { required: labor.exceedsThreshold || parts.exceedsThreshold, labor, parts };
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} must not be empty`);
}

function assertClosedObject(
  value: object,
  fields: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.has(key)) {
      throw new RangeError(`${label} contains an unexpected field: ${String(key)}`);
    }
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new RangeError(`${label} is missing required field: ${field}`);
    }
  }
}

function assertClosedArray(value: ReadonlyArray<unknown>, label: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key))) {
      throw new RangeError(`${label} contains an unexpected field: ${String(key)}`);
    }
  }
}

function validateCategoryRatio(
  value: DiscountCategoryRatio,
  label: string,
  thresholdMultiplier: bigint,
  grossMultiplier: bigint,
): void {
  if (value === null || typeof value !== "object") throw new TypeError(`${label} ratio must be an object`);
  assertClosedObject(value, RATIO_FIELDS, `${label} ratio schema`);
  if (!Number.isSafeInteger(value.grossJmd) || value.grossJmd < 0) throw new RangeError(`${label} gross must be safe JMD`);
  if (!Number.isSafeInteger(value.discountJmd) || value.discountJmd < 0 || value.discountJmd > value.grossJmd) {
    throw new RangeError(`${label} discount must be within gross`);
  }
  const derivedRatio = value.grossJmd === 0 ? 0 : value.discountJmd / value.grossJmd;
  if (value.ratio !== derivedRatio) throw new RangeError(`${label} ratio must match its money facts`);
  if (typeof value.exceedsThreshold !== "boolean") throw new TypeError(`${label} threshold flag must be boolean`);
  const derivedThreshold = value.grossJmd > 0
    && BigInt(value.discountJmd) * thresholdMultiplier > BigInt(value.grossJmd) * grossMultiplier;
  if (value.exceedsThreshold !== derivedThreshold) {
    throw new RangeError(`${label} threshold flag must match its exact money facts`);
  }
}

export function validateDiscountApprovalEvidence(evidence: DiscountApprovalEvidence): void {
  if (evidence === null || typeof evidence !== "object") throw new TypeError("discount approval evidence is required");
  assertClosedObject(evidence, EVIDENCE_FIELDS, "discount approval evidence schema");
  if (evidence.document === null || typeof evidence.document !== "object") throw new TypeError("document is required");
  assertClosedObject(evidence.document, DOCUMENT_FIELDS, "discount approval document schema");
  if (!(["quotation", "business_order", "invoice"] as const).includes(evidence.document.kind)) {
    throw new RangeError("discount evidence document kind is invalid");
  }
  assertNonEmptyString(evidence.document.id, "document id");
  if (evidence.operationAccount === null || typeof evidence.operationAccount !== "object") {
    throw new TypeError("operation account is required");
  }
  assertClosedObject(evidence.operationAccount, OPERATION_ACCOUNT_FIELDS, "operation account schema");
  assertNonEmptyString(evidence.operationAccount.id, "operation account id");
  assertNonEmptyString(evidence.operationAccount.name, "operation account name");
  assertNonEmptyString(evidence.mutationId, "mutation id");
  if (
    typeof evidence.signedAt !== "string"
    || Number.isNaN(Date.parse(evidence.signedAt))
    || !/-05:00$/.test(evidence.signedAt)
  ) {
    throw new RangeError("signed time must be an ISO Jamaica instant with -05:00 offset");
  }
  if (!Array.isArray(evidence.rawStrokes) || !evidence.rawStrokes.some((stroke) => Array.isArray(stroke) && stroke.length > 0)) {
    throw new RangeError("raw signature stroke payload must contain at least one pen point");
  }
  assertClosedArray(evidence.rawStrokes, "raw strokes schema");
  for (const stroke of evidence.rawStrokes) {
    if (!Array.isArray(stroke)) throw new TypeError("each raw stroke must be an ordered point array");
    assertClosedArray(stroke, "raw stroke schema");
    for (const point of stroke) {
      if (
        point === null
        || typeof point !== "object"
        || !Number.isFinite(point.x)
        || !Number.isFinite(point.y)
        || !Number.isFinite(point.time)
      ) {
        throw new RangeError("raw stroke points must contain finite x, y, and time values");
      }
      assertClosedObject(point, POINT_FIELDS, "raw stroke point schema");
    }
  }
  if (evidence.categoryRatios === null || typeof evidence.categoryRatios !== "object") {
    throw new TypeError("category ratios are required");
  }
  assertClosedObject(evidence.categoryRatios, CATEGORY_RATIOS_FIELDS, "category ratios schema");
  validateCategoryRatio(evidence.categoryRatios.labor, "labor", 100n, 20n);
  validateCategoryRatio(evidence.categoryRatios.parts, "parts", 1_000n, 125n);
}
