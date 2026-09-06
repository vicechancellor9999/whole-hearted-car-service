import { expect, test } from "@playwright/test";
import { createFormalInspectionReport, fetchFormalInspectionReport, fetchFormalInspectionReports, recordFormalInspectionNotification, saveFormalInspectionWorkspace } from "../../src/lib/api/formal-inspections";
import { inspectionDetailFixture } from "../fixtures/inspection-detail";

const savedDetail = inspectionDetailFixture;
const saveInput = { expectedVersion: 1, organized: savedDetail.workspace.organized, quotation: savedDetail.workspace.quotation, source: "manual" as const, changeReason: "前台修改检查报告与报价" };
for (const [name, body] of [
  ["truncated JSON", '{"report":'], ["empty", "{}"], ["null", "null"],
  ["different report", JSON.stringify({ ...savedDetail, report: { ...savedDetail.report, id: 10 } })],
  ["old version", JSON.stringify({ ...savedDetail, report: { ...savedDetail.report, version: 1 } })],
  ["missing workspace", JSON.stringify({ ...savedDetail, workspace: null })],
  ["invalid quote lines", JSON.stringify({ ...savedDetail, workspace: { ...savedDetail.workspace, quotation: { ...savedDetail.workspace.quotation, lines: [null] } } })],
  ["missing communications", JSON.stringify({ ...savedDetail, communications: null })],
  ["different source", JSON.stringify({ ...savedDetail, workspace: { ...savedDetail.workspace, source: "ai" } })],
] as const) {
  test(`keeps an unconfirmed save out of application state after ${name}`, async () => {
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response(body, { status: 200 }); };
    try {
      await expect(saveFormalInspectionWorkspace(9, saveInput)).rejects.toThrow("核对最新版本");
      expect(requests).toBe(1);
    } finally { globalThis.fetch = original; }
  });
}

test("workspace connection loss and 500 require verification without an automatic retry", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; throw new TypeError("Failed to fetch"); };
    await expect(saveFormalInspectionWorkspace(9, saveInput)).rejects.toThrow("核对最新版本");
    expect(requests).toBe(1);
    globalThis.fetch = async () => { requests++; return new Response("{}", { status: 500 }); };
    await expect(saveFormalInspectionWorkspace(9, saveInput)).rejects.toThrow("核对最新版本");
    expect(requests).toBe(2);
  } finally { globalThis.fetch = original; }
});

test("confirmed workspace response advances the report and preserves explicit conflict errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(savedDetail));
    expect(await saveFormalInspectionWorkspace(9, saveInput)).toEqual(savedDetail);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "报告已被其他人修改" }), { status: 409 });
    await expect(saveFormalInspectionWorkspace(9, saveInput)).rejects.toThrow("报告已被其他人修改");
  } finally { globalThis.fetch = original; }
});

for (const body of ["{}", "null", '{"report":', JSON.stringify({ ...savedDetail, report: { ...savedDetail.report, id: 10 } }), JSON.stringify({ ...savedDetail, workspace: { ...savedDetail.workspace, organized: null } })]) {
  test(`rejects unusable latest-version read ${body.slice(0, 90)}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(body);
    try { await expect(fetchFormalInspectionReport(9)).rejects.toThrow("重新读取"); }
    finally { globalThis.fetch = original; }
  });
}

const createInput = { vehicleId: 8, sourceBusinessOrderId: 12, inspectionTeamId: 3, summaryZh: "检查异响" };
const createdReport = { id: 91, reportNo: "IR-TEST-91", vehicleId: 8, sourceBusinessOrderId: 12, sourceRepairRoundId: 14, correctionOfReportId: null, correctionReason: null, inspectionTeamId: 3, summaryZh: "检查异响", summaryEn: null, specialCaseNotesZh: null, actualInspectorStaffMemberId: null, paperPhotoFileId: null, status: "draft", createdAt: "2026-09-05T12:00:00Z", submittedAt: null, version: 1, findings: [] };

for (const [name, body] of [
  ["truncated JSON", '{"id":'], ["empty object", "{}"], ["null", "null"],
  ["invalid id", JSON.stringify({ ...createdReport, id: 0 })],
  ["missing report number", JSON.stringify({ ...createdReport, reportNo: " " })],
  ["different vehicle", JSON.stringify({ ...createdReport, vehicleId: 9 })],
  ["different business order", JSON.stringify({ ...createdReport, sourceBusinessOrderId: 13 })],
  ["different team", JSON.stringify({ ...createdReport, inspectionTeamId: 4 })],
] as const) {
  test(`does not report creation success after ${name}`, async () => {
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response(body, { status: 201 }); };
    try {
      await expect(createFormalInspectionReport(createInput)).rejects.toThrow("无法确认");
      expect(requests).toBe(1);
    } finally { globalThis.fetch = original; }
  });
}

test("creation connection loss directs verification instead of claiming failure or retrying", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new TypeError("Failed to fetch"); };
  try {
    await expect(createFormalInspectionReport(createInput)).rejects.toThrow("核对");
    expect(requests).toBe(1);
  } finally { globalThis.fetch = original; }
});

test("accepts the matching created identity and preserves explicit validation failures", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(createdReport), { status: 201 });
  try {
    expect(await createFormalInspectionReport(createInput)).toEqual(createdReport);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "车辆资料无效" }), { status: 400 });
    await expect(createFormalInspectionReport(createInput)).rejects.toThrow("车辆资料无效");
    globalThis.fetch = async () => new Response(JSON.stringify({ ...createdReport, sourceBusinessOrderId: null }), { status: 201 });
    expect((await createFormalInspectionReport({ ...createInput, sourceBusinessOrderId: undefined })).sourceBusinessOrderId).toBeNull();
  } finally { globalThis.fetch = original; }
});

test("formal inspections read the formal API rather than the Mock client", async () => {
  const originalFetch = globalThis.fetch;
  let requested = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requested = String(input);
    return new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await fetchFormalInspectionReports({ sourceBusinessOrderId: 12 });
    expect(requested).toContain("/api/formal/inspection-reports");
    expect(requested).toContain("sourceBusinessOrderId=12");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const correctionInput = { inspectionReportId: 9, channel: "whatsapp" as const, targetContact: "+18765550102", noteOrReply: "状态更正：更正录入", status: "not_delivered" as const, eventKind: "status_correction" as const };
const savedCommunication = { id: 20, inspectionReportId: 9, vehicleId: 2, sourceBusinessOrderId: null, channel: "whatsapp", targetContact: "+18765550102", initiatedAt: "2026-09-05T08:00:00Z", initiatedBy: 1, status: "not_delivered", noteOrReply: "状态更正：更正录入" };

for (const [name, body] of [
  ["truncated JSON", '{"id":'],
  ["empty response", "{}"],
  ["null response", "null"],
  ["different report", JSON.stringify({ ...savedCommunication, inspectionReportId: 10 })],
  ["missing saved identity", JSON.stringify({ ...savedCommunication, id: null })],
] as const) {
  test(`does not claim a saved correction after ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(body, { status: 200 });
    try {
      await expect(recordFormalInspectionNotification(correctionInput)).rejects.toThrow("无法确认");
    } finally { globalThis.fetch = originalFetch; }
  });
}

test("returns the confirmed saved communication without another write", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return new Response(JSON.stringify(savedCommunication), { status: 200 }); };
  try {
    expect(await recordFormalInspectionNotification(correctionInput)).toEqual(savedCommunication);
    expect(requests).toBe(1);
  } finally { globalThis.fetch = originalFetch; }
});
