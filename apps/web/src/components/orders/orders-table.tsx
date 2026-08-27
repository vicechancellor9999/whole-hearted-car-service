"use client";

import { useCallback } from "react";
import {
  Eye,
  RefreshCw,
} from "lucide-react";
import {
  FLOW_STAGE_LABELS,
  TEAM_COLORS,
  TEAM_LABELS,
  type DocumentListItem,
  type FlowStageId,
} from "./types";
import { canReassign } from "./visual-data";
import { cn, formatJMDFull, timeAgo } from "@/lib/utils";

// Re-export for convenience
export type { DocumentListItem };

/** Check if a flow stage allows reassignment. */
function canReassignFlowStage(stage: FlowStageId): boolean {
  return canReassign(stage);
}

// Flow stage badge colors by group
const STAGE_STYLES: Record<string, string> = {
  // inspection
  inspection_awaiting_dispatch: "bg-slate-100 text-slate-700 dark:bg-slate-400/10 dark:text-slate-300",
  inspection_awaiting_acceptance: "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300",
  inspection_in_progress: "bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300",
  inspection_awaiting_frontdesk: "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300",
  // quotation
  quote_awaiting_customer: "bg-purple-50 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300",
  quote_accepted_awaiting_order: "bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
  // repair
  repair_awaiting_dispatch: "bg-slate-100 text-slate-700 dark:bg-slate-400/10 dark:text-slate-300",
  repair_awaiting_acceptance: "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300",
  repair_in_progress: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  blocked: "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300",
  // handover
  returned_awaiting_frontdesk: "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300",
  awaiting_formal_handover: "bg-orange-50 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300",
  submitted_awaiting_collection: "bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300",
  vehicle_collected: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
};

const TYPE_LABELS: Record<DocumentListItem["type"], string> = {
  inspection: "检查与报价",
  business: "维修工单",
  completed: "已完成",
};

const TYPE_STYLES: Record<DocumentListItem["type"], string> = {
  inspection: "bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300",
  business: "bg-primary-50 text-primary dark:bg-primary-500/10 dark:text-primary-300",
  completed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
};

function customerLabel(doc: DocumentListItem): string {
  return [doc.customer.nameZh, doc.customer.nameEn].filter(Boolean).join(" · ");
}

function vehicleLabel(doc: DocumentListItem): string {
  return [doc.vehicle.modelZh, doc.vehicle.modelEn].filter(Boolean).join(" · ");
}

function StageBadge({ stage }: { stage: FlowStageId }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        STAGE_STYLES[stage] ?? "bg-gray-100 text-gray-700 dark:bg-slate-400/10 dark:text-slate-300",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {FLOW_STAGE_LABELS[stage]}
    </span>
  );
}

function TypeBadge({ type }: { type: DocumentListItem["type"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold",
        TYPE_STYLES[type],
      )}
    >
      {TYPE_LABELS[type]}
    </span>
  );
}

interface DocRowProps {
  doc: DocumentListItem;
  onOpenDetail: (doc: DocumentListItem) => void;
  onReassign: (doc: DocumentListItem) => void;
  allowReassign: boolean;
}

function DocRow({ doc, onOpenDetail, onReassign, allowReassign }: DocRowProps) {
  const teamColor = doc.teamId ? TEAM_COLORS[doc.teamId] : "#9ca3af";
  const isInspection = doc.type === "inspection";
  const canReassign =
    allowReassign
    && doc.type === "business"
    && Boolean(doc.teamId)
    && canReassignFlowStage(doc.flowStage);
  const isLockedAfterHandover =
    doc.type === "business" &&
    (doc.flowStage === "submitted_awaiting_collection" || doc.flowStage === "vehicle_collected");
  const rowTestId = canReassign
    ? "business-order-before-handover"
    : isLockedAfterHandover
      ? "business-order-after-handover"
      : `orders-doc-row-${doc.id}`;

  const handleRowClick = useCallback(() => {
    if (isInspection) onOpenDetail(doc);
  }, [doc, isInspection, onOpenDetail]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (isInspection) onOpenDetail(doc);
      }
    },
    [doc, isInspection, onOpenDetail],
  );

  return (
    <tr
      data-testid={rowTestId}
      data-team-id={doc.teamId}
      data-flow-stage={doc.flowStage}
      tabIndex={isInspection ? 0 : -1}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        handleRowClick();
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        "border-l-[3px] border-l-transparent text-ink transition-colors",
        isInspection && "cursor-pointer hover:border-l-primary hover:bg-primary-50/40 dark:hover:bg-primary-500/10",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-300",
      )}
      style={!doc.teamId ? undefined : { borderLeftColor: "transparent" }}
    >
      {/* Col 1: Vehicle / Customer / Document */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <TypeBadge type={doc.type} />
            {doc.version ? (
              <span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] font-medium text-ink-soft dark:bg-slate-700 dark:text-slate-300">
                {doc.version}
              </span>
            ) : null}
          </div>
          <span className="font-mono text-xs font-semibold text-ink dark:text-slate-100">
            {doc.vehicle.plate}
          </span>
          <span className="text-[10px] text-ink-soft dark:text-slate-400">{vehicleLabel(doc)}</span>
          <span className="text-[11px] text-ink-soft dark:text-slate-400">{customerLabel(doc)}</span>
          <span className="text-[10px] text-ink-soft dark:text-slate-400">{doc.customer.phone}</span>
          <span className="font-mono text-[10px] text-ink-soft dark:text-slate-400">{doc.docNo}</span>
          {doc.amountJmd !== undefined ? (
            <span className="mt-0.5 text-[10px] tabular-nums text-ink dark:text-slate-200">
              {formatJMDFull(doc.amountJmd)}
            </span>
          ) : null}
        </div>
      </td>

      {/* Col 2: Source / Result */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5 text-[10px]">
          {doc.sourceDocNo ? (
            <span className="font-mono text-ink-soft dark:text-slate-400">
              ← {doc.sourceDocNo}
            </span>
          ) : (
            <span className="text-ink-faint dark:text-slate-500">—</span>
          )}
          {doc.resultDocNo ? (
            <span className="font-mono text-cyan-700 dark:text-cyan-300">
              → {doc.resultDocNo}
            </span>
          ) : null}
        </div>
      </td>

      {/* Col 3: Flow stage */}
      <td className="px-3 py-2.5">
        <StageBadge stage={doc.flowStage} />
      </td>

      {/* Col 4: Team / Handler */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {doc.teamId ? (
              <>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: teamColor }}
                />
                <span className="text-[11px] font-medium text-ink dark:text-slate-200">
                  {TEAM_LABELS[doc.teamId]}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-ink-faint dark:text-slate-500">未派组</span>
            )}
          </div>
          <span className="text-[10px] text-ink-soft dark:text-slate-400">{doc.handler}</span>
        </div>
      </td>

      {/* Col 5: Duration / Next step */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-ink dark:text-slate-200">{doc.stageDurationLabel}</span>
          <span className="text-[10px] text-ink-soft dark:text-slate-400">
            下一步：{doc.nextStep}
          </span>
        </div>
      </td>

      {/* Col 6: Updated */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-ink dark:text-slate-200" suppressHydrationWarning>
            {timeAgo(doc.updatedAt)}
          </span>
          <span className="text-[10px] text-ink-soft dark:text-slate-400">{doc.updatedBy}</span>
        </div>
      </td>

      {/* Col 7: Actions */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {isInspection ? (
            <button
              type="button"
              data-testid={`orders-doc-detail-${doc.id}`}
              aria-label={`查看 ${doc.docNo} 检查详情`}
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(doc);
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[10px] font-medium",
                "text-ink-soft transition-colors hover:border-primary-200 hover:text-primary",
                "dark:border-slate-600 dark:text-slate-400 dark:hover:text-primary-300",
              )}
            >
              <Eye size={11} aria-hidden /> 详情
            </button>
          ) : null}
          {canReassign ? (
            <button
              type="button"
              data-testid={`orders-doc-reassign-${doc.id}`}
              aria-label={`改组 ${doc.docNo}`}
              onClick={(e) => {
                e.stopPropagation();
                onReassign(doc);
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[10px] font-medium",
                "text-ink-soft transition-colors hover:border-amber-300 hover:text-warning",
                "dark:border-slate-600 dark:text-slate-400 dark:hover:text-amber-400",
              )}
            >
              <RefreshCw size={11} aria-hidden /> 改组
            </button>
          ) : null}
          {isLockedAfterHandover ? (
            <span className="max-w-24 text-[9px] leading-tight text-ink-faint dark:text-slate-500">
              正式交单后已锁定
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DocCardMobile({ doc, onOpenDetail, onReassign, allowReassign }: DocRowProps) {
  const teamColor = doc.teamId ? TEAM_COLORS[doc.teamId] : "#9ca3af";
  const isInspection = doc.type === "inspection";
  const canReassign =
    allowReassign
    && doc.type === "business"
    && Boolean(doc.teamId)
    && canReassignFlowStage(doc.flowStage);
  const isLockedAfterHandover =
    doc.type === "business" &&
    (doc.flowStage === "submitted_awaiting_collection" || doc.flowStage === "vehicle_collected");
  const cardTestId = canReassign
    ? "business-order-before-handover"
    : isLockedAfterHandover
      ? "business-order-after-handover"
      : `orders-doc-card-${doc.id}`;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (isInspection) onOpenDetail(doc);
      }
    },
    [doc, isInspection, onOpenDetail],
  );

  return (
    <article
      data-testid={cardTestId}
      data-team-id={doc.teamId}
      data-flow-stage={doc.flowStage}
      tabIndex={isInspection ? 0 : -1}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (isInspection) onOpenDetail(doc);
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        "rounded-[22px] border p-4",
        "transition-[box-shadow,transform] duration-200 ease-out",
        "motion-reduce:transition-none motion-reduce:hover:transform-none",
        "hover:shadow-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-300",
        "border-l-[3px]",
        isInspection
          ? "cursor-pointer border-line bg-white/80 shadow-card dark:bg-slate-800/80 hover:border-l-primary"
          : "border-line bg-white/80 shadow-card dark:bg-slate-800/80",
      )}
      style={{ borderLeftColor: teamColor }}
    >
      {/* Top row: type + version + stage */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <TypeBadge type={doc.type} />
          {doc.version ? (
            <span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] font-medium text-ink-soft dark:bg-slate-700 dark:text-slate-300">
              {doc.version}
            </span>
          ) : null}
        </div>
        <StageBadge stage={doc.flowStage} />
      </div>

      {/* Vehicle / customer / doc */}
      <div className="mt-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold text-ink dark:text-slate-100">
            {doc.vehicle.plate}
          </span>
        </div>
        <div className="truncate text-[10px] text-ink-soft dark:text-slate-400">{vehicleLabel(doc)}</div>
        <div className="mt-0.5 truncate text-[11px] text-ink-soft dark:text-slate-400">{customerLabel(doc)}</div>
        <div className="text-[10px] text-ink-soft dark:text-slate-400">{doc.customer.phone}</div>
        <div className="mt-1 font-mono text-[10px] text-ink-soft dark:text-slate-400">{doc.docNo}</div>
      </div>

      {/* Source / result */}
      {(doc.sourceDocNo || doc.resultDocNo) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px]">
          {doc.sourceDocNo ? (
            <span className="font-mono text-ink-soft dark:text-slate-400">← {doc.sourceDocNo}</span>
          ) : null}
          {doc.resultDocNo ? (
            <span className="font-mono text-cyan-700 dark:text-cyan-300">→ {doc.resultDocNo}</span>
          ) : null}
        </div>
      )}

      {/* Bottom row: team, handler, duration, next step, actions */}
      <div className="mt-3 border-t border-line pt-2.5 dark:border-slate-600">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-[10px] text-ink-soft dark:text-slate-400">
            {doc.teamId ? TEAM_LABELS[doc.teamId] : "未派组"}
            {doc.handler !== "—" ? ` · ${doc.handler}` : ""}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] text-ink-soft dark:text-slate-400">
              {doc.stageDurationLabel}
            </span>
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-[10px] text-ink-soft dark:text-slate-400">
            下一步：{doc.nextStep}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {doc.amountJmd !== undefined ? (
              <span className="text-[10px] tabular-nums font-semibold text-ink dark:text-slate-100">
                {formatJMDFull(doc.amountJmd)}
              </span>
            ) : null}
            {isInspection ? (
              <button
                type="button"
                aria-label={`查看 ${doc.docNo} 检查详情`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetail(doc);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:text-slate-400"
              >
                <Eye size={12} aria-hidden />
              </button>
            ) : null}
            {canReassign ? (
              <button
                type="button"
                aria-label={`改组 ${doc.docNo}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onReassign(doc);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:border-amber-300 hover:text-warning dark:border-slate-600 dark:text-slate-400"
              >
                <RefreshCw size={12} aria-hidden />
              </button>
            ) : null}
            {isLockedAfterHandover ? (
              <span className="max-w-24 text-right text-[9px] leading-tight text-ink-faint dark:text-slate-500">
                正式交单后已锁定
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-1 text-[10px] text-ink-faint dark:text-slate-500" suppressHydrationWarning>
          {timeAgo(doc.updatedAt)} · {doc.updatedBy}
        </div>
      </div>
    </article>
  );
}

interface DocumentTableProps {
  documents: DocumentListItem[];
  onOpenDetail: (doc: DocumentListItem) => void;
  onReassign: (doc: DocumentListItem) => void;
  allowReassign: boolean;
}

export function OrdersTable({
  documents,
  onOpenDetail,
  onReassign,
  allowReassign,
}: DocumentTableProps) {
  if (documents.length === 0) {
    return (
      <div data-testid="orders-document-list">
        <div data-testid="orders-empty" className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-ink-soft dark:text-slate-400">没有匹配的单据</p>
          <p className="mt-1 text-xs text-ink-soft dark:text-slate-400">尝试调整搜索条件或筛选器</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="orders-document-list">
      <div data-testid="orders-table-desktop" className="hidden min-w-0 overflow-hidden sm:block">
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="bg-surface text-[10px] font-semibold uppercase tracking-wider text-ink-soft dark:bg-slate-800 dark:text-slate-400">
              <th scope="col" className="px-3 py-2.5">车辆 / 客户 / 单据</th>
              <th scope="col" className="px-3 py-2.5">来源 / 关联</th>
              <th scope="col" className="px-3 py-2.5">流程阶段</th>
              <th scope="col" className="px-3 py-2.5">当前班组 / 当前处理人</th>
              <th scope="col" className="px-3 py-2.5">停留 / 下一步</th>
              <th scope="col" className="px-3 py-2.5">最近更新</th>
              <th scope="col" className="w-28 px-3 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {documents.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                onOpenDetail={onOpenDetail}
                onReassign={onReassign}
                allowReassign={allowReassign}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div data-testid="orders-cards-mobile" className="space-y-3 sm:hidden">
        {documents.map((doc) => (
          <DocCardMobile
            key={doc.id}
            doc={doc}
            onOpenDetail={onOpenDetail}
            onReassign={onReassign}
            allowReassign={allowReassign}
          />
        ))}
      </div>
    </div>
  );
}
