import type { SourceProjectLink } from "./business-order-types";
import type { OrderTeamId } from "./types";

export interface ImplementationProjectCounts {
  readonly proposed: number;
  readonly accepted: number;
  readonly converted: number;
  readonly completed: number;
}

export interface ImplementationMetric extends ImplementationProjectCounts {
  readonly adoptionRate: number | null;
  readonly implementationRate: number | null;
  readonly acceptedCompletionRate: number | null;
}

/**
 * A recommended Quotation item and any BO rows derived from it. The three source
 * identifiers form the canonical denominator key, even if it is split into
 * several Business Order rows.
 */
export interface SourceProjectMetricRecord {
  readonly inspectionReportId: string;
  readonly quotationVersionId: string;
  readonly quotationItemId: string;
  readonly inspectorTeamId: OrderTeamId;
  readonly isValidRecommendation: boolean;
  readonly accepted: boolean;
  readonly businessOrderLinks: ReadonlyArray<SourceProjectLink>;
}

export interface TraceableImplementationMetrics {
  readonly overall: ImplementationMetric;
  readonly byInspectorTeam: Readonly<Partial<Record<OrderTeamId, ImplementationMetric>>>;
  readonly byExecutionTeam: Readonly<Partial<Record<OrderTeamId, ImplementationMetric>>>;
}

interface SourceAggregate {
  readonly key: string;
  readonly inspectorTeamId: OrderTeamId;
  readonly isValidRecommendation: boolean;
  readonly accepted: boolean;
  readonly businessOrderLinks: ReadonlyArray<SourceProjectLink>;
}

const ORDER_TEAM_IDS = new Set<OrderTeamId>(["t1", "t2", "t3", "t4"]);

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label}必须为非负整数`);
  }
}

function assertText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label}不能为空`);
  }
}

function assertTeamId(value: OrderTeamId, label: string): void {
  if (!ORDER_TEAM_IDS.has(value)) throw new RangeError(`${label}无效`);
}

function validateCounts(input: ImplementationProjectCounts): void {
  assertCount(input.proposed, "有效建议项目数");
  assertCount(input.accepted, "采用项目数");
  assertCount(input.converted, "转入业务单项目数");
  assertCount(input.completed, "完成项目数");
  if (input.accepted > input.proposed) {
    throw new RangeError("采用项目数不能超过有效建议项目数");
  }
  if (input.converted > input.accepted) {
    throw new RangeError("转入业务单项目数不能超过采用项目数");
  }
  if (input.completed > input.converted) {
    throw new RangeError("完成项目数不能超过转入业务单项目数");
  }
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Low-level count helper; callers with source records should use the traceable aggregate below. */
export function calculateImplementationMetric(input: ImplementationProjectCounts): ImplementationMetric {
  validateCounts(input);
  return {
    proposed: input.proposed,
    accepted: input.accepted,
    converted: input.converted,
    completed: input.completed,
    adoptionRate: rate(input.accepted, input.proposed),
    implementationRate: rate(input.completed, input.proposed),
    acceptedCompletionRate: rate(input.completed, input.accepted),
  };
}

export function aggregateImplementationProjectCounts(
  records: ReadonlyArray<ImplementationProjectCounts>,
): ImplementationMetric {
  const totals = records.reduce<ImplementationProjectCounts>((total, record) => {
    validateCounts(record);
    const next = {
      proposed: total.proposed + record.proposed,
      accepted: total.accepted + record.accepted,
      converted: total.converted + record.converted,
      completed: total.completed + record.completed,
    };
    validateCounts(next);
    return next;
  }, { proposed: 0, accepted: 0, converted: 0, completed: 0 });
  return calculateImplementationMetric(totals);
}

function sourceKey(record: Pick<SourceProjectMetricRecord, "inspectionReportId" | "quotationVersionId" | "quotationItemId">): string {
  assertText(record.inspectionReportId, "Inspection Report ID");
  assertText(record.quotationVersionId, "Quotation 版本 ID");
  assertText(record.quotationItemId, "Quotation 项目 ID");
  return `${record.inspectionReportId}\u0000${record.quotationVersionId}\u0000${record.quotationItemId}`;
}

function linkKey(link: SourceProjectLink): string {
  assertText(link.businessOrderId, "Business Order ID");
  assertText(link.businessOrderItemId, "Business Order 项目 ID");
  return `${link.businessOrderId}\u0000${link.businessOrderItemId}`;
}

function validateLink(record: SourceProjectMetricRecord, link: SourceProjectLink): void {
  if (
    link.inspectionReportId !== record.inspectionReportId
    || link.quotationVersionId !== record.quotationVersionId
    || link.quotationItemId !== record.quotationItemId
  ) {
    throw new RangeError("业务单来源链接必须匹配有效建议项目键");
  }
  assertTeamId(link.inspectorTeamId, "检查班组");
  assertTeamId(link.executionTeamId, "施工班组");
  if (link.inspectorTeamId !== record.inspectorTeamId) {
    throw new RangeError("业务单来源链接不得改写检查署名班组");
  }
}

function mergeSourceRecords(records: ReadonlyArray<SourceProjectMetricRecord>): ReadonlyArray<SourceAggregate> {
  const sources = new Map<string, SourceAggregate>();
  for (const record of records) {
    const key = sourceKey(record);
    assertTeamId(record.inspectorTeamId, "检查班组");
    if (typeof record.isValidRecommendation !== "boolean") throw new TypeError("建议有效性必须为布尔值");
    if (typeof record.accepted !== "boolean") throw new TypeError("客户采用事实必须为布尔值");
    if (!Array.isArray(record.businessOrderLinks)) throw new TypeError("业务单来源链接必须为数组");
    if (!record.isValidRecommendation && record.accepted) {
      throw new RangeError("无效建议不得标记为采用");
    }
    if (!record.isValidRecommendation && record.businessOrderLinks.length > 0) {
      throw new RangeError("无效建议不得关联业务单");
    }
    if (!record.accepted && record.businessOrderLinks.length > 0) {
      throw new RangeError("未采用建议不得关联业务单或完成施工");
    }
    const existing = sources.get(key);
    if (
      existing
      && (
        existing.inspectorTeamId !== record.inspectorTeamId
        || existing.isValidRecommendation !== record.isValidRecommendation
        || existing.accepted !== record.accepted
      )
    ) {
      throw new RangeError("同一有效建议项目的检查班组、有效性和采用事实必须一致");
    }
    const linksById = new Map<string, SourceProjectLink>(
      existing?.businessOrderLinks.map((link) => [linkKey(link), link]) ?? [],
    );
    for (const link of record.businessOrderLinks) {
      validateLink(record, link);
      const id = linkKey(link);
      const prior = linksById.get(id);
      if (
        prior !== undefined
        && (prior.executionTeamId !== link.executionTeamId || prior.executionStatus !== link.executionStatus)
      ) {
        throw new RangeError("同一业务单来源行不能有冲突的施工事实");
      }
      linksById.set(id, link);
    }
    sources.set(key, {
      key,
      inspectorTeamId: record.inspectorTeamId,
      isValidRecommendation: record.isValidRecommendation,
      accepted: record.accepted,
      businessOrderLinks: [...linksById.values()],
    });
  }
  return [...sources.values()];
}

function toMetric(sources: ReadonlyArray<SourceAggregate>): ImplementationMetric {
  return calculateImplementationMetric({
    proposed: sources.length,
    accepted: sources.filter((source) => source.accepted).length,
    converted: sources.filter((source) => source.businessOrderLinks.length > 0).length,
    completed: sources.filter((source) => source.businessOrderLinks.some((link) => link.executionStatus === "completed")).length,
  });
}

function groupByInspector(sources: ReadonlyArray<SourceAggregate>): Partial<Record<OrderTeamId, ImplementationMetric>> {
  const groups = new Map<OrderTeamId, SourceAggregate[]>();
  for (const source of sources) {
    groups.set(source.inspectorTeamId, [...(groups.get(source.inspectorTeamId) ?? []), source]);
  }
  return Object.fromEntries([...groups].map(([teamId, teamSources]) => [teamId, toMetric(teamSources)]));
}

function groupByExecution(sources: ReadonlyArray<SourceAggregate>): Partial<Record<OrderTeamId, ImplementationMetric>> {
  const groups = new Map<OrderTeamId, Map<string, SourceAggregate>>();
  for (const source of sources) {
    const linksByTeam = new Map<OrderTeamId, SourceProjectLink[]>();
    for (const link of source.businessOrderLinks) {
      linksByTeam.set(link.executionTeamId, [...(linksByTeam.get(link.executionTeamId) ?? []), link]);
    }
    for (const [teamId, links] of linksByTeam) {
      const group = groups.get(teamId) ?? new Map<string, SourceAggregate>();
      group.set(source.key, { ...source, businessOrderLinks: links });
      groups.set(teamId, group);
    }
  }
  return Object.fromEntries(
    [...groups].map(([teamId, teamSources]) => [teamId, toMetric([...teamSources.values()])]),
  );
}

/**
 * Public aggregate for auditable project records. A source project is counted
 * once by (IR, Quotation version, Quotation item), even when split into BO rows.
 */
export function aggregateImplementationMetrics(
  records: ReadonlyArray<SourceProjectMetricRecord>,
): TraceableImplementationMetrics {
  const sources = mergeSourceRecords(records);
  const validSources = sources.filter((source) => source.isValidRecommendation);
  return {
    overall: toMetric(validSources),
    byInspectorTeam: groupByInspector(validSources),
    byExecutionTeam: groupByExecution(validSources),
  };
}
