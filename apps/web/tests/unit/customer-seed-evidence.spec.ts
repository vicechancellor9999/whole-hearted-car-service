import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { createMockCustomerVehicleStore } from "../../src/lib/api/mock-customers";
import {
  validateAgreementEvidence,
  validateEvidenceAsset,
  validateKycEvidence,
} from "../../src/lib/customers/evidence-assets";
import { validateCustomerVehicleStateV3 } from "../../src/lib/customers/migrations";
import {
  ALICIA_LICENSE_PROFILE_FIXTURE,
  SEED_EVIDENCE_ASSETS,
} from "../../src/lib/customers/seed-evidence";
import {
  deriveAgreementVerification,
  deriveKycVerification,
  deriveOtpVerification,
} from "../../src/lib/customers/verification-domain";
import type { CustomerVehicleStateV3 } from "../../src/lib/customers/types";
import type { EvidenceAsset } from "../../src/lib/customers/verification-types";

const superadmin = { actorId: "emp-001", role: "superadmin" };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function publicAssetPath(asset: EvidenceAsset): string {
  return path.join(process.cwd(), "public", asset.url.replace(/^\//, ""));
}

function freshState(): CustomerVehicleStateV3 {
  const store = createMockCustomerVehicleStore();
  const workspace = store.workspace(superadmin);
  return {
    sourceRevision: workspace.sourceRevision,
    customers: workspace.customers,
    vehicles: workspace.vehicles,
    relationships: workspace.relationships,
    auditEvents: store.audits(superadmin),
    mutationReceipts: [],
  };
}

function withoutAliciaEvidence(state: CustomerVehicleStateV3): CustomerVehicleStateV3 {
  return {
    ...structuredClone(state),
    customers: state.customers.map((customer) => customer.id === "CUST-UAT-001" ? {
      ...structuredClone(customer),
      verificationArchive: { otpRecords: [], kycRecords: [], agreementRecords: [], evidenceGaps: [] },
    } : structuredClone(customer)),
  };
}

function memoryStorage(saved: string | null) {
  return {
    saved,
    writes: 0,
    getItem() { return this.saved; },
    setItem(_key: string, value: string) { this.writes += 1; this.saved = value; },
  };
}

test("every seed evidence URL resolves to a real bounded file with matching magic", () => {
  for (const asset of Object.values(SEED_EVIDENCE_ASSETS)) {
    expect(asset.url).toMatch(/^\/seed-evidence\/[a-z0-9.-]+$/);
    const bytes = readFileSync(publicAssetPath(asset));
    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.sizeBytes).toBeLessThanOrEqual(524_288);
    expect(bytes).toHaveLength(asset.sizeBytes);
    if (asset.mimeType === "image/png") expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    if (asset.mimeType === "application/pdf") expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(path.extname(asset.fileName)).toBe(asset.mimeType === "application/pdf" ? ".pdf" : ".png");
  }
});

test("the immutable manifest is the only accepted repository evidence identity", () => {
  expect(Object.isFrozen(SEED_EVIDENCE_ASSETS)).toBe(true);
  for (const asset of Object.values(SEED_EVIDENCE_ASSETS)) {
    expect(Object.isFrozen(asset)).toBe(true);
    expect(() => validateEvidenceAsset(structuredClone(asset))).not.toThrow();
  }
  validateKycEvidence(structuredClone(SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront));
  validateAgreementEvidence({
    signatureAsset: structuredClone(SEED_EVIDENCE_ASSETS.aliciaAgreementSignature),
    signedDocumentAsset: structuredClone(SEED_EVIDENCE_ASSETS.aliciaSignedAgreement),
  });

  const changed = { ...SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront, sizeBytes: 1 };
  const unknown = { ...SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront, id: "EVID-FAKE", url: "/seed-evidence/fake.png" };
  const inherited = Object.create(SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront) as EvidenceAsset;
  const extra = structuredClone(SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront) as EvidenceAsset & { hidden?: string };
  Object.defineProperty(extra, "hidden", { value: "not allowed", enumerable: false });
  Object.defineProperty(extra, Symbol("hidden"), { value: "not allowed", enumerable: false });
  const customPrototype = Object.assign(
    Object.create({ inherited: "not allowed" }) as EvidenceAsset,
    SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront,
  );
  for (const candidate of [changed, unknown, inherited, extra, customPrototype]) {
    expect(() => validateEvidenceAsset(candidate)).toThrow(/EVIDENCE_ASSET_INVALID/);
  }
});

test("a casted KYC request cannot invent a repository seed path", () => {
  const fake = {
    ...SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront,
    id: "EVID-FAKE",
    fileName: "fake.png",
    url: "/seed-evidence/fake.png",
  };
  let error: unknown;
  try {
    createMockCustomerVehicleStore().submitCustomerKyc(superadmin, "CUST-UAT-003", {
      frontAsset: fake,
      clientMutationId: "seed-path-bypass",
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({ code: "EVIDENCE_ASSET_INVALID" });
});

test("the seed PDF generator is deterministic and renders the canonical agreement", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "customer-seed-agreement-"));
  try {
    const first = path.join(directory, "first.pdf");
    const second = path.join(directory, "second.pdf");
    const script = path.join(process.cwd(), "scripts/generate-customer-seed-agreement.mjs");
    execFileSync(process.execPath, [script, first]);
    execFileSync(process.execPath, [script, second]);
    const firstBytes = readFileSync(first);
    const secondBytes = readFileSync(second);
    expect(createHash("sha256").update(firstBytes).digest("hex"))
      .toBe(createHash("sha256").update(secondBytes).digest("hex"));
    expect(firstBytes).toEqual(readFileSync(publicAssetPath(SEED_EVIDENCE_ASSETS.aliciaSignedAgreement)));
    const document = await PDFDocument.load(firstBytes);
    expect(document.getTitle()).toBe("Synthetic Customer Service Agreement 1.3");
    expect(document.getSubject()).toContain("Synthetic demonstration evidence");
    expect(document.getPageCount()).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fresh Alicia derives completed verification only from retrievable evidence", () => {
  const customer = createMockCustomerVehicleStore().customer(superadmin, "CUST-UAT-001");
  expect(customer.verificationArchive.evidenceGaps).toEqual([]);
  expect(deriveOtpVerification(customer.verificationArchive, customer.phone)).toMatchObject({
    status: "verified",
    activeRecord: { id: "OTP-UAT-ALICIA-001", phoneE164: customer.phone },
  });
  expect(deriveKycVerification(customer.verificationArchive)).toMatchObject({
    status: "verified",
    activeRecord: {
      id: "KYC-UAT-ALICIA-DL-001",
      documentType: "drivers_license",
      frontAsset: { id: SEED_EVIDENCE_ASSETS.aliciaDriversLicenseFront.id, mimeType: "image/png" },
    },
  });
  expect(deriveAgreementVerification(customer.verificationArchive, "1.3")).toMatchObject({
    status: "signed",
    activeRecord: {
      id: "AGR-UAT-ALICIA-1.3",
      medium: "electronic",
      signatureAsset: { id: SEED_EVIDENCE_ASSETS.aliciaAgreementSignature.id },
      signedDocumentAsset: { id: SEED_EVIDENCE_ASSETS.aliciaSignedAgreement.id },
    },
  });
  expect(JSON.stringify(customer.verificationArchive)).not.toContain("registration-sample");
});

test("fresh seed evidence timestamps do not postdate their verification facts", () => {
  const archive = createMockCustomerVehicleStore().customer(superadmin, "CUST-UAT-001").verificationArchive;
  const kyc = archive.kycRecords[0]!;
  const agreement = archive.agreementRecords[0]!;
  expect(kyc.frontAsset.createdAt <= kyc.submittedAt).toBe(true);
  expect(kyc.submittedAt <= kyc.verifiedAt!).toBe(true);
  if (agreement.medium !== "electronic") throw new Error("expected electronic agreement");
  expect(agreement.signatureAsset.createdAt <= agreement.signedAt).toBe(true);
  expect(agreement.signedDocumentAsset.createdAt <= agreement.signedAt).toBe(true);
});

test("valid current state and stored envelope are never backfilled", () => {
  const emptyState = withoutAliciaEvidence(freshState());
  expect(validateCustomerVehicleStateV3(emptyState)).toBe(true);
  const initialCustomer = createMockCustomerVehicleStore({ initialState: emptyState })
    .customer(superadmin, "CUST-UAT-001");
  expect(initialCustomer.verificationArchive).toEqual({
    otpRecords: [], kycRecords: [], agreementRecords: [], evidenceGaps: [],
  });

  const raw = JSON.stringify({ schemaVersion: 3, state: emptyState });
  const storage = memoryStorage(raw);
  const storedCustomer = createMockCustomerVehicleStore({ storage }).customer(superadmin, "CUST-UAT-001");
  expect(storedCustomer.verificationArchive).toEqual(initialCustomer.verificationArchive);
  expect(storage.saved).toBe(raw);
  expect(storage.writes).toBe(0);
});

test("genuine legacy completion migrates to evidence gaps without seed evidence", () => {
  const legacy = {
    schemaVersion: 2,
    state: {
      sourceRevision: 1,
      customers: [{
        id: "CUST-UAT-001",
        customerType: "individual",
        name: "Alicia Bennett",
        organizationName: null,
        phone: "+1 876 555 0101",
        verification: {
          otpVerified: true, otpVerifiedAt: "2026-01-14T09:20:00.000Z",
          kycStatus: "verified", kycVerifiedAt: "2026-01-14T09:35:00.000Z",
          agreementStatus: "signed", agreementVersion: "v1.2", agreementSignedAt: "2026-05-16T10:00:00.000Z",
        },
        revision: 1,
        createdAt: "2025-01-14T09:00:00.000Z",
        updatedAt: "2026-08-01T10:00:00.000Z",
      }],
      vehicles: [], relationships: [], auditRecords: [],
    },
  };
  const storage = memoryStorage(JSON.stringify(legacy));
  const customer = createMockCustomerVehicleStore({ storage }).customer(superadmin, "CUST-UAT-001");
  expect(customer.verificationArchive.evidenceGaps.map((gap) => gap.kind)).toEqual(["otp", "kyc", "agreement"]);
  expect(customer.verificationArchive.otpRecords).toEqual([]);
  expect(customer.verificationArchive.kycRecords).toEqual([]);
  expect(customer.verificationArchive.agreementRecords).toEqual([]);
  expect(storage.writes).toBe(1);
  expect(storage.saved).not.toContain("EVID-UAT-");
  expect(storage.saved).not.toContain("/seed-evidence/");
});

test("the licence profile fixture contains exactly the four approved facts", () => {
  expect(Object.isFrozen(ALICIA_LICENSE_PROFILE_FIXTURE)).toBe(true);
  expect(Object.keys(ALICIA_LICENSE_PROFILE_FIXTURE)).toEqual(["name", "birthDate", "sex", "address"]);
  expect(ALICIA_LICENSE_PROFILE_FIXTURE).toEqual({
    name: "Alicia Bennett",
    birthDate: "1988-03-22",
    sex: "F",
    address: "12 Constant Spring Road, Kingston 8, Jamaica",
  });
});
