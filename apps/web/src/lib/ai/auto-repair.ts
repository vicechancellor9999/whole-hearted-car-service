import { deepseekChat } from "./deepseek";
import type { ParsedInspectionItem } from "../orders/ir-nl-parse";
import type { ParsedChargeEntry, ParsedChargeNote, ParsedQuickItem } from "../orders/nl-parse";

/**
 * 牙买加汽修场景 AI（DeepSeek）：拆单 + 翻译。
 * 每个函数失败时返回 null，调用方回退本地规则器。
 */

const REPAIR_GLOSSARY = [
  "labor=工时", "parts=配件",
  "刹车片=brake pads", "刹车盘=brake discs", "减震=shock absorber", "正时皮带=timing belt",
  "海狮=HiAce", "水泵=water pump", "防冻液=coolant", "机油=engine oil", "机滤=oil filter", "空滤=air filter",
  "涡轮增压=turbocharger", "气门室盖=valve cover", "轮胎=tire", "电瓶=battery", "冷媒=refrigerant",
  "工时费=labor", "待报价=quote pending",
].join("；");

const PARSE_SYSTEM = `你是牙买加 Kingston 汽修厂（Whole Hearted Car Service）的工单录入助手。
用户用中文大白话写维修需求，每行 = 症状/原因 + 维修动作 + 金额。前台可能打错字、漏字，你要按上下文理解正确词义（例：“更挽水泵”=更换水泵；“修为”“维秀”=维修），输出时写规范正确的词。
术语对照：${REPAIR_GLOSSARY}
规则（2026-08-18 / 2026-08-20 老板定，务必遵守）：
1. 拆开“症状”和“维修动作”：descZh=项目名称，只写维修动作（例：更换水泵）；remarkZh=症状/原因/补充说明（例：水泵漏防冻液，还需要加防冻液）；没有症状则 remarkZh=""；
2. descEn=descZh 的英文（牙买加汽修术语，自然简短）；remarkEn=remarkZh 的英文（remarkZh 为空则 remarkEn=""）；
3. 工时费写在描述里的整数金额 = unitPriceJmd（JMD 含 15% GCT 最终价），没有金额则 unitPriceJmd=0；unit=单位（工时/个/套/瓶等，默认工时）；unitEn=单位的英文（如 工时→hours、个→pcs、瓶→bottles）；
4. 配件类实物 → category=parts、pendingQuote=true、unitPriceJmd=0（配件另行报价）；人工服务 → category=labor；数量没写按 1；
5. 动作必须体现在 descZh 里（如“更换水泵”“维修变速箱”），不要漏掉动作词；原文同时提到两种可能时按原文保留（如“更换或维修水泵”），不替人工做决定；错别字按上下文修正成规范动作词（如“更挽”→“更换”、“修为”→“维修”）；
6. 只输出 JSON，不要任何解释，格式：{"items":[{"descZh":"","descEn":"","remarkZh":"","remarkEn":"","unitEn":"","category":"labor|parts","unit":"工时","unitPriceJmd":0,"quantity":1,"pendingQuote":false}]}`;

export interface AiParsedQuickItem {
  descZh: string;
  descEn: string;
  category: "labor" | "parts";
  /** 单位（8/18 老板要求）；缺省由界面按类别补默认。 */
  unit?: string;
  /** 减免金额；AI 默认 0，人工在界面里打折。 */
  discountJmd?: number;
  /** 项目备注（症状/原因，8/18 老板：拆开症状与动作）。 */
  remarkZh?: string;
  remarkEn?: string;
  unitEn?: string;
  unitPriceJmd: number;
  quantity: number;
  pendingQuote: boolean;
}

export async function aiParseQuickOrder(rawInput: string): Promise<AiParsedQuickItem[] | null> {
  try {
    const content = await deepseekChat({
      json: true,
      messages: [
        { role: "system", content: PARSE_SYSTEM },
        { role: "user", content: rawInput.trim() },
      ],
    });
    const parsed = JSON.parse(content) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    const items = parsed.items
      .map((item): AiParsedQuickItem | null => {
        if (typeof item !== "object" || item === null) return null;
        const record = item as Record<string, unknown>;
        const descZh = typeof record.descZh === "string" ? record.descZh.trim() : "";
        const descEn = typeof record.descEn === "string" ? record.descEn.trim() : "";
        const category = record.category === "parts" ? "parts" : "labor";
        const unitPriceJmd = typeof record.unitPriceJmd === "number" && Number.isSafeInteger(record.unitPriceJmd) && record.unitPriceJmd >= 0 ? record.unitPriceJmd : 0;
        const quantity = typeof record.quantity === "number" && Number.isSafeInteger(record.quantity) && record.quantity > 0 ? record.quantity : 1;
        if (!descZh || !descEn) return null;
        const unit = typeof record.unit === "string" && record.unit.trim() ? record.unit.trim() : undefined;
        const remarkZh = typeof record.remarkZh === "string" ? record.remarkZh.trim() : "";
        const remarkEn = typeof record.remarkEn === "string" ? record.remarkEn.trim() : "";
        const unitEn = typeof record.unitEn === "string" ? record.unitEn.trim() : undefined;
        return { descZh, descEn, category, unit, unitEn, remarkZh: remarkZh || undefined, remarkEn: remarkEn || undefined, unitPriceJmd, quantity, pendingQuote: category === "parts" ? true : Boolean(record.pendingQuote) };
      })
      .filter((item): item is AiParsedQuickItem => item !== null);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

const FORMAL_CHARGE_PARSE_SYSTEM = `你是牙买加 Kingston 汽修厂（Whole Hearted Car Service）的收费录入助手。
把前台的一段中文口述同时整理成收费项目和随收费版本保存的备注。术语对照：${REPAIR_GLOSSARY}
规则：
1. 收费项目分为 labor（工时）或 parts（配件）。项目名称只写收费项目；description 写症状、施工内容或补充说明；
2. descZh、descriptionZh 使用规范中文；descEn、descriptionEn 使用牙买加客户易懂的自然英文；
3. unitPriceJmd 是客户看到的含 15% GCT 单价；没有金额填 0，不能编造；quantity 没写按 1；discountJmd 没写按 0；
4. 备注单独放进 notes：客户反馈=customer_concern，施工说明=work_instruction，责任说明或提前告知=liability_notice；
5. 备注的 contentZh 和 contentEn 必须表达同一事实；不得把备注混进收费项目，也不得把收费项目强制变成备注；
6. 只输出 JSON，不要解释：{"items":[{"descZh":"","descEn":"","remarkZh":"","remarkEn":"","category":"labor|parts","unit":"工时|件|套|个|瓶","unitPriceJmd":0,"quantity":1,"discountJmd":0,"pendingQuote":false}],"notes":[{"kind":"customer_concern|work_instruction|liability_notice","contentZh":"","contentEn":""}]}`;

/**
 * 正式 Business Order 的自然语言收费入口。
 * 一次模型调用同时返回收费项目和版本化备注；任何结构异常都整批回退本地规则器。
 */
export async function aiParseFormalChargeEntry(rawInput: string): Promise<ParsedChargeEntry | null> {
  if (!rawInput.trim()) return null;
  try {
    const content = await deepseekChat({
      json: true,
      messages: [
        { role: "system", content: FORMAL_CHARGE_PARSE_SYSTEM },
        { role: "user", content: rawInput.trim() },
      ],
    });
    const parsed = JSON.parse(content) as { items?: unknown; notes?: unknown };
    if (!Array.isArray(parsed.items) || !Array.isArray(parsed.notes)) return null;

    const items = parsed.items.map((item): ParsedQuickItem | null => {
      if (typeof item !== "object" || item === null) return null;
      const record = item as Record<string, unknown>;
      if (record.category !== "labor" && record.category !== "parts") return null;
      const descZh = typeof record.descZh === "string" ? record.descZh.trim() : "";
      const descEn = typeof record.descEn === "string" ? record.descEn.trim() : "";
      if (!descZh || !descEn) return null;
      const unitPriceJmd = typeof record.unitPriceJmd === "number"
        && Number.isFinite(record.unitPriceJmd)
        && record.unitPriceJmd >= 0
        ? record.unitPriceJmd
        : null;
      const quantity = typeof record.quantity === "number"
        && Number.isFinite(record.quantity)
        && record.quantity > 0
        ? record.quantity
        : null;
      const discountJmd = record.discountJmd === undefined
        ? 0
        : typeof record.discountJmd === "number"
          && Number.isFinite(record.discountJmd)
          && record.discountJmd >= 0
          ? record.discountJmd
          : null;
      if (unitPriceJmd === null || quantity === null || discountJmd === null) return null;
      const remarkZh = typeof record.remarkZh === "string" ? record.remarkZh.trim() : "";
      const remarkEn = typeof record.remarkEn === "string" ? record.remarkEn.trim() : "";
      const unit = typeof record.unit === "string" && record.unit.trim() ? record.unit.trim() : undefined;
      return {
        descZh,
        descEn,
        remarkZh: remarkZh || undefined,
        remarkEn: remarkEn || undefined,
        category: record.category,
        unit,
        unitPriceJmd,
        quantity,
        discountJmd,
        pendingQuote: record.category === "parts" && unitPriceJmd === 0,
      };
    });

    const noteKinds = new Set(["customer_concern", "work_instruction", "liability_notice"]);
    const notes = parsed.notes.map((note): ParsedChargeNote | null => {
      if (typeof note !== "object" || note === null) return null;
      const record = note as Record<string, unknown>;
      if (typeof record.kind !== "string" || !noteKinds.has(record.kind)) return null;
      const contentZh = typeof record.contentZh === "string" ? record.contentZh.trim() : "";
      const contentEn = typeof record.contentEn === "string" ? record.contentEn.trim() : "";
      if (!contentZh || !contentEn) return null;
      return {
        kind: record.kind as ParsedChargeNote["kind"],
        contentZh,
        contentEn,
      };
    });

    if (items.some((item) => item === null) || notes.some((note) => note === null)) return null;
    if (items.length === 0 && notes.length === 0) return null;
    return {
      items: items as ParsedQuickItem[],
      notes: notes as ParsedChargeNote[],
    };
  } catch {
    return null;
  }
}

const IR_PARSE_SYSTEM = `你是牙买加 Kingston 汽修厂（Whole Hearted Car Service）的检查结果整理助手。
用户用中文大白话回交车辆检查结果，逐行可能包含：检查发现、处理建议、工时费金额、配件价格、拖车/外派/其他费用（JMD 整数）。
术语对照：${REPAIR_GLOSSARY}
规则：
1. 每行整理成一个检查项目：findingZh=检查发现（简短），recommendationZh=处理建议（"施工建议：…"或"配件清单（待报价）：…"）；
2. 工时/人工服务 → pricingMode=unit、category=labor，明确行内金额=amountJmd（没有则 0），pendingQuote=false；原文明示数量时原样写正整数 quantity，没有则 quantity=1；
3. 配件类实物 → pricingMode=unit、category=parts；原文有明确价格时必须原样保留 amountJmd 且 pendingQuote=false，无价格时 amountJmd=0、pendingQuote=true；
4. 只有原文明示拖车费、外派服务费或其他费用及其整数总额时，才输出 pricingMode=fixed_total、category=other_service、code=towing|offsite_service|other、amountJmd=明确总额、pendingQuote=false；没有明确金额不得臆造 fixed_total；
5. findingEn=findingZh 的英文、recommendationEn=recommendationZh 的英文（牙买加汽修术语，自然简短）；
6. 只输出 JSON，不要任何解释：{"items":[{"findingZh":"","findingEn":"","recommendationZh":"","recommendationEn":"","pricingMode":"unit","category":"labor|parts","quantity":1,"amountJmd":0,"pendingQuote":false},{"findingZh":"拖车费","findingEn":"Towing","recommendationZh":"拖车费","recommendationEn":"Towing","pricingMode":"fixed_total","category":"other_service","code":"towing|offsite_service|other","amountJmd":0,"pendingQuote":false}]}`;

export type AiParsedInspectionItem = ParsedInspectionItem & {
  readonly findingEn?: string;
  readonly recommendationEn?: string;
};

export async function aiParseInspectionNaturalLanguage(rawText: string): Promise<AiParsedInspectionItem[] | null> {
  try {
    const content = await deepseekChat({
      json: true,
      messages: [
        { role: "system", content: IR_PARSE_SYSTEM },
        { role: "user", content: rawText.trim() },
      ],
    });
    const parsed = JSON.parse(content) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return null;
    const items = parsed.items.map((item): AiParsedInspectionItem | null => {
        if (typeof item !== "object" || item === null) return null;
        const record = item as Record<string, unknown>;
        const findingZh = typeof record.findingZh === "string" ? record.findingZh.trim() : "";
        const recommendationZh = typeof record.recommendationZh === "string" ? record.recommendationZh.trim() : "";
        if (!findingZh || !recommendationZh) return null;
        const hasSafeAmount = typeof record.amountJmd === "number"
          && Number.isSafeInteger(record.amountJmd)
          && record.amountJmd >= 0;
        const amountJmd = hasSafeAmount ? record.amountJmd as number : 0;
        const findingEn = typeof record.findingEn === "string" ? record.findingEn.trim() : "";
        const recommendationEn = typeof record.recommendationEn === "string" ? record.recommendationEn.trim() : "";
        if (record.pricingMode === "fixed_total") {
          if (!hasSafeAmount) return null;
          const code = record.code === "towing" || record.code === "offsite_service" || record.code === "other"
            ? record.code
            : null;
          if (record.category !== "other_service" || code === null) return null;
          return {
            findingZh,
            findingEn: findingEn || undefined,
            recommendationZh,
            recommendationEn: recommendationEn || undefined,
            pricingMode: "fixed_total",
            category: "other_service",
            code,
            amountJmd,
            pendingQuote: false,
          };
        }
        if (record.pricingMode !== "unit" || (record.category !== "labor" && record.category !== "parts")) {
          return null;
        }
        const category = record.category;
        const quantity = typeof record.quantity === "number" && Number.isSafeInteger(record.quantity) && record.quantity > 0
          ? record.quantity
          : 1;
        return {
          findingZh,
          findingEn: findingEn || undefined,
          recommendationZh,
          recommendationEn: recommendationEn || undefined,
          pricingMode: "unit",
          category,
          quantity,
          amountJmd,
          // A stated price is an explicit source fact and wins over a model's
          // contradictory pending flag. Zero-priced parts remain fail-safe pending.
          pendingQuote: category === "parts" && amountJmd === 0,
        };
      });
    // Inspection charge facts form one closed response. Accepting only the
    // valid subset could suppress local fallback and silently drop a raw line.
    if (items.length === 0 || items.some((item) => item === null)) return null;
    return items as AiParsedInspectionItem[];
  } catch {
    return null;
  }
}

const TRANSLATE_SYSTEM = `你是牙买加 Kingston 汽修厂的翻译，把中文维修表述翻成给英语母语客户看的英文。
术语对照：${REPAIR_GLOSSARY}
要求：自然、简短、口语化；金额与单位照抄；只输出译文，不要解释。`;

export async function aiTranslateRepair(zhText: string): Promise<string | null> {
  try {
    const content = await deepseekChat({
      messages: [
        { role: "system", content: TRANSLATE_SYSTEM },
        { role: "user", content: zhText.trim() },
      ],
    });
    return content.trim() || null;
  } catch {
    return null;
  }
}

const ORGANIZE_SYSTEM = [
  "你是牙买加 Kingston 汽修厂（Whole Hearted Car Service）的检查报告撰稿助手。",
  "把维修工的检查记录整理成发给客户的正式文字报告（纯文字，不带照片）。",
  "术语对照：" + REPAIR_GLOSSARY,
  "规则（2026-08-18 / 2026-08-20 老板定，务必遵守）：",
  "1. 事实只来自维修工原文和输入里的系统数据（车辆、客户、检查项目），绝不编造、不联网、不补充车型资料；",
  "2. 原文没写清或没确认的，写“待确认”或“下一步待定”，不要替维修工下结论；",
  "3. 结构：问候语 → 车辆信息 → 逐项（检查发现 / 本步处理 / 备注 / 下一步待定）→ 结尾说明本报告只覆盖当前阶段，后续阶段将另行出报告与报价；",
  "4. 逐项按输入的检查项目写，金额与单位照抄；",
  "5. 同时输出中文和英文两版（牙买加汽修术语，自然简短，给英语母语客户看），只输出 JSON：{\"zh\":\"\",\"en\":\"\"}，不要任何解释。",
].join("\n");

export interface AiOrganizedInspectionReport {
  zh: string;
  en: string;
}

export async function aiOrganizeInspectionReport(input: {
  rawText: string;
  customerName: string;
  vehiclePlate: string;
  vehicleModel?: string;
  items: ReadonlyArray<{
    findingZh: string;
    recommendationZh: string;
    remarkZh?: string;
    nextStepZh?: string;
  }>;
}): Promise<AiOrganizedInspectionReport | null> {
  try {
    const user = JSON.stringify({
      rawText: input.rawText,
      customerName: input.customerName,
      vehiclePlate: input.vehiclePlate,
      vehicleModel: input.vehicleModel ?? "",
      items: input.items.map((item) => ({
        findingZh: item.findingZh,
        recommendationZh: item.recommendationZh,
        remarkZh: item.remarkZh ?? "",
        nextStepZh: item.nextStepZh ?? "",
      })),
    });
    const content = await deepseekChat({
      json: true,
      messages: [
        { role: "system", content: ORGANIZE_SYSTEM },
        { role: "user", content: user },
      ],
    });
    const parsed = JSON.parse(content) as { zh?: unknown; en?: unknown };
    const zh = typeof parsed.zh === "string" ? parsed.zh.trim() : "";
    const en = typeof parsed.en === "string" ? parsed.en.trim() : "";
    if (!zh && !en) return null;
    return { zh, en };
  } catch {
    return null;
  }
}
