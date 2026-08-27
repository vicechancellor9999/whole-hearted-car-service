import { expect, test } from "@playwright/test";
import {
  aggregateImplementationMetrics,
  calculateImplementationMetric,
} from "../../src/lib/orders/implementation-metrics";
import { createInspectionSubmission } from "../../src/lib/orders/inspection-types";
import {
  createInspectionSubmissionReference,
  type InspectionReport,
} from "../../src/lib/orders/inspection-report";
import type { SourceProjectMetricRecord } from "../../src/lib/orders/implementation-metrics";

const completedSourceLink = {
  inspectionReportId: "ir-1",
  inspectionItemId: "inspection-item-1",
  quotationId: "qt-1",
  quotationVersionId: "qt-version-1",
  quotationItemId: "qt-item-1",
  businessOrderId: "bo-1",
  businessOrderItemId: "bo-item-1",
  inspectorTeamId: "t1",
  executionTeamId: "t2",
  executionStatus: "completed",
} as const;

test("aggregates traceable source projects by unique source key, not average percentages", () => {
  const aggregate = aggregateImplementationMetrics([
    {
      inspectionReportId: "ir-1",
      quotationVersionId: "qt-version-1",
      quotationItemId: "qt-item-1",
      inspectorTeamId: "t1",
      isValidRecommendation: true,
      accepted: true,
      businessOrderLinks: [completedSourceLink],
    },
    {
      inspectionReportId: "ir-1",
      quotationVersionId: "qt-version-1",
      quotationItemId: "qt-item-1",
      inspectorTeamId: "t1",
      isValidRecommendation: true,
      accepted: true,
      businessOrderLinks: [{ ...completedSourceLink, businessOrderItemId: "split-bo-row" }],
    },
    {
      inspectionReportId: "ir-2",
      quotationVersionId: "qt-version-2",
      quotationItemId: "qt-item-2",
      inspectorTeamId: "t1",
      isValidRecommendation: true,
      accepted: false,
      businessOrderLinks: [],
    },
  ] satisfies ReadonlyArray<SourceProjectMetricRecord>);

  expect(aggregate.overall).toMatchObject({ proposed: 2, accepted: 1, converted: 1, completed: 1, implementationRate: 0.5 });
  expect(aggregate.byInspectorTeam.t1).toMatchObject({ proposed: 2, completed: 1, implementationRate: 0.5 });
  expect(aggregate.byExecutionTeam.t2).toMatchObject({ proposed: 1, completed: 1, implementationRate: 1 });
});

test("keeps adoption and completion rates as separate project-count facts", () => {
  expect(calculateImplementationMetric({ proposed: 4, accepted: 2, converted: 2, completed: 1 }))
    .toEqual({
      proposed: 4,
      accepted: 2,
      converted: 2,
      completed: 1,
      adoptionRate: 0.5,
      implementationRate: 0.25,
      acceptedCompletionRate: 0.5,
    });
});

test("marks a zero-denominator metric as not applicable instead of zero percent", () => {
  expect(calculateImplementationMetric({ proposed: 0, accepted: 0, converted: 0, completed: 0 }))
    .toMatchObject({ adoptionRate: null, implementationRate: null, acceptedCompletionRate: null });
});

test("Inspection Report keeps a factory-produced immutable submission reference", () => {
  const submission = createInspectionSubmission({
    id: "submission-1",
    inspectionReportNo: "KGN-WH-IR-2026080919422",
    vehicleId: "vehicle-1",
    inspectorId: "mechanic-1",
    inspectorName: "维修工甲",
    inspectorTeamId: "t1",
    submittedAt: "2026-08-10T10:00:00.000Z",
    naturalLanguageResult: "刹车异响",
    suggestedLaborItems: [],
    suggestedPartItems: [],
    photos: [],
    mileageKm: 100_000,
    sourceVersion: 1,
    submissionSource: "mechanic_mobile",
  });
  const submissionRef = createInspectionSubmissionReference(submission);
  const report = {
    id: "ir-1",
    inspectionReportNo: "KGN-WH-IR-2026080919422",
    customerId: "customer-1",
    vehicleId: "vehicle-1",
    status: "awaiting_frontdesk",
    submissionRef,
    itemIds: [],
  } satisfies InspectionReport;

  expect(Object.isFrozen(submissionRef)).toBe(true);
  expect(report.submissionRef.submissionVersion).toBe(1);
  expect(() => Object.assign(submission, { submittedAt: "2099-01-01T00:00:00.000Z" })).toThrow();
  expect(report.submissionRef.submittedAt).toBe("2026-08-10T10:00:00.000Z");
  expect(() => createInspectionSubmissionReference({ id: "ordinary" } as never)).toThrow(/冻结/);
  expect(() => createInspectionSubmissionReference(Object.freeze({ id: "ordinary", sourceVersion: 1, submittedAt: "2026-08-10T10:00:00.000Z" }) as never))
    .toThrow(/检查报告|车辆|检查人/);
});

test("validates recommendation status per source before aggregates can mask it", () => {
  const invalidAccepted = {
    inspectionReportId: "ir-invalid", quotationVersionId: "v1", quotationItemId: "q1", inspectorTeamId: "t1",
    isValidRecommendation: false, accepted: true, businessOrderLinks: [],
  } satisfies SourceProjectMetricRecord;
  const validAccepted = {
    inspectionReportId: "ir-valid", quotationVersionId: "v1", quotationItemId: "q1", inspectorTeamId: "t1",
    isValidRecommendation: true, accepted: true, businessOrderLinks: [{
      ...completedSourceLink,
      inspectionReportId: "ir-valid",
      quotationVersionId: "v1",
      quotationItemId: "q1",
    }],
  } satisfies SourceProjectMetricRecord;
  expect(() => aggregateImplementationMetrics([invalidAccepted, validAccepted])).toThrow(/无效建议.*采用/);
  expect(aggregateImplementationMetrics([{
    inspectionReportId: "ir-invalid", quotationVersionId: "v1", quotationItemId: "q1", inspectorTeamId: "t1",
    isValidRecommendation: false, accepted: false, businessOrderLinks: [],
  }]).overall.proposed).toBe(0);
  expect(() => aggregateImplementationMetrics([{
    inspectionReportId: "ir-invalid-linked", quotationVersionId: "v1", quotationItemId: "q1", inspectorTeamId: "t1",
    isValidRecommendation: false, accepted: false, businessOrderLinks: [{
      ...completedSourceLink,
      inspectionReportId: "ir-invalid-linked",
      quotationVersionId: "v1",
      quotationItemId: "q1",
    }],
  }])).toThrow(/无效建议.*业务单/);
  expect(() => aggregateImplementationMetrics([{
    inspectionReportId: "ir-unaccepted", quotationVersionId: "v1", quotationItemId: "q1", inspectorTeamId: "t1",
    isValidRecommendation: true, accepted: false, businessOrderLinks: [completedSourceLink],
  }])).toThrow(/未采用.*业务单/);
  expect(() => aggregateImplementationMetrics([
    { inspectionReportId: "ir-duplicate", quotationVersionId: "v1", quotationItemId: "q1", inspectorTeamId: "t1", isValidRecommendation: true, accepted: false, businessOrderLinks: [] },
    { inspectionReportId: "ir-duplicate", quotationVersionId: "v1", quotationItemId: "q1", inspectorTeamId: "t1", isValidRecommendation: false, accepted: false, businessOrderLinks: [] },
  ])).toThrow(/有效性.*一致/);
});

test("rejects invalid or impossible source project counts", () => {
  expect(() => calculateImplementationMetric({ proposed: Number.NaN, accepted: 0, converted: 0, completed: 0 }))
    .toThrow(/有效建议项目数/);
  expect(() => calculateImplementationMetric({ proposed: 1, accepted: 2, converted: 1, completed: 1 }))
    .toThrow(/采用项目数/);
  expect(() => calculateImplementationMetric({ proposed: 1, accepted: 1, converted: 0, completed: 1 }))
    .toThrow(/完成项目数/);
});
