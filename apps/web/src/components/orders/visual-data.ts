// ============================================================
// Visual-layer demo data — 工单管理 operations center
//
// This file provides the visual data for inspection reports, AI
// drafts, versions, process counts, first-inspection balance,
// team workload, and the unified document list. It is defined
// here (in the components layer) because the domain API (owned
// by Codex) does not yet expose these concepts. When the API is
// ready, these shapes will be replaced by real API responses.
//
// Per the spec: system provides facts, never auto-assigns.
// ============================================================

import type {
  DocumentListItem,
  FirstInspectionBalance,
  FlowStageId,
  InspectionReportDetail,
  ProcessCount,
  TeamWorkload,
} from "./types";

// ------------------------------------------------------------
// Today's ordinary-vehicle first-inspection balance
// Spec §4.1: only 车间一组 vs 车间二组; engineering and
// sheet-metal/paint teams are special diversions, excluded.
// Target reference for ~20 cars is 10/10 — not a quota.
// ------------------------------------------------------------
export const FIRST_INSPECTION_BALANCE: FirstInspectionBalance = {
  t1: 10,
  t2: 10,
  distinctOrdinaryVehicles: 20,
  difference: 0,
};

// ------------------------------------------------------------
// Four-team real-time workload
// Spec §4.2: counts by effective work tasks, not reports or
// list rows. "Returned to frontdesk" is shown but NOT counted
// in mechanic in-hand workload. No fake capacity or percentage.
// ------------------------------------------------------------
export const TEAM_WORKLOADS: TeamWorkload[] = [
  {
    teamId: "t1",
    teamName: "车间一组",
    inspectionAwaiting: 0,
    inspectionInProgress: 0,
    repairAwaiting: 2,
    repairInProgress: 1,
    blocked: 0,
    returnedAwaitingFrontdesk: 1,
    activeTotal: 3,
  },
  {
    teamId: "t2",
    teamName: "车间二组",
    inspectionAwaiting: 2,
    inspectionInProgress: 2,
    repairAwaiting: 1,
    repairInProgress: 3,
    blocked: 1,
    returnedAwaitingFrontdesk: 0,
    activeTotal: 8,
  },
  {
    teamId: "t3",
    teamName: "工程机械组",
    inspectionAwaiting: 0,
    inspectionInProgress: 1,
    repairAwaiting: 0,
    repairInProgress: 1,
    blocked: 0,
    returnedAwaitingFrontdesk: 0,
    activeTotal: 2,
  },
  {
    teamId: "t4",
    teamName: "钣金喷漆组",
    inspectionAwaiting: 1,
    inspectionInProgress: 0,
    repairAwaiting: 1,
    repairInProgress: 0,
    blocked: 0,
    returnedAwaitingFrontdesk: 1,
    activeTotal: 2,
  },
];

// ------------------------------------------------------------
// Process counts — clickable chips that filter the list
// Spec §5.3: grouped by flow stage.
// ------------------------------------------------------------
export const PROCESS_COUNTS: ProcessCount[] = [
  { id: "inspection_awaiting_dispatch", label: "检查待派", count: 2, group: "inspection" },
  { id: "inspection_awaiting_acceptance", label: "待接检查", count: 1, group: "inspection" },
  { id: "inspection_in_progress", label: "检查中", count: 2, group: "inspection" },
  { id: "inspection_awaiting_frontdesk", label: "检查待前台核对", count: 1, group: "inspection" },
  { id: "quote_awaiting_customer", label: "报价待客户决定", count: 2, group: "quotation" },
  { id: "quote_accepted_awaiting_order", label: "客户已采用待成立工单", count: 1, group: "quotation" },
  { id: "repair_awaiting_dispatch", label: "维修待派", count: 0, group: "repair" },
  { id: "repair_awaiting_acceptance", label: "待接维修", count: 3, group: "repair" },
  { id: "repair_in_progress", label: "维修施工中", count: 2, group: "repair" },
  { id: "blocked", label: "阻滞中", count: 0, group: "repair" },
  { id: "returned_awaiting_frontdesk", label: "回单待前台", count: 2, group: "handover" },
  { id: "awaiting_formal_handover", label: "待正式交单", count: 0, group: "handover" },
  { id: "submitted_awaiting_collection", label: "已交单待取车", count: 1, group: "handover" },
  { id: "vehicle_collected", label: "已取车", count: 2, group: "handover" },
];

// ------------------------------------------------------------
// Unified document list
// Combines inspection reports (visual demo) with business orders
// (from API). Each row shows the spec §5.4 fields.
// ------------------------------------------------------------
export const VISUAL_DOCUMENTS: DocumentListItem[] = [
  // --- Inspection reports (not yet converted to business orders) ---
  {
    id: "ir-001",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919422",
    version: "V3",
    resultDocNo: "KGN-WH-2026080919422",
    customer: { nameZh: "陈美玲", nameEn: "Meiling Chen", phone: "+1 876-555-0101" },
    vehicle: { plate: "8765 JZ", modelZh: "丰田海狮", modelEn: "Toyota Hiace" },
    flowStage: "inspection_awaiting_frontdesk",
    teamId: "t1",
    teamName: "车间一组",
    handler: "Marcus Brown",
    stageDurationLabel: "12 分钟",
    nextStep: "前台核对",
    updatedAt: "2026-08-09T18:30:00-05:00",
    updatedBy: "Marcus Brown",
    amountJmd: 15500,
  },
  {
    id: "ir-002",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919423",
    customer: { nameZh: "林淑芬", nameEn: "Shufen Lin", phone: "+1 876-555-0120" },
    vehicle: { plate: "7711 FD", modelZh: "本田思域", modelEn: "Honda Civic" },
    flowStage: "inspection_in_progress",
    teamId: "t2",
    teamName: "车间二组",
    handler: "Owen Campbell",
    stageDurationLabel: "35 分钟",
    nextStep: "维修工提交检查",
    updatedAt: "2026-08-09T18:05:00-05:00",
    updatedBy: "Owen Campbell",
  },
  {
    id: "ir-003",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919424",
    customer: { nameZh: "詹姆斯·布朗", nameEn: "James Brown", phone: "+1 876-555-0121" },
    vehicle: { plate: "5544 KL", modelZh: "丰田普拉多", modelEn: "Toyota Prado" },
    flowStage: "quote_awaiting_customer",
    teamId: "t1",
    teamName: "车间一组",
    handler: "前台 王建华",
    stageDurationLabel: "2 小时",
    nextStep: "客户决定",
    updatedAt: "2026-08-09T16:00:00-05:00",
    updatedBy: "王建华",
    amountJmd: 38000,
  },
  {
    id: "ir-004",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919425",
    customer: { nameZh: "玛丽亚·琼斯", nameEn: "Maria Jones", phone: "+1 876-555-0122" },
    vehicle: { plate: "3322 GH", modelZh: "马自达3", modelEn: "Mazda 3" },
    flowStage: "quote_accepted_awaiting_order",
    teamId: "t2",
    teamName: "车间二组",
    handler: "前台 王建华",
    stageDurationLabel: "45 分钟",
    nextStep: "前台成立工单",
    updatedAt: "2026-08-09T17:55:00-05:00",
    updatedBy: "王建华",
    amountJmd: 25000,
  },
  {
    id: "ir-005",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919426",
    customer: { nameZh: "罗伯特·李", nameEn: "Robert Lee", phone: "+1 876-555-0123" },
    vehicle: { plate: "9988 PL", modelZh: "铃木雨燕", modelEn: "Suzuki Swift" },
    flowStage: "inspection_awaiting_dispatch",
    handler: "—",
    stageDurationLabel: "8 分钟",
    nextStep: "前台派检",
    updatedAt: "2026-08-09T18:35:00-05:00",
    updatedBy: "前台 王建华",
  },
  {
    id: "ir-006",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919427",
    customer: { nameZh: "丽莎·陈", nameEn: "Lisa Chen", phone: "+1 876-555-0124" },
    vehicle: { plate: "2211 RT", modelZh: "日产骐达", modelEn: "Nissan Tiida" },
    flowStage: "quote_awaiting_customer",
    teamId: "t1",
    teamName: "车间一组",
    handler: "前台 王建华",
    stageDurationLabel: "1 小时",
    nextStep: "客户决定",
    updatedAt: "2026-08-09T17:30:00-05:00",
    updatedBy: "王建华",
    amountJmd: 18000,
  },
  {
    id: "ir-007",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919428",
    customer: { nameZh: "陈美玲", nameEn: "Meiling Chen", phone: "+1 876-555-0101" },
    vehicle: { plate: "8765 JZ", modelZh: "丰田海狮", modelEn: "Toyota Hiace" },
    flowStage: "inspection_in_progress",
    teamId: "t2",
    teamName: "车间二组",
    handler: "Owen Campbell",
    stageDurationLabel: "20 分钟",
    nextStep: "维修工提交检查",
    updatedAt: "2026-08-09T18:20:00-05:00",
    updatedBy: "Owen Campbell",
  },
  {
    id: "ir-008",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919429",
    customer: { nameZh: "黄国强", nameEn: "Guoqiang Huang", phone: "+1 876-555-0125" },
    vehicle: { plate: "6655 BN", modelZh: "现代伊兰特", modelEn: "Hyundai Elantra" },
    flowStage: "inspection_awaiting_acceptance",
    teamId: "t4",
    teamName: "钣金喷漆组",
    handler: "Andre Lewis",
    stageDurationLabel: "5 分钟",
    nextStep: "维修工接检查",
    updatedAt: "2026-08-09T18:38:00-05:00",
    updatedBy: "前台 王建华",
  },
  {
    id: "ir-009",
    type: "inspection",
    docNo: "KGN-WH-IR-2026080919430",
    customer: { nameZh: "艾玛·威尔逊", nameEn: "Emma Wilson", phone: "+1 876-555-0126" },
    vehicle: { plate: "1199 XM", modelZh: "起亚锐欧", modelEn: "Kia Rio" },
    flowStage: "inspection_awaiting_dispatch",
    handler: "—",
    stageDurationLabel: "3 分钟",
    nextStep: "前台派检",
    updatedAt: "2026-08-09T18:40:00-05:00",
    updatedBy: "前台 王建华",
  },

  // --- Business orders (repair in progress) ---
  {
    id: "bo-001",
    type: "business",
    docNo: "KGN-WH-2026080819401",
    sourceDocNo: "KGN-WH-IR-2026080819390",
    version: "V1",
    customer: { nameZh: "戴维·布莱克", nameEn: "David Blake", phone: "+1 876-555-0102" },
    vehicle: { plate: "4321 AB", modelZh: "日产奇骏", modelEn: "Nissan X-Trail" },
    flowStage: "repair_awaiting_acceptance",
    teamId: "t1",
    teamName: "车间一组",
    handler: "Marcus Brown",
    stageDurationLabel: "15 分钟",
    nextStep: "维修工接单",
    updatedAt: "2026-08-09T18:25:00-05:00",
    updatedBy: "王建华",
    amountJmd: 28000,
  },
  {
    id: "bo-002",
    type: "business",
    docNo: "KGN-WH-2026080819402",
    sourceDocNo: "KGN-WH-IR-2026080819391",
    version: "V1",
    customer: { nameZh: "王小梅", nameEn: "Xiaomei Wang", phone: "+1 876-555-0103" },
    vehicle: { plate: "P 1234", modelZh: "本田飞度", modelEn: "Honda Fit" },
    flowStage: "repair_in_progress",
    teamId: "t1",
    teamName: "车间一组",
    handler: "Marcus Brown",
    stageDurationLabel: "3 小时",
    nextStep: "维修工回交",
    updatedAt: "2026-08-09T15:25:00-05:00",
    updatedBy: "Marcus Brown",
    amountJmd: 40000,
  },
  {
    id: "bo-003",
    type: "business",
    docNo: "KGN-WH-2026080819403",
    sourceDocNo: "KGN-WH-IR-2026080819392",
    version: "V1",
    customer: { nameZh: "安东尼·格兰特", nameEn: "Anthony Grant", phone: "+1 876-555-0104" },
    vehicle: { plate: "7788 KM", modelZh: "铃木雨燕", modelEn: "Suzuki Swift" },
    flowStage: "returned_awaiting_frontdesk",
    teamId: "t1",
    teamName: "车间一组",
    handler: "前台 王建华",
    stageDurationLabel: "1 小时",
    nextStep: "前台核对回交",
    updatedAt: "2026-08-09T15:10:00-05:00",
    updatedBy: "Marcus Brown",
    amountJmd: 17500,
  },
  {
    id: "bo-004",
    type: "business",
    docNo: "KGN-WH-2026080819404",
    sourceDocNo: "KGN-WH-IR-2026080819393",
    version: "V2",
    customer: { nameZh: "李志强", nameEn: "Zhiqiang Li", phone: "+1 876-555-0105" },
    vehicle: { plate: "CC 9087", modelZh: "丰田卡罗拉", modelEn: "Toyota Corolla" },
    flowStage: "submitted_awaiting_collection",
    teamId: "t2",
    teamName: "车间二组",
    handler: "前台 王建华",
    stageDurationLabel: "4 小时",
    nextStep: "客户取车",
    updatedAt: "2026-08-09T14:55:00-05:00",
    updatedBy: "王建华",
    amountJmd: 30000,
  },
  {
    id: "bo-005",
    type: "business",
    docNo: "KGN-WH-2026080819405",
    sourceDocNo: "KGN-WH-IR-2026080819394",
    version: "V1",
    customer: { nameZh: "彼得·摩根", nameEn: "Peter Morgan", phone: "+1 876-555-0108" },
    vehicle: { plate: "EQ 5501", modelZh: "小松挖掘机", modelEn: "Komatsu Excavator" },
    flowStage: "repair_in_progress",
    teamId: "t3",
    teamName: "工程机械组",
    handler: "Devon Reid",
    stageDurationLabel: "4 小时",
    nextStep: "维修工回交",
    updatedAt: "2026-08-09T14:25:00-05:00",
    updatedBy: "Devon Reid",
    amountJmd: 60000,
  },
  {
    id: "bo-006",
    type: "business",
    docNo: "KGN-WH-2026080819406",
    sourceDocNo: "KGN-WH-IR-2026080819395",
    version: "V1",
    customer: { nameZh: "迈克尔·史密斯", nameEn: "Michael Smith", phone: "+1 876-555-0110" },
    vehicle: { plate: "BS 2048", modelZh: "现代途胜", modelEn: "Hyundai Tucson" },
    flowStage: "returned_awaiting_frontdesk",
    teamId: "t4",
    teamName: "钣金喷漆组",
    handler: "前台 王建华",
    stageDurationLabel: "2 小时",
    nextStep: "前台核对回交",
    updatedAt: "2026-08-09T13:55:00-05:00",
    updatedBy: "Andre Lewis",
    amountJmd: 50000,
  },
  {
    id: "bo-007",
    type: "business",
    docNo: "KGN-WH-2026080819407",
    sourceDocNo: "KGN-WH-IR-2026080819396",
    version: "V1",
    customer: { nameZh: "莎拉·威廉姆斯", nameEn: "Sarah Williams", phone: "+1 876-555-0109" },
    vehicle: { plate: "PA 6654", modelZh: "马自达CX-5", modelEn: "Mazda CX-5" },
    flowStage: "repair_awaiting_dispatch",
    teamId: "t4",
    teamName: "钣金喷漆组",
    handler: "—",
    stageDurationLabel: "10 分钟",
    nextStep: "前台派维修",
    updatedAt: "2026-08-09T18:30:00-05:00",
    updatedBy: "前台 王建华",
    amountJmd: 8000,
  },
  {
    id: "bo-008",
    type: "business",
    docNo: "KGN-WH-2026080919422",
    sourceDocNo: "KGN-WH-IR-2026080919422",
    version: "V3",
    customer: { nameZh: "陈美玲", nameEn: "Meiling Chen", phone: "+1 876-555-0101" },
    vehicle: { plate: "8765 JZ", modelZh: "丰田海狮", modelEn: "Toyota Hiace" },
    flowStage: "blocked",
    teamId: "t1",
    teamName: "车间一组",
    handler: "Marcus Brown",
    stageDurationLabel: "3 小时",
    nextStep: "等机油滤芯到货",
    updatedAt: "2026-08-09T15:30:00-05:00",
    updatedBy: "Marcus Brown",
    amountJmd: 11500,
  },
  {
    id: "bo-009",
    type: "business",
    docNo: "KGN-WH-2026080919423",
    sourceDocNo: "KGN-WH-IR-2026080919431",
    version: "V1",
    customer: { nameZh: "凯文·张", nameEn: "Kevin Zhang", phone: "+1 876-555-0128" },
    vehicle: { plate: "7766 SD", modelZh: "本田CR-V", modelEn: "Honda CR-V" },
    flowStage: "repair_in_progress",
    teamId: "t1",
    teamName: "车间一组",
    handler: "David Williams",
    stageDurationLabel: "2 小时",
    nextStep: "维修工回交",
    updatedAt: "2026-08-09T16:30:00-05:00",
    updatedBy: "David Williams",
    amountJmd: 35000,
  },
  {
    id: "bo-010",
    type: "business",
    docNo: "KGN-WH-2026080919424",
    sourceDocNo: "KGN-WH-IR-2026080919432",
    version: "V1",
    customer: { nameZh: "陈雅婷", nameEn: "Yating Chen", phone: "+1 876-555-0129" },
    vehicle: { plate: "5512 VC", modelZh: "日产天籁", modelEn: "Nissan Teana" },
    flowStage: "awaiting_formal_handover",
    teamId: "t2",
    teamName: "车间二组",
    handler: "前台 王建华",
    stageDurationLabel: "30 分钟",
    nextStep: "前台正式交单",
    updatedAt: "2026-08-09T18:10:00-05:00",
    updatedBy: "Owen Campbell",
    amountJmd: 22000,
  },

  // --- Completed history ---
  {
    id: "co-001",
    type: "completed",
    docNo: "KGN-WH-2026080819408",
    sourceDocNo: "KGN-WH-IR-2026080819397",
    version: "V2",
    customer: { nameZh: "克里斯托弗·杨", nameEn: "Christopher Young", phone: "+1 876-555-0106" },
    vehicle: { plate: "9123 HG", modelZh: "三菱L200", modelEn: "Mitsubishi L200" },
    flowStage: "vehicle_collected",
    teamId: "t2",
    teamName: "车间二组",
    handler: "—",
    stageDurationLabel: "已完结",
    nextStep: "—",
    updatedAt: "2026-08-08T14:40:00-05:00",
    updatedBy: "李美玲",
    amountJmd: 30000,
  },
  {
    id: "co-002",
    type: "completed",
    docNo: "KGN-WH-2026080819409",
    sourceDocNo: "KGN-WH-IR-2026080819398",
    version: "V1",
    customer: { nameZh: "格雷斯·约翰逊", nameEn: "Grace Johnson", phone: "+1 876-555-0107" },
    vehicle: { plate: "5678 DR", modelZh: "起亚狮跑", modelEn: "Kia Sportage" },
    flowStage: "vehicle_collected",
    teamId: "t2",
    teamName: "车间二组",
    handler: "—",
    stageDurationLabel: "已完结",
    nextStep: "—",
    updatedAt: "2026-08-08T13:40:00-05:00",
    updatedBy: "李美玲",
    amountJmd: 25000,
  },
];

// ------------------------------------------------------------
// Inspection report detail — for the modal
// Spec §5.5 & §3: NL original + AI draft + versions + decisions
// ------------------------------------------------------------
export const INSPECTION_REPORTS: Record<string, InspectionReportDetail> = {
  "ir-001": {
    irNo: "KGN-WH-IR-2026080919422",
    customer: { nameZh: "陈美玲", nameEn: "Meiling Chen", phone: "+1 876-555-0101" },
    vehicle: { plate: "8765 JZ", modelZh: "丰田海狮", modelEn: "Toyota Hiace" },
    submittedBy: { id: "m-001", name: "Marcus Brown", teamId: "t1", teamName: "车间一组" },
    submittedAt: "2026-08-09T18:18:00-05:00",
    naturalLanguageText:
      "车辆进厂客户反映发动机故障灯亮，怠速不稳。检查发现节气门积碳严重，需要清洗。同时发现机油滤芯老化建议更换，机油也需要更换。刹车片磨损到极限建议更换前刹车片。轮胎气压正常，底盘无异响。里程数 125,800 km。拍照记录了节气门和刹车片状态。",
    mileage: "125,800 km",
    photoCount: 3,
    aiDraft: {
      conclusion: "发动机故障灯亮，怠速不稳。节气门积碳严重需清洗；机油及滤芯需更换；前刹车片磨损到极限需更换。",
      items: [
        { id: "i-1", nameZh: "节气门清洗", nameEn: "Throttle Body Cleaning", laborJmd: 5000, quantity: 1 },
        { id: "i-2", nameZh: "更换机油及滤芯", nameEn: "Oil & Filter Change", laborJmd: 3000, partsName: "机油滤芯", partsJmd: 3500, quantity: 1 },
        { id: "i-3", nameZh: "更换前刹车片", nameEn: "Front Brake Pads", laborJmd: 4000, partsName: "前刹车片", partsJmd: 7000, quantity: 1 },
      ],
      customerNoteZh: "建议客户先处理刹车片和机油，节气门清洗可酌情安排。",
      customerNoteEn: "Recommend customer prioritize brake pads and oil change; throttle cleaning can be scheduled flexibly.",
    },
    versions: [
      {
        version: "V1",
        publishedAt: "2026-08-09T18:25:00-05:00",
        publishedBy: "王建华",
        items: [
          { id: "i-1", nameZh: "节气门清洗", nameEn: "Throttle Body Cleaning", laborJmd: 5000, quantity: 1, customerDecision: "accepted" },
          { id: "i-2", nameZh: "更换机油及滤芯", nameEn: "Oil & Filter Change", laborJmd: 3000, partsName: "机油滤芯", partsJmd: 3500, quantity: 1, customerDecision: "accepted" },
          { id: "i-3", nameZh: "更换前刹车片", nameEn: "Front Brake Pads", laborJmd: 4000, partsName: "前刹车片", partsJmd: 7000, quantity: 1, customerDecision: "pending" },
        ],
      },
      {
        version: "V2",
        publishedAt: "2026-08-09T18:32:00-05:00",
        publishedBy: "王建华",
        items: [
          { id: "i-1", nameZh: "节气门清洗", nameEn: "Throttle Body Cleaning", laborJmd: 5000, quantity: 1, customerDecision: "accepted" },
          { id: "i-2", nameZh: "更换机油及滤芯", nameEn: "Oil & Filter Change", laborJmd: 3000, partsName: "机油滤芯", partsJmd: 3500, quantity: 1, customerDecision: "accepted" },
          { id: "i-3", nameZh: "更换前刹车片", nameEn: "Front Brake Pads", laborJmd: 4000, partsName: "前刹车片", partsJmd: 6500, quantity: 1, customerDecision: "pending" },
        ],
      },
      {
        version: "V3",
        publishedAt: "2026-08-09T18:40:00-05:00",
        publishedBy: "王建华",
        items: [
          { id: "i-1", nameZh: "节气门清洗", nameEn: "Throttle Body Cleaning", laborJmd: 5000, quantity: 1, customerDecision: "accepted" },
          { id: "i-2", nameZh: "更换机油及滤芯", nameEn: "Oil & Filter Change", laborJmd: 3000, partsName: "机油滤芯", partsJmd: 3500, quantity: 1, customerDecision: "accepted" },
          { id: "i-3", nameZh: "更换前刹车片", nameEn: "Front Brake Pads", laborJmd: 4000, partsName: "前刹车片", partsJmd: 6500, quantity: 1, customerDecision: "rejected" },
        ],
      },
    ],
    currentVersion: "V3",
    linkedOrderNo: "KGN-WH-2026080919422",
    convertedItemIds: ["i-1", "i-2"],
    conversionReferences: [
      {
        sourceVersion: "V3",
        sourceItemId: "i-1",
        sourceItemName: "节气门清洗",
        linkedOrderNo: "KGN-WH-2026080919422",
      },
      {
        sourceVersion: "V3",
        sourceItemId: "i-2",
        sourceItemName: "更换机油及滤芯",
        linkedOrderNo: "KGN-WH-2026080919422",
      },
    ],
    reassignmentHistory: [],
  },
  "ir-003": {
    irNo: "KGN-WH-IR-2026080919424",
    customer: { nameZh: "詹姆斯·布朗", nameEn: "James Brown", phone: "+1 876-555-0121" },
    vehicle: { plate: "5544 KL", modelZh: "丰田普拉多", modelEn: "Toyota Prado" },
    submittedBy: { id: "m-002", name: "Marcus Brown", teamId: "t1", teamName: "车间一组" },
    submittedAt: "2026-08-09T14:30:00-05:00",
    naturalLanguageText:
      "客户车辆空调不制冷。检查发现空调压缩机皮带断裂，压缩机本身也有异响，建议更换压缩机和皮带。同时检查了冷媒，已经泄漏完毕需要重新加注。散热器外观正常没有泄漏。里程数 89,200 km。",
    mileage: "89,200 km",
    photoCount: 2,
    aiDraft: {
      conclusion: "空调不制冷。压缩机皮带断裂且压缩机异响，需更换压缩机和皮带；冷媒已泄漏需重新加注。",
      items: [
        { id: "i-1", nameZh: "更换空调压缩机", nameEn: "AC Compressor Replacement", laborJmd: 12000, partsName: "空调压缩机", partsJmd: 18000, quantity: 1 },
        { id: "i-2", nameZh: "更换压缩机皮带", nameEn: "Compressor Belt Replacement", laborJmd: 2000, partsName: "压缩机皮带", partsJmd: 3000, quantity: 1 },
        { id: "i-3", nameZh: "冷媒加注", nameEn: "Refrigerant Recharge", laborJmd: 3000, partsName: "冷媒", partsJmd: 5000, quantity: 1 },
      ],
      customerNoteZh: "压缩机更换费用较高，已向客户说明。皮带和冷媒为必须配套项目。",
      customerNoteEn: "Compressor replacement cost is high, customer has been informed. Belt and refrigerant are required companion items.",
    },
    versions: [
      {
        version: "V1",
        publishedAt: "2026-08-09T15:00:00-05:00",
        publishedBy: "王建华",
        items: [
          { id: "i-1", nameZh: "更换空调压缩机", nameEn: "AC Compressor Replacement", laborJmd: 12000, partsName: "空调压缩机", partsJmd: 18000, quantity: 1, customerDecision: "pending" },
          { id: "i-2", nameZh: "更换压缩机皮带", nameEn: "Compressor Belt Replacement", laborJmd: 2000, partsName: "压缩机皮带", partsJmd: 3000, quantity: 1, customerDecision: "pending" },
          { id: "i-3", nameZh: "冷媒加注", nameEn: "Refrigerant Recharge", laborJmd: 3000, partsName: "冷媒", partsJmd: 5000, quantity: 1, customerDecision: "pending" },
        ],
      },
    ],
    currentVersion: "V1",
    convertedItemIds: [],
    reassignmentHistory: [],
  },
};

/**
 * Return detail for the selected document only. Missing demo details are represented
 * honestly instead of borrowing another customer's signed inspection result.
 */
export function getInspectionReport(document: DocumentListItem): InspectionReportDetail {
  const configured = INSPECTION_REPORTS[document.id];
  if (configured) return configured;

  const sourceShouldExist = document.flowStage !== "inspection_awaiting_dispatch"
    && document.flowStage !== "inspection_awaiting_acceptance"
    && document.flowStage !== "inspection_in_progress";
  const sourceState = sourceShouldExist ? "尚未载入" : "尚未提交";
  return {
    irNo: document.docNo,
    ...(document.resultDocNo ? { linkedOrderNo: document.resultDocNo } : {}),
    customer: { ...document.customer },
    vehicle: { ...document.vehicle },
    submittedBy: {
      id: "—",
      name: sourceState,
      ...(document.teamId ? { teamId: document.teamId } : {}),
      teamName: document.teamName ?? "未派组",
    },
    naturalLanguageText: sourceShouldExist
      ? "该检查单的签名原文尚未载入。本页不会用前台处理人、更新时间或其他客户的检查结果代替维修工原始提交。"
      : "当前仍在派检或检查流程，维修工尚未提交署名的自然语言检查结果。",
    photoCount: 0,
    aiDraft: {
      conclusion: sourceShouldExist
        ? "签名原文载入后才能生成结构化报价草稿。"
        : "尚无署名检查原文，AI 不生成诊断或报价内容。",
      items: [],
      customerNoteZh: "AI 不会在缺少原始检查事实时补写结论。",
      customerNoteEn: "AI does not add findings without signed source facts.",
    },
    versions: [],
    currentVersion: document.version ?? "未发布",
    convertedItemIds: [],
    reassignmentHistory: [],
  };
}

/** Check if a business order is eligible for manual reassignment.
 *  Per spec §3.5: allowed after business order creation, before formal handover. */
export function canReassign(flowStage: FlowStageId): boolean {
  // Allowed: after order creation, before formal handover
  const eligibleStages: FlowStageId[] = [
    "repair_awaiting_dispatch",
    "repair_awaiting_acceptance",
    "repair_in_progress",
    "blocked",
    "returned_awaiting_frontdesk",
    "awaiting_formal_handover",
  ];
  return eligibleStages.includes(flowStage);
}
