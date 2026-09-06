import type { FormalInspectionReportDetail } from "../../src/lib/api/formal-inspections";

export const inspectionDetailFixture: FormalInspectionReportDetail = {
  report: { id: 9, reportNo: "IR-20260905-0009", vehicleId: 2, sourceBusinessOrderId: null, sourceRepairRoundId: null, correctionOfReportId: null, correctionReason: null, inspectionTeamId: 3, summaryZh: "检查异响", summaryEn: null, specialCaseNotesZh: null, actualInspectorStaffMemberId: null, paperPhotoFileId: null, status: "draft", createdAt: "2026-09-05T08:00:00Z", submittedAt: null, version: 2, findings: [] },
  vehicle: { id: 2, plate: "4321AB", description: "Nissan X-Trail", descriptionZh: "日产 奇骏", descriptionEn: "Nissan X-Trail" },
  customer: { name: "David Blake", phone: "+18765550102", whatsapp: null, email: null },
  inspectorName: null, teamName: "车间一组", sourceBusinessOrder: null, followupStage: 2, communications: [],
  workspace: { versionNo: 1, source: "manual", changeReason: "前台修改检查报告与报价", createdAt: "2026-09-05T08:00:00Z", createdBy: 1, organized: { summaryZh: "检查异响", summaryEn: null, specialCaseNotesZh: null, findings: [] }, quotation: { status: "pending", noteZh: null, noteEn: null, lines: [] } },
};
