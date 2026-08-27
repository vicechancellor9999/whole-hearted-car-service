import { expect, test } from "@playwright/test";
import {
  isCustomerEnvelopeV3,
  isLegacyCustomerEnvelopeV1,
  isLegacyCustomerEnvelopeV2,
  migrateCustomerVehicleEnvelope,
} from "../../src/lib/customers/migrations";
import { createMockCustomerVehicleStore } from "../../src/lib/api/mock-customers";
import type { EvidenceAsset } from "../../src/lib/customers/verification-types";

const MIGRATED_AT = "2026-08-12T12:00:00.000Z";
const superadmin = { actorId: "emp-001", role: "superadmin" };

type MutableLegacyEnvelope = {
  schemaVersion: number;
  state: {
    sourceRevision: number;
    customers: Record<string, unknown>[];
    vehicles: Record<string, unknown>[];
    relationships: Record<string, unknown>[];
    auditRecords: Record<string, unknown>[];
  };
};

function pngEvidence(id: string) {
  return {
    id,
    fileName: `${id}.png`,
    url: "data:image/png;base64,iVBORw0KGgo=",
    mimeType: "image/png" as const,
    sizeBytes: 8,
    createdAt: MIGRATED_AT,
    createdBy: "emp-001",
  };
}

function pdfEvidence(id: string) {
  return {
    id,
    fileName: `${id}.pdf`,
    url: "data:application/pdf;base64,JVBERi0=",
    mimeType: "application/pdf" as const,
    sizeBytes: 5,
    createdAt: MIGRATED_AT,
    createdBy: "emp-001",
  };
}

function legacyCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: "CUST-USER-991",
    customerType: "individual",
    name: "Jason Wong",
    nameZh: null,
    organizationName: null,
    salutation: null,
    language: "English",
    phone: "+1 876 555 0991",
    secondaryPhone: null,
    whatsapp: null,
    email: "jason.wong@example.test",
    preferredChannel: "phone",
    address: "Kingston",
    gender: null,
    birthDate: null,
    trn: null,
    licensePhotoUrl: null,
    source: "walk-in",
    riskLevel: "normal",
    riskNote: null,
    riskFlags: [],
    verification: {
      otpVerified: false,
      otpVerifiedAt: null,
      kycStatus: "pending",
      kycVerifiedAt: null,
      agreementStatus: "pending",
      agreementVersion: null,
      agreementSignedAt: null,
    },
    creditEligibility: {
      eligible: false,
      registeredAt: null,
      registeredBy: null,
      signatureNote: null,
      signatureDataUrl: null,
      cancelledAt: null,
      cancelledBy: null,
    },
    tags: ["legacy-user-value"],
    profileCompleteness: "incomplete",
    recentBusiness: null,
    recentBusinessDate: null,
    activeBusinessCount: 0,
    status: "active",
    contacts: [],
    orders: [],
    paymentSummary: { totalAmount: 0, paidAmount: 0, unpaidAmount: 0, orderCount: 0 },
    communications: [],
    tasks: [],
    attachments: [],
    notes: [{ id: "NOTE-991", content: "Preserve me", author: "emp-1", time: "2026-01-01T00:00:00.000Z" }],
    changeHistory: [],
    revision: 7,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function legacyVehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: "VEH-USER-991",
    plate: "991 ZZ",
    vin: "1HGBH41JXMN299991",
    engineNumber: null,
    make: "Honda",
    model: "Fit",
    makeZh: "本田",
    modelZh: "飞度",
    variant: null,
    year: 2020,
    color: null,
    powertrain: null,
    bodyType: null,
    seating: null,
    ccRating: null,
    fuelType: null,
    mileage: 50000,
    mileageUnit: "km",
    mileageRecordedAt: "2026-01-01T00:00:00.000Z",
    usage: null,
    specialNotes: null,
    recentService: "Legacy service",
    recentServiceDate: "2026-01-01T00:00:00.000Z",
    photos: [{ id: "PHOTO-991", kind: "registration", url: "/seed-photos/registration-sample-1.jpg", note: "", linkedOrderId: null, uploadedBy: "emp-1", uploadedAt: "2026-01-01T00:00:00.000Z" }],
    linkedOrderCount: 1,
    totalAmount: 100,
    unpaidAmount: 0,
    status: "off_site",
    serviceHistory: [],
    partsNeeds: [{ id: "PART-991", name: "Filter", urgency: "normal", status: "pending", estimatedCost: 10 }],
    tasks: [{ id: "VEH-TASK-991", title: "User task", status: "pending", assignee: "emp-1", dueAt: null }],
    attachments: [],
    changeHistory: [],
    revision: 4,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function genuineV2Envelope(customers = [legacyCustomer()]) {
  return {
    schemaVersion: 2,
    state: {
      sourceRevision: 9,
      customers,
      vehicles: [legacyVehicle()],
      relationships: [{
        id: "REL-991",
        vehicleId: "VEH-USER-991",
        customerId: customers[0]!.id,
        startedAt: "2025-01-01T00:00:00.000Z",
        endedAt: null,
      }],
      auditRecords: [] as Record<string, unknown>[],
    },
  };
}

function genuineV1Envelope() {
  const {
    nameZh: _nameZh,
    riskFlags: _riskFlags,
    verification: _verification,
    creditEligibility: _creditEligibility,
    ...customer
  } = legacyCustomer();
  const {
    makeZh: _makeZh,
    modelZh: _modelZh,
    photos: _photos,
    ...vehicle
  } = legacyVehicle();
  return {
    schemaVersion: 1,
    state: {
      sourceRevision: 3,
      customers: [customer],
      vehicles: [vehicle],
      relationships: [{
        id: "REL-991",
        vehicleId: "VEH-USER-991",
        customerId: "CUST-USER-991",
        startedAt: "2025-01-01T00:00:00.000Z",
        endedAt: null,
      }],
      auditRecords: [] as Record<string, unknown>[],
    },
  };
}

test("recognizes genuine legacy envelopes without applying the v3 guard first", () => {
  const v2 = genuineV2Envelope();
  const v1 = genuineV1Envelope();
  expect(isLegacyCustomerEnvelopeV1(v1)).toBe(true);
  expect(isLegacyCustomerEnvelopeV2(v2)).toBe(true);
  expect(isCustomerEnvelopeV3(v2)).toBe(false);
});

test("migrates stale organization fields off genuine v1 and v2 individuals and records the cleanup", () => {
  const sources = [genuineV1Envelope(), genuineV2Envelope()];
  for (const source of sources) {
    const customer = source.state.customers[0]! as Record<string, unknown>;
    customer.organizationName = "Legacy Fleet Ltd";
    customer.primaryContactRole = "Former fleet contact";

    expect(source.schemaVersion === 1
      ? isLegacyCustomerEnvelopeV1(source)
      : isLegacyCustomerEnvelopeV2(source)).toBe(true);

    const migrated = migrateCustomerVehicleEnvelope(source, MIGRATED_AT);
    expect(migrated).not.toBeNull();
    expect(migrated!.state.customers[0]).toMatchObject({
      id: "CUST-USER-991",
      customerType: "individual",
      organizationName: null,
      primaryContactRole: null,
      revision: 7,
      notes: [expect.objectContaining({ id: "NOTE-991", content: "Preserve me" })],
    });
    expect(migrated!.state.auditEvents.find((event) => event.id === "MIGRATION-CUST-USER-991")).toMatchObject({
      customerId: "CUST-USER-991",
      eventType: "migration",
      changes: expect.arrayContaining([
        { field: "organizationName", before: "Legacy Fleet Ltd", after: null },
        { field: "primaryContactRole", before: "Former fleet contact", after: null },
      ]),
    });
    expect(migrateCustomerVehicleEnvelope(migrated, MIGRATED_AT)).toEqual(migrated);
  }
});

test("sanitizes legacy audit data URLs without discarding the non-sensitive reason and summary", () => {
  const source = genuineV2Envelope();
  (source.state.customers[0]! as Record<string, unknown>).communications = [{
    id: "COMM-LEGACY-SAFE",
    channel: "phone",
    direction: "inbound",
    summary: "Customer called about pickup | data:image/png;base64,COMM_SECRET",
    operator: "emp-001",
    time: "2026-01-02T00:00:00.000Z",
  }];
  source.state.auditRecords.push({
    id: "AUDIT-LEGACY-SAFE",
    entityType: "customer",
    entityId: "CUST-USER-991",
    action: "updated",
    actorId: "emp-001",
    occurredAt: "2026-01-03T00:00:00.000Z",
    reason: "Approved after review | data:application/pdf;base64,AUDIT_SECRET",
    before: null,
    after: structuredClone(source.state.customers[0]!),
  });

  const migrated = migrateCustomerVehicleEnvelope(source, MIGRATED_AT);
  expect(migrated).not.toBeNull();
  const raw = JSON.stringify(migrated);
  expect(raw).not.toMatch(/data\s*:/i);
  expect(raw).not.toContain("COMM_SECRET");
  expect(raw).not.toContain("AUDIT_SECRET");
  expect(migrated!.state.auditEvents.find((event) => event.id === "AUDIT-LEGACY-SAFE")?.reason)
    .toContain("Approved after review");
  expect(migrated!.state.auditEvents.find((event) => event.id === "COMM-LEGACY-SAFE")?.changes)
    .toContainEqual(expect.objectContaining({ field: "summary", after: expect.stringContaining("Customer called about pickup") }));
});

test("migrates a genuine v2 Alicia tuple without resetting user records", () => {
  const migrated = migrateCustomerVehicleEnvelope(genuineV2Envelope([
    legacyCustomer({ id: "CUST-UAT-001", name: "Alicia Bennett", nameZh: "黄艾丽" }),
    legacyCustomer(),
  ]), MIGRATED_AT);

  expect(migrated?.schemaVersion).toBe(3);
  expect(migrated?.state.customers).toHaveLength(2);
  expect(migrated?.state.customers[0]).toMatchObject({
    nameSourceScript: "en",
    nameSourceValue: "Alicia Bennett",
    nameZh: "艾丽西亚·贝内特",
    nameEn: "Alicia Bennett",
    transliterationStatus: "confirmed",
  });
  expect(migrated?.state.customers[1]).toMatchObject({ id: "CUST-USER-991", revision: 7 });
});

test("keeps an unknown legacy English name single-language for review", () => {
  const migrated = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT);
  expect(migrated?.state.customers[0]).toMatchObject({
    nameSourceScript: "en",
    nameSourceValue: "Jason Wong",
    nameZh: null,
    nameEn: "Jason Wong",
    transliterationMethod: null,
    transliterationVersion: null,
    transliterationStatus: "needs_transliteration_review",
  });
});

test("keeps a legacy organization without a contact viewable for profile review", () => {
  const migrated = migrateCustomerVehicleEnvelope(genuineV2Envelope([
    legacyCustomer({ customerType: "organization", organizationName: "Legacy Fleet Ltd", name: null }),
  ]), MIGRATED_AT);
  expect(migrated?.state.customers[0]).toMatchObject({
    customerType: "organization",
    organizationName: "Legacy Fleet Ltd",
    nameSourceScript: null,
    nameSourceValue: null,
    nameEn: null,
    transliterationStatus: "needs_profile_review",
  });
});

test("turns unsupported legacy completion into evidence gaps without inventing evidence", () => {
  const migrated = migrateCustomerVehicleEnvelope(genuineV2Envelope([
    legacyCustomer({
      verification: {
        otpVerified: true,
        otpVerifiedAt: "2025-03-01T00:00:00.000Z",
        kycStatus: "verified",
        kycVerifiedAt: "2025-03-02T00:00:00.000Z",
        agreementStatus: "signed",
        agreementVersion: "v1.2",
        agreementSignedAt: "2025-03-03T00:00:00.000Z",
      },
    }),
  ]), MIGRATED_AT);
  const archive = migrated!.state.customers[0]!.verificationArchive;
  expect(archive.otpRecords).toEqual([]);
  expect(archive.kycRecords).toEqual([]);
  expect(archive.agreementRecords).toEqual([]);
  expect(archive.evidenceGaps.map((gap) => gap.kind)).toEqual(["otp", "kyc", "agreement"]);
});

test("preserves user facts, compacts metadata, deletes only exact placeholders, and strips data URLs from audit", () => {
  const customer = legacyCustomer({
    communications: [
      { id: "COMM-UAT-001", channel: "whatsapp", direction: "outbound", summary: "placeholder", operator: "seed", time: "2026-01-01T00:00:00.000Z" },
      { id: "COMM-USER-991", channel: "phone", direction: "inbound", summary: "real user metadata", operator: "emp-1", time: "2026-01-02T00:00:00.000Z" },
    ],
    tasks: [
      { id: "TASK-CUST-UAT-001", title: "placeholder", status: "pending", assignee: "seed", dueAt: null },
      { id: "TASK-USER-991", title: "real user task", status: "in_progress", assignee: "emp-1", dueAt: "2026-02-01T00:00:00.000Z" },
    ],
    attachments: [
      { id: "ATT-CUST-UAT-001", fileName: "placeholder.pdf", category: "seed", uploadedBy: "seed", uploadedAt: "2026-01-01T00:00:00.000Z" },
      { id: "ATT-USER-991", fileName: "real.pdf", category: "legacy", uploadedBy: "emp-1", uploadedAt: "2026-01-03T00:00:00.000Z" },
    ],
    changeHistory: [{ id: "CHANGE-991", field: "signatureDataUrl", from: "data:image/png;base64,OLD", to: "data:image/png;base64,NEW", operator: "emp-1", time: "2026-01-04T00:00:00.000Z" }],
  });
  const source = genuineV2Envelope([customer]);
  source.state.vehicles[0] = legacyVehicle({
    attachments: [{
      id: "ATT-VEH-USER-991", fileName: "vehicle-meta.pdf", category: "legacy",
      uploadedBy: "emp-1", uploadedAt: "2026-01-05T00:00:00.000Z",
    }],
    changeHistory: [{
      id: "CHANGE-VEH-991", field: "mileage", from: "40000", to: "50000",
      operator: "emp-1", time: "2026-01-06T00:00:00.000Z",
    }],
  });
  const migrated = migrateCustomerVehicleEnvelope(source, MIGRATED_AT)!;
  expect(migrated.state.customers[0]!.notes).toEqual(customer.notes);
  expect(migrated.state.vehicles[0]).toMatchObject({
    photos: customer === null ? [] : expect.any(Array),
    partsNeeds: expect.any(Array),
    tasks: expect.any(Array),
  });
  expect(migrated.state.auditEvents.map((event) => event.id)).toEqual(expect.arrayContaining([
    "COMM-USER-991", "TASK-USER-991", "ATT-USER-991", "CHANGE-991",
  ]));
  expect(migrated.state.auditEvents.map((event) => event.id)).not.toEqual(expect.arrayContaining([
    "COMM-UAT-001", "TASK-CUST-UAT-001", "ATT-CUST-UAT-001",
  ]));
  expect(JSON.stringify(migrated.state.auditEvents)).not.toContain("data:image");
  expect(migrated.state.auditEvents.flatMap((event) => event.changes)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: "fileName", after: "vehicle-meta.pdf" }),
      expect.objectContaining({ field: "mileage", before: "40000", after: "50000" }),
    ]),
  );
  for (const change of migrated.state.auditEvents.flatMap((event) => event.changes)) {
    expect(["string", "number", "boolean"].includes(typeof change.before) || change.before === null).toBe(true);
    expect(["string", "number", "boolean"].includes(typeof change.after) || change.after === null).toBe(true);
    expect(typeof change.after === "string" ? change.after : "").not.toContain("{\"");
  }
  expect(migrated.state.mutationReceipts).toEqual([]);
});

test("repairs overlapping v1 current relationships deterministically and migration is idempotent", () => {
  const source = genuineV1Envelope();
  source.state.relationships.push({
    id: "REL-991-NEW",
    vehicleId: "VEH-USER-991",
    customerId: "CUST-USER-991",
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: null,
  });
  const once = migrateCustomerVehicleEnvelope(source, MIGRATED_AT)!;
  expect(once.state.relationships.filter((item) => item.endedAt === null)).toEqual([
    expect.objectContaining({ id: "REL-991-NEW" }),
  ]);
  expect(once.state.relationships.find((item) => item.id === "REL-991")?.endedAt)
    .toBe("2026-07-01T00:00:00.000Z");
  expect(migrateCustomerVehicleEnvelope(once, MIGRATED_AT)).toEqual(once);
});

test("repairs overlapping v2 relationships in top-level state and audit snapshots", () => {
  const source = genuineV2Envelope();
  const overlap = {
    id: "REL-991-NEW",
    vehicleId: "VEH-USER-991",
    customerId: "CUST-USER-991",
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: null,
  };
  source.state.relationships.push(overlap);
  source.state.auditRecords.push({
    id: "AUDIT-VEH-991",
    entityType: "vehicle",
    entityId: "VEH-USER-991",
    action: "updated",
    actorId: "emp-1",
    occurredAt: MIGRATED_AT,
    reason: "legacy handover",
    before: legacyVehicle(),
    after: legacyVehicle({ mileage: 50001 }),
    beforeRelationships: source.state.relationships,
    afterRelationships: source.state.relationships,
  });

  expect(isLegacyCustomerEnvelopeV2(source)).toBe(true);
  const migrated = migrateCustomerVehicleEnvelope(source, MIGRATED_AT)!;
  const audit = migrated.state.auditEvents.find((event) => event.id === "AUDIT-VEH-991");
  expect(audit && "beforeRelationships" in audit
    ? audit.beforeRelationships.filter((relationship) => relationship.endedAt === null)
    : []).toHaveLength(1);
  expect(audit && "afterRelationships" in audit
    ? audit.afterRelationships.filter((relationship) => relationship.endedAt === null)
    : []).toHaveLength(1);
});

test("legacy v1 and v2 guards reject corrupt present nested facts and audit snapshots instead of dropping them", () => {
  const corruptions: Array<(value: MutableLegacyEnvelope) => void> = [
    (value) => { value.state.customers[0]!.notes = "CORRUPT_NOT_ARRAY"; },
    (value) => { value.state.customers[0]!.riskFlags = [{ id: "RISK-BROKEN" }]; },
    (value) => { value.state.customers[0]!.creditEligibility = { eligible: "yes" }; },
    (value) => { value.state.vehicles[0]!.photos = "CORRUPT_NOT_ARRAY"; },
    (value) => { value.state.vehicles[0]!.partsNeeds = [{ id: "PART-BROKEN" }]; },
    (value) => { value.state.vehicles[0]!.tasks = "CORRUPT_NOT_ARRAY"; },
    (value) => { value.state.vehicles[0]!.attachments = [{ id: "ATT-BROKEN" }]; },
    (value) => {
      const after = structuredClone(value.state.customers[0]!);
      after.notes = "CORRUPT_AUDIT_SNAPSHOT";
      value.state.auditRecords = [{
        id: "AUDIT-BROKEN",
        entityType: "customer",
        entityId: after.id,
        action: "updated",
        actorId: "emp-001",
        occurredAt: MIGRATED_AT,
        reason: null,
        before: null,
        after,
      }];
    },
  ];

  for (const [schemaVersion, build, guard] of [
    [1, genuineV1Envelope, isLegacyCustomerEnvelopeV1],
    [2, genuineV2Envelope, isLegacyCustomerEnvelopeV2],
  ] as const) {
    for (const corrupt of corruptions) {
      const candidate = structuredClone(build()) as unknown as MutableLegacyEnvelope;
      corrupt(candidate);
      expect(guard(candidate), `schema v${schemaVersion} should reject corrupt nested data`).toBe(false);
      expect(migrateCustomerVehicleEnvelope(candidate, MIGRATED_AT)).toBeNull();
    }
  }
});

test("schema v3 guard rejects malformed nested facts, duplicate IDs, and non-whitelisted audit fields", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const corruptions: Array<(value: typeof valid) => void> = [
    (value) => { (value.state.customers[0] as unknown as { language: unknown }).language = 42; },
    (value) => { (value.state.customers[0].verificationArchive.otpRecords as unknown[]).push({ id: "OTP-BROKEN" }); },
    (value) => { (value.state.customers[0].riskFlags as unknown[]).push({ id: "RISK-BROKEN" }); },
    (value) => { (value.state.customers[0] as unknown as { creditEligibility: unknown }).creditEligibility = { eligible: "yes" }; },
    (value) => { (value.state.customers[0].notes as unknown[]).push({ id: "NOTE-BROKEN", time: "yesterday" }); },
    (value) => { (value.state.vehicles[0].photos as unknown[]).push({ id: "PHOTO-BROKEN", kind: "mystery" }); },
    (value) => { value.state.customers.push(structuredClone(value.state.customers[0])); },
    (value) => {
      (value.state.auditEvents[0].changes as Array<{
        field: string; before: string | null; after: string | null;
      }>).push({ field: "recursivePayload", before: null, after: "{}" });
    },
    (value) => {
      const event = value.state.auditEvents.find((candidate) => "customerId" in candidate)!;
      (event as { customerId: string }).customerId = "CUST-MISSING";
    },
  ];

  expect(isCustomerEnvelopeV3(valid)).toBe(true);
  for (const corrupt of corruptions) {
    const candidate = structuredClone(valid);
    corrupt(candidate);
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 guard enforces Task 2 evidence, KYC, paper-agreement, and real-calendar invariants", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;

  const validKyc = structuredClone(valid);
  (validKyc.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push({
    id: "KYC-VALID",
    documentType: "drivers_license",
    frontAsset: pngEvidence("EVIDENCE-KYC-FRONT"),
    submittedAt: MIGRATED_AT,
  });
  expect(isCustomerEnvelopeV3(validKyc)).toBe(true);

  const invalidKycPdf = structuredClone(validKyc);
  (invalidKycPdf.state.customers[0]!.verificationArchive.kycRecords[0] as unknown as {
    frontAsset: unknown;
  }).frontAsset = pdfEvidence("EVIDENCE-KYC-PDF");

  const invalidUrl = structuredClone(valid);
  invalidUrl.state.vehicles[0]!.attachments.push({
    ...pngEvidence("EVIDENCE-JAVASCRIPT"),
    url: "javascript:alert(1)",
  });

  const invalidSize = structuredClone(valid);
  invalidSize.state.vehicles[0]!.attachments.push({
    ...pngEvidence("EVIDENCE-SIZE-MISMATCH"),
    sizeBytes: 7,
  });

  const partialPaperLocation = structuredClone(valid);
  (partialPaperLocation.state.customers[0]!.verificationArchive.agreementRecords as unknown[]).push({
    id: "AGREEMENT-PAPER-PARTIAL",
    version: "v1.2",
    medium: "paper",
    signedAt: MIGRATED_AT,
    signedBy: "Jason Wong",
    recordedBy: "emp-001",
    paperScanAsset: pdfEvidence("EVIDENCE-PAPER-SCAN"),
    physicalRecordNumber: "BOX-17",
  });

  const impossibleDate = structuredClone(valid);
  (impossibleDate.state.customers[0] as unknown as { updatedAt: string }).updatedAt = "2026-02-31T12:00:00.000Z";

  for (const candidate of [invalidKycPdf, invalidUrl, invalidSize, partialPaperLocation, impossibleDate]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 accepts scoped organization-contact KYC and exact onboarding evidence-gap branches", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  (valid.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push({
    id: "KYC-ORG-CONTACT-VALID",
    documentType: "drivers_license",
    frontAsset: pngEvidence("EVIDENCE-ORG-CONTACT-VALID"),
    submittedAt: MIGRATED_AT,
    subjectType: "organization_primary_contact",
    subjectProfile: {
      name: "  顾明轩  ",
      birthDate: "1988-06-07",
      sex: "M",
      address: "  14 Contact Lane, Kingston  ",
    },
  });
  (valid.state.customers[0]!.verificationArchive.evidenceGaps as unknown as Array<Record<string, unknown>>).push({
    kind: "otp",
    reason: "onboarding_incomplete",
    status: "not_requested",
    recordedAt: MIGRATED_AT,
    recordedBy: "emp-001",
  }, {
    kind: "kyc",
    reason: "onboarding_incomplete",
    subjectType: "organization_primary_contact",
    status: "evidence_missing",
    recordedAt: MIGRATED_AT,
    recordedBy: "emp-001",
  });
  expect(isCustomerEnvelopeV3(valid)).toBe(true);

  const invalidBranches = [
    (candidate: typeof valid) => {
      delete (candidate.state.customers[0]!.verificationArchive.kycRecords[0] as unknown as {
        subjectProfile?: unknown;
      }).subjectProfile;
    },
    (candidate: typeof valid) => {
      (candidate.state.customers[0]!.verificationArchive.kycRecords[0] as unknown as Record<string, unknown>)
        .extra = "unknown";
    },
    (candidate: typeof valid) => {
      (candidate.state.customers[0]!.verificationArchive.kycRecords[0] as unknown as {
        subjectProfile: { birthDate: string };
      }).subjectProfile.birthDate = "2999-01-01";
    },
    (candidate: typeof valid) => {
      (candidate.state.customers[0]!.verificationArchive.evidenceGaps[0] as unknown as Record<string, unknown>)
        .migratedAt = MIGRATED_AT;
    },
    (candidate: typeof valid) => {
      (candidate.state.customers[0]!.verificationArchive.evidenceGaps[1] as unknown as Record<string, unknown>)
        .legacyCompletedAt = null;
    },
  ];
  for (const mutate of invalidBranches) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 preserves an old unscoped organization KYC record without treating it as malformed", () => {
  const source = genuineV2Envelope([legacyCustomer({
    customerType: "organization",
    organizationName: "Legacy Fleet Ltd",
    primaryContactRole: "Fleet manager",
  })]);
  const migrated = migrateCustomerVehicleEnvelope(source, MIGRATED_AT)!;
  (migrated.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push({
    id: "KYC-LEGACY-ORG-UNSCOPED",
    documentType: "drivers_license",
    frontAsset: pngEvidence("EVIDENCE-LEGACY-ORG-UNSCOPED"),
    submittedAt: MIGRATED_AT,
    verifiedAt: MIGRATED_AT,
    verifiedBy: "emp-001",
  });
  expect(isCustomerEnvelopeV3(migrated)).toBe(true);
  expect(migrated.schemaVersion).toBe(3);
});

test("schema v3 audit guard rejects duplicate identities, bad evidence references, and invalid relationship snapshots", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const vehicleAudit = {
    id: "AUDIT-VEHICLE-VALID",
    vehicleId: valid.state.vehicles[0]!.id,
    eventType: "vehicle_updated" as const,
    actorId: "emp-001",
    occurredAt: MIGRATED_AT,
    reason: "audit invariant fixture",
    summary: "vehicle audit",
    changes: [],
    beforeRelationships: [],
    afterRelationships: [],
  };
  valid.state.auditEvents.push(vehicleAudit);
  expect(isCustomerEnvelopeV3(valid)).toBe(true);

  const duplicateAuditId = structuredClone(valid);
  duplicateAuditId.state.auditEvents.push(structuredClone(duplicateAuditId.state.auditEvents[0]!));

  const duplicateEvidenceReference = structuredClone(valid);
  (duplicateEvidenceReference.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push({
    id: "KYC-AUDIT-REFERENCE",
    documentType: "drivers_license",
    frontAsset: pngEvidence("EVIDENCE-AUDIT-REFERENCE"),
    submittedAt: MIGRATED_AT,
  });
  const duplicateEvidenceEvent = duplicateEvidenceReference.state.auditEvents.find((event) => "customerId" in event)!;
  (duplicateEvidenceEvent.evidenceAssetIds as string[]).push(
    "EVIDENCE-AUDIT-REFERENCE",
    "EVIDENCE-AUDIT-REFERENCE",
  );

  const orphanEvidenceReference = structuredClone(valid);
  const orphanEvidenceEvent = orphanEvidenceReference.state.auditEvents.find((event) => "customerId" in event)!;
  (orphanEvidenceEvent.evidenceAssetIds as string[]).push("EVIDENCE-MISSING");

  const orphanSnapshot = structuredClone(valid);
  const orphanVehicleAudit = orphanSnapshot.state.auditEvents.find((event) => "vehicleId" in event)!;
  (orphanVehicleAudit.afterRelationships as Array<typeof orphanVehicleAudit.afterRelationships[number]>).push({
    id: "REL-AUDIT-ORPHAN",
    vehicleId: orphanVehicleAudit.vehicleId,
    customerId: "CUST-MISSING",
    startedAt: MIGRATED_AT,
    endedAt: null,
  });

  const overlappingSnapshot = structuredClone(valid);
  const overlappingVehicleAudit = overlappingSnapshot.state.auditEvents.find((event) => "vehicleId" in event)!;
  (overlappingVehicleAudit.afterRelationships as Array<typeof overlappingVehicleAudit.afterRelationships[number]>).push(
    {
      id: "REL-AUDIT-CURRENT-1",
      vehicleId: overlappingVehicleAudit.vehicleId,
      customerId: overlappingSnapshot.state.customers[0]!.id,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: null,
    },
    {
      id: "REL-AUDIT-CURRENT-2",
      vehicleId: overlappingVehicleAudit.vehicleId,
      customerId: overlappingSnapshot.state.customers[0]!.id,
      startedAt: "2026-02-01T00:00:00.000Z",
      endedAt: null,
    },
  );

  for (const candidate of [
    duplicateAuditId,
    duplicateEvidenceReference,
    orphanEvidenceReference,
    orphanSnapshot,
    overlappingSnapshot,
  ]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 audit events and scalar changes reject extra recursive payloads and disguised data URLs", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const recursiveEvent = structuredClone(valid);
  (recursiveEvent.state.auditEvents[0] as unknown as Record<string, unknown>).recursivePayload = {
    evidence: "data:image/png;base64,SECRET",
  };

  const recursiveChange = structuredClone(valid);
  (recursiveChange.state.auditEvents[0]!.changes[0] as unknown as Record<string, unknown>).recursivePayload = {
    evidence: "data:image/png;base64,SECRET",
  };

  const disguisedDataUrl = structuredClone(valid);
  (disguisedDataUrl.state.auditEvents[0]!.changes[0] as unknown as { after: string }).after =
    "  data:image/png;base64,SECRET";

  const reasonDataUrl = structuredClone(valid);
  (reasonDataUrl.state.auditEvents[0] as unknown as { reason: string }).reason =
    "  data:application/pdf;base64,SECRET";

  const summaryDataUrl = structuredClone(valid);
  (summaryDataUrl.state.auditEvents[0] as unknown as { summary: string }).summary =
    "evidence=data:image/png;base64,SECRET";

  const nonFiniteAudit = structuredClone(valid);
  (nonFiniteAudit.state.auditEvents[0]!.changes[0] as unknown as { after: number }).after = Number.POSITIVE_INFINITY;

  for (const candidate of [
    recursiveEvent, recursiveChange, disguisedDataUrl, reasonDataUrl, summaryDataUrl, nonFiniteAudit,
  ]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 verification records bind actor, reason, and monotonic timestamps", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const invalidOtpRecords = [
    {
      id: "OTP-INVALID-VERIFIED",
      phoneE164: "+18765550991",
      requestedAt: "2026-08-12T12:00:00.000Z",
      verifiedAt: "2026-08-12T11:59:59.000Z",
    },
    {
      id: "OTP-INVALIDATED-WITHOUT-ACTOR",
      phoneE164: "+18765550991",
      requestedAt: "2026-08-12T12:00:00.000Z",
      invalidatedAt: "2026-08-12T12:01:00.000Z",
      invalidationReason: "unreachable",
    },
    {
      id: "OTP-INVALIDATED-BEFORE-REQUEST",
      phoneE164: "+18765550991",
      requestedAt: "2026-08-12T12:00:00.000Z",
      invalidatedAt: "2026-08-12T11:59:59.000Z",
      invalidatedBy: "emp-001",
      invalidationReason: "unreachable",
    },
    {
      id: "OTP-VERIFIER-WITHOUT-TIME",
      phoneE164: "+18765550991",
      requestedAt: "2026-08-12T12:00:00.000Z",
      verifiedBy: "emp-001",
    },
    {
      id: "OTP-REASON-WITHOUT-INVALIDATION",
      phoneE164: "+18765550991",
      requestedAt: "2026-08-12T12:00:00.000Z",
      invalidationReason: "unreachable",
    },
    {
      id: "OTP-INVALIDATED-BEFORE-VERIFICATION",
      phoneE164: "+18765550991",
      requestedAt: "2026-08-12T12:00:00.000Z",
      verifiedAt: "2026-08-12T12:02:00.000Z",
      verifiedBy: "emp-001",
      invalidatedAt: "2026-08-12T12:01:00.000Z",
      invalidatedBy: "emp-002",
      invalidationReason: "unreachable",
    },
  ];
  for (const otpRecord of invalidOtpRecords) {
    const candidate = structuredClone(valid);
    (candidate.state.customers[0]!.verificationArchive.otpRecords as unknown[]).push(otpRecord);
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }

  const invalidKyc = structuredClone(valid);
  (invalidKyc.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push({
    id: "KYC-INVALID-VERIFIED",
    documentType: "drivers_license",
    frontAsset: pngEvidence("EVIDENCE-KYC-INVALID-TIME"),
    submittedAt: "2026-08-12T12:00:00.000Z",
    verifiedAt: "2026-08-12T11:59:59.000Z",
  });
  expect(isCustomerEnvelopeV3(invalidKyc)).toBe(false);

  const invalidKycRecords = [
    {
      id: "KYC-VERIFIER-WITHOUT-TIME",
      documentType: "drivers_license",
      frontAsset: pngEvidence("EVIDENCE-KYC-VERIFIER-WITHOUT-TIME"),
      submittedAt: "2026-08-12T12:00:00.000Z",
      verifiedBy: "emp-001",
    },
    {
      id: "KYC-INVALIDATED-WITHOUT-REASON",
      documentType: "drivers_license",
      frontAsset: pngEvidence("EVIDENCE-KYC-INVALIDATED-WITHOUT-REASON"),
      submittedAt: "2026-08-12T12:00:00.000Z",
      invalidatedAt: "2026-08-12T12:01:00.000Z",
    },
    {
      id: "KYC-INVALIDATED-BEFORE-VERIFICATION",
      documentType: "drivers_license",
      frontAsset: pngEvidence("EVIDENCE-KYC-INVALIDATED-BEFORE-VERIFICATION"),
      submittedAt: "2026-08-12T12:00:00.000Z",
      verifiedAt: "2026-08-12T12:02:00.000Z",
      verifiedBy: "emp-001",
      invalidatedAt: "2026-08-12T12:01:00.000Z",
      invalidationReason: "document damaged",
    },
  ];
  for (const kycRecord of invalidKycRecords) {
    const candidate = structuredClone(valid);
    (candidate.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push(kycRecord);
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }

  const crossBranchAgreement = structuredClone(valid);
  (crossBranchAgreement.state.customers[0]!.verificationArchive.agreementRecords as unknown[]).push({
    id: "AGREEMENT-CROSS-BRANCH",
    version: "1.3",
    medium: "paper",
    signedAt: "2026-08-12T12:00:00.000Z",
    signedBy: "Alicia Bennett",
    recordedBy: "emp-001",
    physicalRecordNumber: "PAPER-001",
    physicalStorageLocation: "Cabinet A",
    signatureAsset: pngEvidence("EVIDENCE-AGREEMENT-CROSS-BRANCH"),
  });
  expect(isCustomerEnvelopeV3(crossBranchAgreement)).toBe(false);
});

test("schema v3 rejects data-bearing OTP and KYC record identities and reasons", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  (valid.state.customers[0]!.verificationArchive.otpRecords as unknown[]).push({
    id: "OTP-SAFE-PERSISTED-TEXT",
    phoneE164: "+18765550991",
    requestedAt: MIGRATED_AT,
    verifiedAt: MIGRATED_AT,
    verifiedBy: "emp-001",
    invalidatedAt: MIGRATED_AT,
    invalidatedBy: "emp-002",
    invalidationReason: "number unreachable",
  });
  (valid.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push({
    id: "KYC-SAFE-PERSISTED-TEXT",
    documentType: "drivers_license",
    frontAsset: pngEvidence("EVIDENCE-KYC-SAFE-PERSISTED-TEXT"),
    submittedAt: MIGRATED_AT,
    verifiedAt: MIGRATED_AT,
    verifiedBy: "emp-001",
    invalidatedAt: MIGRATED_AT,
    invalidationReason: "document damaged",
  });
  expect(isCustomerEnvelopeV3(valid)).toBe(true);

  const corruptions = [
    { record: "otp", field: "id", value: "DaTa :image/png;base64,OTP_ID" },
    { record: "otp", field: "verifiedBy", value: "actor DATA:application/pdf;base64,OTP_VERIFIER" },
    { record: "otp", field: "invalidatedBy", value: "data :image/png;base64,OTP_INVALIDATOR" },
    { record: "otp", field: "invalidationReason", value: "reason dAtA :image/png;base64,OTP_REASON" },
    { record: "kyc", field: "id", value: "DATA:application/pdf;base64,KYC_ID" },
    { record: "kyc", field: "verifiedBy", value: "actor data :image/png;base64,KYC_VERIFIER" },
    { record: "kyc", field: "invalidationReason", value: "reason DaTa:application/pdf;base64,KYC_REASON" },
  ] as const;
  for (const { record, field, value } of corruptions) {
    const candidate = structuredClone(valid);
    const target = record === "otp"
      ? candidate.state.customers[0]!.verificationArchive.otpRecords[0]!
      : candidate.state.customers[0]!.verificationArchive.kycRecords[0]!;
    (target as unknown as Record<string, unknown>)[field] = value;
    expect(isCustomerEnvelopeV3(candidate), `${record}.${field} must reject data URLs`).toBe(false);
  }
});

test("schema v3 customer discriminator forbids personal organization fields and personal needs-profile-review", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const organizationOnIndividual = structuredClone(valid);
  (organizationOnIndividual.state.customers[0] as unknown as { organizationName: string }).organizationName = "Wrong Co";

  const reviewIndividual = structuredClone(valid);
  Object.assign(reviewIndividual.state.customers[0]!, {
    nameSourceScript: null,
    nameSourceValue: null,
    nameZh: null,
    nameEn: null,
    transliterationMethod: null,
    transliterationVersion: null,
    transliterationStatus: "needs_profile_review",
  });

  const contactRoleOnIndividual = structuredClone(valid);
  (contactRoleOnIndividual.state.customers[0] as unknown as { primaryContactRole: string }).primaryContactRole = "Owner";

  const organizationWithoutOrganizationName = structuredClone(valid);
  Object.assign(organizationWithoutOrganizationName.state.customers[0]!, {
    customerType: "organization",
    organizationName: null,
  });

  expect(isCustomerEnvelopeV3(organizationOnIndividual)).toBe(false);
  expect(isCustomerEnvelopeV3(reviewIndividual)).toBe(false);
  expect(isCustomerEnvelopeV3(contactRoleOnIndividual)).toBe(false);
  expect(isCustomerEnvelopeV3(organizationWithoutOrganizationName)).toBe(false);
});

test("schema v3 verification archives remain append-only in chronological order", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;

  const otpReverse = structuredClone(valid);
  (otpReverse.state.customers[0]!.verificationArchive.otpRecords as unknown[]).push(
    { id: "OTP-NEWER", phoneE164: "+18765550991", requestedAt: "2026-08-13T12:00:00.000Z" },
    { id: "OTP-OLDER", phoneE164: "+18765550991", requestedAt: "2026-08-12T12:00:00.000Z" },
  );

  const kycReverse = structuredClone(valid);
  (kycReverse.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push(
    {
      id: "KYC-NEWER", documentType: "drivers_license", frontAsset: pngEvidence("EVIDENCE-KYC-NEWER"),
      submittedAt: "2026-08-13T12:00:00.000Z",
    },
    {
      id: "KYC-OLDER", documentType: "drivers_license", frontAsset: pngEvidence("EVIDENCE-KYC-OLDER"),
      submittedAt: "2026-08-12T12:00:00.000Z",
    },
  );

  const agreementReverse = structuredClone(valid);
  (agreementReverse.state.customers[0]!.verificationArchive.agreementRecords as unknown[]).push(
    {
      id: "AGREEMENT-NEWER", version: "1.3", medium: "paper", signedAt: "2026-08-13T12:00:00.000Z",
      signedBy: "Jason Wong", recordedBy: "emp-001", physicalRecordNumber: "PAPER-NEWER",
      physicalStorageLocation: "Cabinet A",
    },
    {
      id: "AGREEMENT-OLDER", version: "1.2", medium: "paper", signedAt: "2026-08-12T12:00:00.000Z",
      signedBy: "Jason Wong", recordedBy: "emp-001", physicalRecordNumber: "PAPER-OLDER",
      physicalStorageLocation: "Cabinet B",
    },
  );

  const gapReverse = structuredClone(valid);
  (gapReverse.state.customers[0]!.verificationArchive.evidenceGaps as unknown[]).push(
    {
      kind: "otp", legacyCompletedAt: null, reason: "legacy_completion_without_evidence",
      migratedAt: "2026-08-13T12:00:00.000Z",
    },
    {
      kind: "kyc", legacyCompletedAt: null, reason: "legacy_completion_without_evidence",
      migratedAt: "2026-08-12T12:00:00.000Z",
    },
  );

  const gapAfterMigration = structuredClone(valid);
  (gapAfterMigration.state.customers[0]!.verificationArchive.evidenceGaps as unknown[]).push({
    kind: "otp", legacyCompletedAt: "2026-08-14T12:00:00.000Z",
    reason: "legacy_completion_without_evidence", migratedAt: "2026-08-13T12:00:00.000Z",
  });

  for (const candidate of [otpReverse, kycReverse, agreementReverse, gapReverse, gapAfterMigration]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 rejects impossible vehicle facts and reversed entity lifecycle timestamps", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const invalidYear = structuredClone(valid);
  invalidYear.state.vehicles[0]!.year = 1885;
  const emptyMake = structuredClone(valid);
  emptyMake.state.vehicles[0]!.make = "  ";
  const emptyModel = structuredClone(valid);
  emptyModel.state.vehicles[0]!.model = "";
  const reversedCustomer = structuredClone(valid);
  (reversedCustomer.state.customers[0]! as unknown as { updatedAt: string }).updatedAt = "2024-12-31T23:59:59.999Z";
  const reversedVehicle = structuredClone(valid);
  reversedVehicle.state.vehicles[0]!.updatedAt = "2024-12-31T23:59:59.999Z";

  for (const candidate of [invalidYear, emptyMake, emptyModel, reversedCustomer, reversedVehicle]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 risk and credit lifecycles cannot contradict their timestamps or active state", () => {
  const valid = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const reversedRisk = structuredClone(valid);
  (reversedRisk.state.customers[0]!.riskFlags as unknown[]).push({
    id: "RISK-REVERSED", level: "attention", note: "invalid chronology",
    addedAt: "2026-08-13T12:00:00.000Z", addedBy: "emp-001",
    removedAt: "2026-08-12T12:00:00.000Z", removedBy: "emp-002",
  });
  const activeWithoutRegistration = structuredClone(valid);
  activeWithoutRegistration.state.customers[0]!.creditEligibility.eligible = true;
  const activeButCancelled = structuredClone(valid);
  Object.assign(activeButCancelled.state.customers[0]!.creditEligibility, {
    eligible: true,
    registeredAt: "2026-08-12T12:00:00.000Z",
    registeredBy: "emp-001",
    cancelledAt: "2026-08-13T12:00:00.000Z",
    cancelledBy: "emp-002",
  });
  const reversedCancellation = structuredClone(valid);
  Object.assign(reversedCancellation.state.customers[0]!.creditEligibility, {
    eligible: false,
    registeredAt: "2026-08-13T12:00:00.000Z",
    registeredBy: "emp-001",
    cancelledAt: "2026-08-12T12:00:00.000Z",
    cancelledBy: "emp-002",
  });

  for (const candidate of [reversedRisk, activeWithoutRegistration, activeButCancelled, reversedCancellation]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 rejects undeclared own keys from every persisted object boundary", () => {
  const base = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const inject = (mutate: (candidate: typeof base) => Record<string, unknown>) => {
    const candidate = structuredClone(base);
    mutate(candidate).recursivePayload = { secret: "must not persist" };
    return candidate;
  };
  const candidates = [
    inject((value) => value as unknown as Record<string, unknown>),
    inject((value) => value.state as unknown as Record<string, unknown>),
    inject((value) => value.state.customers[0]! as unknown as Record<string, unknown>),
    inject((value) => value.state.customers[0]!.verificationArchive as unknown as Record<string, unknown>),
    inject((value) => value.state.customers[0]!.creditEligibility as unknown as Record<string, unknown>),
    inject((value) => value.state.customers[0]!.notes[0]! as unknown as Record<string, unknown>),
    inject((value) => value.state.vehicles[0]! as unknown as Record<string, unknown>),
    inject((value) => value.state.vehicles[0]!.photos[0]! as unknown as Record<string, unknown>),
    inject((value) => value.state.vehicles[0]!.partsNeeds[0]! as unknown as Record<string, unknown>),
    inject((value) => value.state.vehicles[0]!.tasks[0]! as unknown as Record<string, unknown>),
    inject((value) => value.state.relationships[0]! as unknown as Record<string, unknown>),
  ];

  const risk = structuredClone(base);
  (risk.state.customers[0]!.riskFlags as unknown[]).push({
    id: "RISK-EXTRA", level: "attention", note: "valid", addedAt: MIGRATED_AT,
    addedBy: "emp-001", removedAt: null, removedBy: null,
  });
  (risk.state.customers[0]!.riskFlags[0] as unknown as Record<string, unknown>).recursivePayload = {};
  candidates.push(risk);

  const otp = structuredClone(base);
  (otp.state.customers[0]!.verificationArchive.otpRecords as unknown[]).push({
    id: "OTP-EXTRA", phoneE164: "+18765550991", requestedAt: MIGRATED_AT, recursivePayload: {},
  });
  candidates.push(otp);

  const kyc = structuredClone(base);
  (kyc.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push({
    id: "KYC-EXTRA", documentType: "drivers_license", submittedAt: MIGRATED_AT,
    frontAsset: { ...pngEvidence("EVIDENCE-KYC-EXTRA"), recursivePayload: {} },
  });
  candidates.push(kyc);

  const agreement = structuredClone(base);
  (agreement.state.customers[0]!.verificationArchive.agreementRecords as unknown[]).push({
    id: "AGREEMENT-EXTRA", version: "1.3", medium: "paper", signedAt: MIGRATED_AT,
    signedBy: "Jason Wong", recordedBy: "emp-001", physicalRecordNumber: "PAPER-EXTRA",
    physicalStorageLocation: "Cabinet A", recursivePayload: {},
  });
  candidates.push(agreement);

  const gap = structuredClone(base);
  (gap.state.customers[0]!.verificationArchive.evidenceGaps as unknown[]).push({
    kind: "otp", legacyCompletedAt: null, reason: "legacy_completion_without_evidence",
    migratedAt: MIGRATED_AT, recursivePayload: {},
  });
  candidates.push(gap);

  const attachment = structuredClone(base);
  attachment.state.vehicles[0]!.attachments.push({
    ...pngEvidence("EVIDENCE-ATTACHMENT-EXTRA"), recursivePayload: {},
  } as never);
  candidates.push(attachment);

  const receipt = structuredClone(base);
  receipt.state.mutationReceipts.push({
    actorId: "emp-001", clientMutationId: "mutation-extra", operation: "customer.update",
    resultEntityId: receipt.state.customers[0]!.id, createdAt: MIGRATED_AT, recursivePayload: {},
  } as never);
  candidates.push(receipt);

  for (const candidate of candidates) expect(isCustomerEnvelopeV3(candidate)).toBe(false);
});

test("schema v3 mutation receipts have a unique idempotency key and reference the operation entity kind", () => {
  const base = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  base.state.mutationReceipts.push({
    actorId: "emp-001", clientMutationId: "customer-mutation-1", operation: "otp.request",
    resultEntityId: base.state.customers[0]!.id, resultRevision: base.state.customers[0]!.revision,
    createdAt: MIGRATED_AT,
  }, {
    actorId: "emp-001", clientMutationId: "vehicle-mutation-1", operation: "vehicle.update",
    resultEntityId: base.state.vehicles[0]!.id, resultRevision: base.state.vehicles[0]!.revision,
    createdAt: MIGRATED_AT,
  });
  expect(isCustomerEnvelopeV3(base)).toBe(true);

  const duplicateKey = structuredClone(base);
  duplicateKey.state.mutationReceipts.push({
    ...duplicateKey.state.mutationReceipts[0]!, resultEntityId: duplicateKey.state.customers[0]!.id,
  });
  const orphanCustomer = structuredClone(base);
  (orphanCustomer.state.mutationReceipts[0]! as unknown as { resultEntityId: string }).resultEntityId = "CUST-MISSING";
  const customerOperationOnVehicle = structuredClone(base);
  (customerOperationOnVehicle.state.mutationReceipts[0]! as unknown as { resultEntityId: string }).resultEntityId =
    customerOperationOnVehicle.state.vehicles[0]!.id;
  const orphanVehicle = structuredClone(base);
  (orphanVehicle.state.mutationReceipts[1]! as unknown as { resultEntityId: string }).resultEntityId = "VEH-MISSING";
  const unknownOperation = structuredClone(base);
  (unknownOperation.state.mutationReceipts[0]! as unknown as { operation: string }).operation = "unknown.mutation";

  for (const candidate of [duplicateKey, orphanCustomer, customerOperationOnVehicle, orphanVehicle, unknownOperation]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 mutation receipts require a bounded persisted result revision", () => {
  const base = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const customer = base.state.customers[0]!;
  (base.state.mutationReceipts as unknown[]).push({
    actorId: "emp-001",
    clientMutationId: "revision-bound-receipt",
    operation: "otp.request",
    resultEntityId: customer.id,
    resultRevision: customer.revision,
    createdAt: MIGRATED_AT,
  });
  expect(isCustomerEnvelopeV3(base)).toBe(true);

  const missingRevision = structuredClone(base);
  delete (missingRevision.state.mutationReceipts[0]! as unknown as { resultRevision?: number }).resultRevision;
  const futureRevision = structuredClone(base);
  (futureRevision.state.mutationReceipts[0]! as unknown as { resultRevision: number }).resultRevision =
    customer.revision + 1;
  const fractionalRevision = structuredClone(base);
  (fractionalRevision.state.mutationReceipts[0]! as unknown as { resultRevision: number }).resultRevision = 1.5;

  for (const candidate of [missingRevision, futureRevision, fractionalRevision]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 mutation receipt operations use an exact allowlist", () => {
  const allowed = [
    "customer.create",
    "customer.update",
    "vehicle.update",
    "otp.request",
    "otp.verify",
    "otp.invalidate",
    "kyc.submit",
    "kyc.verify",
    "agreement.sign",
  ] as const;
  const base = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  for (const [index, operation] of allowed.entries()) {
    base.state.mutationReceipts.push({
      actorId: "emp-001",
      clientMutationId: `allowed-${index}`,
      operation,
      resultEntityId: operation.startsWith("vehicle")
        ? base.state.vehicles[0]!.id
        : base.state.customers[0]!.id,
      resultRevision: operation.startsWith("vehicle")
        ? base.state.vehicles[0]!.revision
        : base.state.customers[0]!.revision,
      createdAt: MIGRATED_AT,
    });
  }
  expect(isCustomerEnvelopeV3(base)).toBe(true);

  for (const operation of [
    "nototp.request",
    "otp.request.suffix",
    "vehicle.update.extra",
    "customer.vehicle.update",
    "agreement.sign-copy",
  ]) {
    const candidate = structuredClone(base);
    (candidate.state.mutationReceipts[0]! as unknown as { operation: string }).operation = operation;
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 rejects data-bearing evidence metadata and audit evidence references", () => {
  const base = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const customerId = base.state.customers[0]!.id;
  const addKycEvidence = (id: string) => {
    (base.state.customers[0]!.verificationArchive.kycRecords as unknown[]).push({
      id: "KYC-AUDIT-SAFE",
      documentType: "drivers_license",
      frontAsset: pngEvidence(id),
      submittedAt: MIGRATED_AT,
    });
    base.state.auditEvents.push({
      id: "AUDIT-KYC-AUDIT-SAFE",
      customerId,
      eventType: "kyc_submitted",
      actorId: "emp-001",
      occurredAt: MIGRATED_AT,
      reason: null,
      summary: "KYC submitted",
      changes: [{ field: "kycRecordId", before: null, after: "KYC-AUDIT-SAFE" }],
      evidenceAssetIds: [id],
    });
  };
  addKycEvidence("EVIDENCE-AUDIT-SAFE");
  expect(isCustomerEnvelopeV3(base)).toBe(true);

  const maliciousId = structuredClone(base);
  const maliciousValue = "data:image/png;base64,PRIVATE_ID";
  (maliciousId.state.customers[0]!.verificationArchive.kycRecords[0]! as unknown as {
    frontAsset: EvidenceAsset;
  }).frontAsset = {
    ...maliciousId.state.customers[0]!.verificationArchive.kycRecords[0]!.frontAsset,
    id: maliciousValue,
  };
  const audit = maliciousId.state.auditEvents.find((event) => "customerId" in event
    && event.id === "AUDIT-KYC-AUDIT-SAFE")!;
  if ("customerId" in audit) (audit.evidenceAssetIds as string[])[0] = maliciousValue;

  const maliciousFileName = structuredClone(base);
  (maliciousFileName.state.customers[0]!.verificationArchive.kycRecords[0]! as unknown as {
    frontAsset: EvidenceAsset;
  }).frontAsset = {
    ...maliciousFileName.state.customers[0]!.verificationArchive.kycRecords[0]!.frontAsset,
    fileName: "data:application/pdf;base64,PRIVATE_FILENAME",
  };
  const maliciousCreatedBy = structuredClone(base);
  (maliciousCreatedBy.state.customers[0]!.verificationArchive.kycRecords[0]! as unknown as {
    frontAsset: EvidenceAsset;
  }).frontAsset = {
    ...maliciousCreatedBy.state.customers[0]!.verificationArchive.kycRecords[0]!.frontAsset,
    createdBy: "data:image/png;base64,PRIVATE_ACTOR",
  };

  for (const candidate of [maliciousId, maliciousFileName, maliciousCreatedBy]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 rejects data-bearing audit and receipt identities", () => {
  const base = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const maliciousAuditId = structuredClone(base);
  (maliciousAuditId.state.auditEvents[0]! as unknown as { id: string }).id =
    "data:image/png;base64,PRIVATE_AUDIT_ID";
  const maliciousAuditActor = structuredClone(base);
  (maliciousAuditActor.state.auditEvents[0]! as unknown as { actorId: string }).actorId =
    "data:image/png;base64,PRIVATE_AUDIT_ACTOR";
  const maliciousReceiptActor = structuredClone(base);
  maliciousReceiptActor.state.mutationReceipts.push({
    actorId: "data:image/png;base64,PRIVATE_RECEIPT_ACTOR",
    clientMutationId: "receipt-actor-unsafe",
    operation: "customer.update",
    resultEntityId: maliciousReceiptActor.state.customers[0]!.id,
    resultRevision: maliciousReceiptActor.state.customers[0]!.revision,
    createdAt: MIGRATED_AT,
  });

  for (const candidate of [maliciousAuditId, maliciousAuditActor, maliciousReceiptActor]) {
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("schema v3 rejects data-bearing persisted agreement text", () => {
  const base = migrateCustomerVehicleEnvelope(genuineV2Envelope(), MIGRATED_AT)!;
  const customer = base.state.customers[0]!;
  (customer.verificationArchive.agreementRecords as unknown[]).push({
    id: "AGREEMENT-SAFE-TEXT",
    version: "1.3",
    medium: "paper",
    signedAt: MIGRATED_AT,
    signedBy: "Jason Wong",
    recordedBy: "emp-001",
    physicalRecordNumber: "PAPER-001",
    physicalStorageLocation: "Cabinet A",
  });
  expect(isCustomerEnvelopeV3(base)).toBe(true);

  for (const field of [
    "id", "version", "signedBy", "recordedBy", "physicalRecordNumber", "physicalStorageLocation",
  ] as const) {
    const candidate = structuredClone(base);
    const record = candidate.state.customers[0]!.verificationArchive.agreementRecords[0]! as unknown as
      Record<string, unknown>;
    record[field] = `data:image/png;base64,PRIVATE_${field}`;
    expect(isCustomerEnvelopeV3(candidate)).toBe(false);
  }
});

test("legacy audit and metadata ID collisions migrate to deterministic globally unique v3 event identities", () => {
  const source = genuineV2Envelope();
  const collisionId = `MIGRATION-${source.state.customers[0]!.id}`;
  (source.state.customers[0] as Record<string, unknown>).communications = [{
    id: collisionId,
    channel: "phone",
    direction: "inbound",
    summary: "real legacy metadata",
    operator: "emp-001",
    time: "2026-01-02T00:00:00.000Z",
  }];
  source.state.auditRecords.push({
    id: collisionId,
    entityType: "customer",
    entityId: source.state.customers[0]!.id,
    action: "updated",
    actorId: "emp-001",
    occurredAt: "2026-01-03T00:00:00.000Z",
    reason: "legacy audit collision",
    before: null,
    after: structuredClone(source.state.customers[0]!),
  });

  const migrated = migrateCustomerVehicleEnvelope(source, MIGRATED_AT);
  expect(migrated).not.toBeNull();
  const eventIds = migrated!.state.auditEvents.map((event) => event.id);
  expect(eventIds.filter((id) => id === collisionId || id.startsWith(`${collisionId}--`))).toHaveLength(3);
  expect(new Set(eventIds).size).toBe(eventIds.length);
  expect(migrateCustomerVehicleEnvelope(migrated, MIGRATED_AT)).toEqual(migrated);
});

test("store eagerly persists a valid migration but leaves the legacy raw string untouched when persistence fails", () => {
  const originalValue = JSON.stringify(genuineV2Envelope());
  const successfulStorage = {
    value: originalValue,
    getItem() { return this.value; },
    setItem(_key: string, value: string) { this.value = value; },
  };
  const migrated = createMockCustomerVehicleStore({ storage: successfulStorage }).workspace(superadmin);
  expect(migrated.customers.some((customer) => customer.id === "CUST-USER-991")).toBe(true);
  expect(JSON.parse(successfulStorage.value).schemaVersion).toBe(3);

  const failedStorage = {
    originalValue,
    getItem() { return this.originalValue; },
    setItem() { throw new Error("quota"); },
  };
  const inMemory = createMockCustomerVehicleStore({ storage: failedStorage }).workspace(superadmin);
  expect(inMemory.customers.some((customer) => customer.id === "CUST-USER-991")).toBe(true);
  expect(failedStorage.getItem()).toBe(originalValue);
});

test("store fails closed without replacing raw when a guard-valid legacy envelope cannot produce strict v3", () => {
  const source = genuineV2Envelope();
  source.state.vehicles[0]!.make = "";
  source.state.vehicles[0]!.model = "";
  expect(isLegacyCustomerEnvelopeV2(source)).toBe(true);
  expect(migrateCustomerVehicleEnvelope(source, MIGRATED_AT)).toBeNull();
  const originalValue = JSON.stringify(source);
  const storage = {
    value: originalValue,
    getItem() { return this.value; },
    setItem(_key: string, value: string) { this.value = value; },
  };

  expect(() => createMockCustomerVehicleStore({ storage }).workspace(superadmin))
    .toThrow("持久化客户与车辆数据不符合 schema v3");
  expect(storage.value).toBe(originalValue);
});

test("a later failed mutation after a failed eager migration keeps both legacy raw storage and in-memory revision atomic", () => {
  const originalValue = JSON.stringify(genuineV2Envelope());
  let writes = 0;
  const storage = {
    value: originalValue,
    getItem() { return this.value; },
    setItem() { writes += 1; throw new Error("quota"); },
  };
  const store = createMockCustomerVehicleStore({ storage });
  const before = store.workspace(superadmin);
  const name = store.previewCustomerName(superadmin, "陈志远");
  const preview = store.previewCustomer(superadmin, {
    customerType: "individual",
    nameSourceValue: "陈志远",
    nameTransliterationToken: name.confirmationToken,
    primaryPhone: "+1 876 555 0992",
  });
  expect(() => store.createCustomer(superadmin, {
    ...preview.input,
    previewToken: preview.previewToken,
  })).toThrow("quota");
  const after = store.workspace(superadmin);
  expect(after.sourceRevision).toBe(before.sourceRevision);
  expect(after.customers).toHaveLength(before.customers.length);
  expect(storage.value).toBe(originalValue);
  expect(writes).toBeGreaterThanOrEqual(2);
});
