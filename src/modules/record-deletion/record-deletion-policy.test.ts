import { describe, expect, it } from "vitest";
import {
  evaluateDeletionGraph,
  type DeletionFacts,
  type RecordDeletionFact,
} from "@formal/modules/record-deletion/record-deletion-policy";
import type {
  RecordKind,
  RecordLocator,
  RecordReference,
} from "@formal/modules/record-deletion/record-deletion-types";

const references: Record<RecordKind, RecordReference> = {
  personal_customer: { kind: "personal_customer", recordNo: "CUST-202608-0004", version: 1 },
  company_customer: { kind: "company_customer", recordNo: "COMP-202608-0004", version: 1 },
  vehicle: { kind: "vehicle", recordNo: "VEH-202608-0004", version: 1 },
  business_order: { kind: "business_order", recordNo: "KGN-WH-2026082700004", version: 1 },
  inspection_report: { kind: "inspection_report", recordNo: "IR-20260827-0004", version: 1 },
};

function fact(
  kind: RecordKind,
  overrides: Partial<RecordDeletionFact> = {},
): RecordDeletionFact {
  const reference = references[kind];
  const common = {
    reference,
    linkedPrimaryRecords: [] as RecordReference[],
    dependentCounts: {},
    releasedIdentityKinds: [],
  };
  if (kind === "personal_customer" || kind === "company_customer") {
    return { ...common, kind, externalBusinessFactCount: 0, ...overrides } as RecordDeletionFact;
  }
  if (kind === "vehicle") {
    return {
      ...common,
      kind,
      disputeCount: 0,
      presenceFactCount: 0,
      mileageRecordCount: 0,
      repairFactCount: 0,
      parkingFactCount: 0,
      ...overrides,
    } as RecordDeletionFact;
  }
  if (kind === "business_order") {
    return {
      ...common,
      kind,
      status: "waiting_assignment",
      repairRoundCount: 1,
      afterSalesRoundCount: 0,
      assignmentOrRepairEventCount: 0,
      workReturnCount: 0,
      mileageRecordCount: 0,
      intakePhotoCount: 0,
      paymentCount: 0,
      refundCount: 0,
      receiptCount: 0,
      documentCount: 0,
      handoffCount: 0,
      pickupOrDepartureCount: 0,
      parkingFactCount: 0,
      ...overrides,
    } as RecordDeletionFact;
  }
  return {
    ...common,
    kind,
    status: "draft",
    communicationCount: 0,
    correctionLinkCount: 0,
    formalDocumentReferenceCount: 0,
    ...overrides,
  } as RecordDeletionFact;
}

function graph(root: RecordReference, records: RecordDeletionFact[]): DeletionFacts {
  return { root, records };
}

function selected(...records: RecordReference[]): RecordLocator[] {
  return records.map(({ kind, recordNo }) => ({ kind, recordNo }));
}

describe("record deletion policy", () => {
  it("does not silently add a vehicle business order to the deletion set", () => {
    const vehicle = fact("vehicle", {
      linkedPrimaryRecords: [references.business_order],
    });
    const facts = graph(references.vehicle, [vehicle, fact("business_order")]);

    const preview = evaluateDeletionGraph(
      references.vehicle,
      selected(references.vehicle),
      facts,
    );

    expect(preview.eligible).toBe(false);
    expect(preview.selectableLinkedRecords).toEqual([references.business_order]);
    expect(preview.blockers).toContainEqual(expect.objectContaining({
      code: "HAS_BUSINESS_ORDER",
      linkedRecord: {
        kind: "business_order",
        recordNo: "KGN-WH-2026082700004",
      },
    }));
  });

  it("allows an eligible customer and vehicle when both are explicitly selected", () => {
    const customer = fact("personal_customer", {
      linkedPrimaryRecords: [references.vehicle],
      dependentCounts: { phone_registry: 1, license_records: 1 },
      releasedIdentityKinds: ["phone", "trn"],
    });
    const vehicle = fact("vehicle", {
      dependentCounts: { owner_history: 1, vehicle_attachments: 2 },
      releasedIdentityKinds: ["plate", "vin"],
    });
    const preview = evaluateDeletionGraph(
      references.personal_customer,
      selected(references.personal_customer, references.vehicle),
      graph(references.personal_customer, [customer, vehicle]),
    );

    expect(preview.eligible).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.dependentCounts).toEqual({
      license_records: 1,
      owner_history: 1,
      phone_registry: 1,
      vehicle_attachments: 2,
    });
    expect(preview.releasedIdentityKinds).toEqual(["phone", "trn", "plate", "vin"]);
  });

  it.each([
    ["submitted inspection", fact("inspection_report", { status: "submitted" }), "INSPECTION_SUBMITTED"],
    ["paid order", fact("business_order", { paymentCount: 1 }), "HAS_PAYMENT"],
    ["assigned order", fact("business_order", { status: "assigned" }), "ORDER_PROGRESS_STARTED"],
    ["vehicle dispute", fact("vehicle", { disputeCount: 1 }), "HAS_VEHICLE_DISPUTE"],
  ])("blocks %s", (_name, recordFact, blockerCode) => {
    const preview = evaluateDeletionGraph(
      recordFact.reference,
      selected(recordFact.reference),
      graph(recordFact.reference, [recordFact]),
    );
    expect(preview.eligible).toBe(false);
    expect(preview.blockers).toContainEqual(expect.objectContaining({ code: blockerCode }));
  });

  it("allows a selected draft inspection to leave with its empty source order", () => {
    const order = fact("business_order", {
      linkedPrimaryRecords: [references.inspection_report],
    });
    const preview = evaluateDeletionGraph(
      references.business_order,
      selected(references.business_order, references.inspection_report),
      graph(references.business_order, [order, fact("inspection_report")]),
    );
    expect(preview.eligible).toBe(true);
  });

  it("changes the preview fingerprint when a selected record version changes", () => {
    const original = graph(references.vehicle, [fact("vehicle")]);
    const changedVehicle = {
      ...references.vehicle,
      version: 2,
    };
    const changed = graph(changedVehicle, [fact("vehicle", { reference: changedVehicle })]);

    const first = evaluateDeletionGraph(
      original.root,
      selected(references.vehicle),
      original,
    );
    const second = evaluateDeletionGraph(
      changed.root,
      selected(changedVehicle),
      changed,
    );
    expect(first.previewFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(second.previewFingerprint).not.toBe(first.previewFingerprint);
  });
});
