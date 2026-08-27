import { expect, test } from "@playwright/test";
import { createMockCustomerVehicleStore } from "../../src/lib/api/mock-customers";
import { pendingVerificationCount } from "../../src/components/customers/detail-shared";
import {
  deriveAgreementVerification,
  deriveKycVerification,
  deriveOtpVerification,
  validateAgreementRecord,
} from "../../src/lib/customers/verification-domain";
import { formatPhoneE164, normalizePhoneE164 } from "../../src/lib/customers/phone";
import type { CustomerRecord } from "../../src/lib/customers/types";
import type {
  AgreementRecord,
  CustomerVerificationArchive,
  EvidenceAsset,
} from "../../src/lib/customers/verification-types";

const NOW = "2026-08-12T09:00:00.000Z";
const LATER = "2026-08-12T10:00:00.000Z";
const SUPERADMIN = { actorId: "emp-001", role: "superadmin" };

function asset(overrides: Partial<EvidenceAsset> = {}): EvidenceAsset {
  return {
    id: "asset-001",
    fileName: "evidence.png",
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ9wAAAABJRU5ErkJggg==",
    mimeType: "image/png",
    sizeBytes: 70,
    createdAt: NOW,
    createdBy: "emp-001",
    ...overrides,
  };
}

function emptyArchive(): CustomerVerificationArchive {
  return { otpRecords: [], kycRecords: [], agreementRecords: [], evidenceGaps: [] };
}

function otpArchive(overrides: Partial<CustomerVerificationArchive["otpRecords"][number]> = {}): CustomerVerificationArchive {
  return {
    ...emptyArchive(),
    otpRecords: [{
      id: "otp-001",
      phoneE164: "+18765550101",
      requestedAt: NOW,
      verifiedAt: NOW,
      verifiedBy: "emp-001",
      ...overrides,
    }],
  };
}

function legacyGapArchive(kind: "kyc" | "agreement"): CustomerVerificationArchive {
  return {
    ...emptyArchive(),
    evidenceGaps: [{
      kind,
      legacyCompletedAt: null,
      ...(kind === "agreement" ? { legacyAgreementVersion: "1.2" } : {}),
      reason: "legacy_completion_without_evidence",
      migratedAt: NOW,
    }],
  };
}

function electronicAgreement(overrides: Partial<AgreementRecord> = {}): AgreementRecord {
  return {
    id: "agreement-001",
    version: "1.3",
    medium: "electronic",
    signedAt: NOW,
    signedBy: "Alicia Bennett",
    recordedBy: "emp-001",
    signedDocumentAsset: asset({
      id: "pdf-001",
      fileName: "agreement.pdf",
      url: "data:application/pdf;base64,JVBERi0xLjQK",
      mimeType: "application/pdf",
      sizeBytes: 9,
    }),
    signatureAsset: asset(),
    ...overrides,
  } as AgreementRecord;
}

function paperAgreement(overrides: Partial<AgreementRecord> = {}): AgreementRecord {
  return {
    id: "agreement-002",
    version: "1.3",
    medium: "paper",
    signedAt: NOW,
    signedBy: "Alicia Bennett",
    recordedBy: "emp-001",
    ...overrides,
  } as AgreementRecord;
}

function organizationForPendingCount(
  kycRecords: CustomerVerificationArchive["kycRecords"],
  nameSourceValue = "Dwayne Clarke",
): CustomerRecord {
  const seeded = createMockCustomerVehicleStore()
    .workspace(SUPERADMIN)
    .customers.find((customer) => customer.id === "CUST-UAT-002");
  if (!seeded) throw new Error("organization fixture missing");
  return {
    ...seeded,
    nameSourceScript: "en",
    nameSourceValue,
    nameZh: null,
    nameEn: nameSourceValue,
    transliterationMethod: null,
    transliterationVersion: null,
    transliterationStatus: "needs_transliteration_review",
    phone: "+18765550102",
    verificationArchive: {
      otpRecords: [{
        id: "otp-organization-current",
        phoneE164: "+18765550102",
        requestedAt: NOW,
        verifiedAt: NOW,
        verifiedBy: "emp-001",
      }],
      kycRecords,
      agreementRecords: [paperAgreement({
        id: "agreement-organization-current",
        signedBy: "Dwayne Clarke",
        physicalRecordNumber: "PAPER-ORG-001",
        physicalStorageLocation: "前台档案柜 C-01",
      })],
      evidenceGaps: [],
    },
  };
}

test("a verified OTP becomes needs_reverification when the primary phone changes", () => {
  const archive = otpArchive();
  expect(deriveOtpVerification(archive, "+18765550101").status).toBe("verified");
  expect(deriveOtpVerification(archive, "+18765550999").status).toBe("needs_reverification");
});

test("normalizes equivalent Jamaica phone formatting before OTP comparison", () => {
  expect(normalizePhoneE164("+1 876 555 0101")).toBe("+18765550101");
  expect(normalizePhoneE164("(876) 555-0101", "JM")).toBe("+18765550101");
  expect(formatPhoneE164("+18765550101")).toBe("+1 876 555 0101");
  expect(deriveOtpVerification(otpArchive(), "+1 876 555 0101").status).toBe("verified");
});

test("rejects extensions, letters, and ambiguous phone lengths", () => {
  for (const value of ["876 555 0101 ext 5", "876-CALL-NOW", "5550101"]) {
    expect(() => normalizePhoneE164(value, "JM")).toThrow(/PHONE_E164_INVALID/);
  }
});

test("legacy completion without an evidence record is evidence_missing even when its completion time is null", () => {
  expect(deriveKycVerification(legacyGapArchive("kyc")).status).toBe("evidence_missing");
  expect(deriveAgreementVerification(legacyGapArchive("agreement"), "1.3").status).toBe("evidence_missing");
});

test("invalidating OTP preserves its verified history", () => {
  const archive = otpArchive({
    invalidatedAt: LATER,
    invalidatedBy: "emp-002",
    invalidationReason: "号码无法接通",
  });
  expect(archive.otpRecords).toHaveLength(1);
  expect(archive.otpRecords[0]).toMatchObject({
    verifiedAt: NOW,
    invalidatedAt: LATER,
    invalidationReason: "号码无法接通",
  });
  expect(deriveOtpVerification(archive, "+18765550101").status).toBe("needs_reverification");
});

test("derives the active status from the latest append-only record without rewriting history", () => {
  const archive: CustomerVerificationArchive = {
    ...emptyArchive(),
    otpRecords: [
      otpArchive().otpRecords[0],
      {
        id: "otp-002",
        phoneE164: "+18765550101",
        requestedAt: LATER,
      },
    ],
  };
  expect(deriveOtpVerification(archive, "+18765550101")).toMatchObject({
    status: "pending",
    activeRecord: { id: "otp-002" },
  });
  expect(archive.otpRecords.map((record) => record.id)).toEqual(["otp-001", "otp-002"]);
});

test("derives KYC and agreement statuses from the active evidence records", () => {
  const archive: CustomerVerificationArchive = {
    ...emptyArchive(),
    kycRecords: [{
      id: "kyc-001",
      documentType: "drivers_license",
      frontAsset: asset(),
      submittedAt: NOW,
      verifiedAt: NOW,
      verifiedBy: "emp-001",
    }],
    agreementRecords: [electronicAgreement()],
  };
  expect(deriveKycVerification(archive)).toMatchObject({ status: "verified", activeRecord: { id: "kyc-001" } });
  expect(deriveAgreementVerification(archive, "1.3")).toMatchObject({ status: "signed", activeRecord: { id: "agreement-001" } });
  expect(deriveAgreementVerification(archive, "1.4").status).toBe("expired");
});

test("organization KYC derives only from scoped primary-contact records and keeps legacy records historical", () => {
  const archive: CustomerVerificationArchive = {
    ...emptyArchive(),
    kycRecords: [{
      id: "kyc-legacy-organization",
      documentType: "drivers_license",
      frontAsset: asset({ id: "asset-legacy" }),
      submittedAt: NOW,
      verifiedAt: NOW,
      verifiedBy: "emp-001",
    }, {
      id: "kyc-current-contact",
      documentType: "drivers_license",
      frontAsset: asset({ id: "asset-current" }),
      submittedAt: LATER,
      verifiedAt: LATER,
      verifiedBy: "emp-002",
      subjectType: "organization_primary_contact",
      subjectProfile: {
        name: "顾明轩",
        birthDate: "1988-06-07",
        sex: "M",
        address: "14 Contact Lane, Kingston",
      },
    }],
  };

  expect(deriveKycVerification(archive, {
    type: "organization_primary_contact",
    currentName: "顾明轩",
  })).toMatchObject({ status: "verified", activeRecord: { id: "kyc-current-contact" } });
  expect(deriveKycVerification({
    ...archive,
    kycRecords: archive.kycRecords.slice(0, 1),
  }, {
    type: "organization_primary_contact",
    currentName: "顾明轩",
  })).toEqual({ status: "pending" });
  expect(archive.kycRecords.map((record) => record.id)).toEqual([
    "kyc-legacy-organization",
    "kyc-current-contact",
  ]);
});

test("organization KYC normalizes a spaced stored contact name without rewriting the archive", () => {
  const archive: CustomerVerificationArchive = {
    ...emptyArchive(),
    kycRecords: [{
      id: "kyc-spaced-contact-name",
      documentType: "drivers_license",
      frontAsset: asset({ id: "asset-spaced-contact-name" }),
      submittedAt: NOW,
      verifiedAt: NOW,
      verifiedBy: "emp-001",
      subjectType: "organization_primary_contact",
      subjectProfile: {
        name: "  顾明轩  ",
        birthDate: "1988-06-07",
        sex: "M",
        address: "14 Contact Lane, Kingston",
      },
    }],
  };

  expect(deriveKycVerification(archive, {
    type: "organization_primary_contact",
    currentName: "顾明轩",
  })).toMatchObject({ status: "verified", activeRecord: { id: "kyc-spaced-contact-name" } });
  expect(archive.kycRecords[0]?.subjectProfile?.name).toBe("  顾明轩  ");
});

test("organization KYC compares normalized internal whitespace and Latin letter case", () => {
  const archive: CustomerVerificationArchive = {
    ...emptyArchive(),
    kycRecords: [{
      id: "kyc-normalized-contact-name",
      documentType: "drivers_license",
      frontAsset: asset({ id: "asset-normalized-contact-name" }),
      submittedAt: NOW,
      verifiedAt: NOW,
      verifiedBy: "emp-001",
      subjectType: "organization_primary_contact",
      subjectProfile: {
        name: "DWAYNE   CLARKE",
        birthDate: "1987-09-14",
        sex: "M",
        address: "14 Contact Lane, Kingston",
      },
    }],
  };

  expect(deriveKycVerification(archive, {
    type: "organization_primary_contact",
    currentName: "  Dwayne  Clarke  ",
  })).toMatchObject({ status: "verified", activeRecord: { id: "kyc-normalized-contact-name" } });
  expect(archive.kycRecords[0]?.subjectProfile?.name).toBe("DWAYNE   CLARKE");
});

test("verified organization-contact KYC needs reverification when the current contact name changes or disappears", () => {
  const archive: CustomerVerificationArchive = {
    ...emptyArchive(),
    kycRecords: [{
      id: "kyc-contact-name-snapshot",
      documentType: "drivers_license",
      frontAsset: asset({ id: "asset-contact-name" }),
      submittedAt: NOW,
      verifiedAt: NOW,
      verifiedBy: "emp-001",
      subjectType: "organization_primary_contact",
      subjectProfile: {
        name: "顾明轩",
        birthDate: "1988-06-07",
        sex: "M",
        address: "14 Contact Lane, Kingston",
      },
    }],
  };
  expect(deriveKycVerification(archive, {
    type: "organization_primary_contact",
    currentName: "顾明远",
  }).status).toBe("needs_reverification");
  expect(deriveKycVerification(archive, {
    type: "organization_primary_contact",
    currentName: null,
  }).status).toBe("needs_reverification");
  expect(deriveKycVerification(archive).status).toBe("pending");
});

test("organization pending count treats a verified legacy unscoped license as historical only", () => {
  const customer = organizationForPendingCount([{
    id: "kyc-legacy-organization",
    documentType: "drivers_license",
    frontAsset: asset(),
    submittedAt: NOW,
    verifiedAt: NOW,
    verifiedBy: "emp-001",
  }]);

  expect(pendingVerificationCount(customer)).toBe(1);
});

test("organization pending count follows the current primary-contact name without rewriting scoped history", () => {
  const record = {
    id: "kyc-scoped-organization",
    documentType: "drivers_license" as const,
    frontAsset: asset(),
    submittedAt: NOW,
    verifiedAt: NOW,
    verifiedBy: "emp-001",
    subjectType: "organization_primary_contact" as const,
    subjectProfile: {
      name: "Dwayne Clarke",
      birthDate: "1987-09-14",
      sex: "M" as const,
      address: "14 Contact Lane, Kingston",
    },
  };
  const matching = organizationForPendingCount([record]);
  const renamed = organizationForPendingCount([record], "Dwayne Cole");

  expect(pendingVerificationCount(matching)).toBe(0);
  expect(pendingVerificationCount(renamed)).toBe(1);
  expect(record.subjectProfile.name).toBe("Dwayne Clarke");
});

test("electronic agreement needs both signature and signed PDF", () => {
  expect(() => validateAgreementRecord(electronicAgreement({ signedDocumentAsset: undefined }))).toThrow(
    /AGREEMENT_EVIDENCE_REQUIRED/,
  );
  expect(() => validateAgreementRecord(electronicAgreement({ signatureAsset: undefined }))).toThrow(
    /AGREEMENT_EVIDENCE_REQUIRED/,
  );
});

test("paper agreement needs a scan or both physical archive fields", () => {
  expect(() => validateAgreementRecord(paperAgreement())).toThrow(/AGREEMENT_EVIDENCE_REQUIRED/);
  expect(() => validateAgreementRecord(paperAgreement({
    physicalRecordNumber: "PAPER-2026-001",
    physicalStorageLocation: "前台档案柜 A-03",
  }))).not.toThrow();
});

test("paper scan cannot bypass a partially filled physical archive location", () => {
  expect(() => validateAgreementRecord(paperAgreement({
    paperScanAsset: asset(),
    physicalRecordNumber: "PAPER-2026-001",
  }))).toThrow(/AGREEMENT_EVIDENCE_REQUIRED/);
  expect(() => validateAgreementRecord(paperAgreement({
    paperScanAsset: asset(),
    physicalStorageLocation: "前台档案柜 A-03",
  }))).toThrow(/AGREEMENT_EVIDENCE_REQUIRED/);
  expect(() => validateAgreementRecord(paperAgreement({
    physicalRecordNumber: "  ",
    physicalStorageLocation: "前台档案柜 A-03",
  }))).toThrow(/AGREEMENT_EVIDENCE_REQUIRED/);
});
