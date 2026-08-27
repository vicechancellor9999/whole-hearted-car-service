"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api/client";
import type { OrdersOperationsOverview } from "@/lib/orders/operations-overview";
import type {
  OrderListItem,
  OrderProcessingStatus,
  OrderReassignmentAudit,
} from "@/lib/orders/types";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import {
  FLOW_STAGE_LABELS,
  FLOW_STAGES,
  TEAM_LABELS,
  TEAM_ORDER,
  type DocumentListItem,
  type DocumentTab,
  type FlowStageId,
  type ProcessCount,
  type TeamId,
} from "./types";
import {
  VISUAL_DOCUMENTS,
  getInspectionReport,
} from "./visual-data";
import { DocumentTabs } from "./document-tabs";
import { OperationsJudgment } from "./operations-judgment";
import { ProcessCounts } from "./process-counts";
import { OrdersToolbar } from "./orders-toolbar";
import { OrdersTable } from "./orders-table";
import { InspectionDetailModal } from "./inspection-detail-modal";
import {
  ReassignmentDialog,
  type ReassignmentResult,
} from "./reassignment-dialog";

const VALID_TABS: DocumentTab[] = ["all", "inspection", "business", "completed"];
const INSPECTION_DOCUMENTS = VISUAL_DOCUMENTS.filter(
  (document) => document.type === "inspection",
);

const PROCESSING_STAGE: Record<OrderProcessingStatus, FlowStageId> = {
  awaiting_dispatch: "repair_awaiting_dispatch",
  awaiting_acceptance: "repair_awaiting_acceptance",
  in_progress: "repair_in_progress",
  returned_awaiting_frontdesk: "returned_awaiting_frontdesk",
  submitted_awaiting_collection: "submitted_awaiting_collection",
};

const NEXT_STEP: Record<OrderProcessingStatus, string> = {
  awaiting_dispatch: "前台派维修",
  awaiting_acceptance: "维修工接单",
  in_progress: "维修工回交",
  returned_awaiting_frontdesk: "前台核对回交",
  submitted_awaiting_collection: "客户取车",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法读取工单运营数据";
}

function isFlowStageId(value: string | null): value is FlowStageId {
  return value !== null
    && Object.prototype.hasOwnProperty.call(FLOW_STAGE_LABELS, value);
}

function currentHandler(order: OrderListItem): string {
  if (order.mechanicNames.length > 0) return order.mechanicNames.join("、");
  if (
    order.processingStatus === "returned_awaiting_frontdesk"
    || order.processingStatus === "submitted_awaiting_collection"
  ) {
    return "前台";
  }
  return "—";
}

function toDocumentListItem(order: OrderListItem): DocumentListItem {
  const inheritedTeamId = order.teamId ?? order.sourceInspection?.inspectorTeamId;
  const effectiveStatus =
    order.processingStatus === "awaiting_dispatch" && inheritedTeamId
      ? "awaiting_acceptance"
      : order.processingStatus;
  return {
    id: order.id,
    type: order.lifecycle === "completed" ? "completed" : "business",
    docNo: order.orderNo,
    ...(order.sourceInspection ? {
      sourceDocNo: order.sourceInspection.reportNo,
      version: order.sourceInspection.version,
    } : {}),
    customer: order.customer,
    vehicle: order.vehicle,
    flowStage: PROCESSING_STAGE[effectiveStatus],
    ...(inheritedTeamId ? {
      teamId: inheritedTeamId,
      teamName: TEAM_LABELS[inheritedTeamId],
    } : {}),
    handler: currentHandler(order),
    stageDurationLabel: order.lifecycle === "completed" ? "已完结" : "未记录",
    nextStep: NEXT_STEP[effectiveStatus],
    updatedAt: order.updatedAt,
    updatedBy: order.updatedBy,
    amountJmd: order.receivableJmd,
  };
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

function matchesSearch(doc: DocumentListItem, search: string): boolean {
  const normalized = normalize(search);
  if (!normalized) return true;
  const haystack = normalize([
    doc.docNo,
    doc.sourceDocNo,
    doc.resultDocNo,
    doc.customer.nameZh,
    doc.customer.nameEn,
    doc.customer.phone,
    doc.vehicle.plate,
    doc.vehicle.modelZh,
    doc.vehicle.modelEn,
    doc.handler,
    doc.updatedBy,
    FLOW_STAGE_LABELS[doc.flowStage],
  ].filter(Boolean).join(" "));
  return normalized.split(" ").every((token) => haystack.includes(token));
}

export function OrdersWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  // Parse URL state
  const rawTab = searchParams.get("tab");
  const tab: DocumentTab = rawTab && VALID_TABS.includes(rawTab as DocumentTab)
    ? (rawTab as DocumentTab)
    : "all";
  const rawStage = searchParams.get("stage");
  const stageFilter: FlowStageId | "all" =
    isFlowStageId(rawStage) ? rawStage : "all";
  const rawTeam = searchParams.get("teamId");
  const teamFilter: TeamId | "" =
    rawTeam && TEAM_ORDER.includes(rawTeam as TeamId) ? (rawTeam as TeamId) : "";
  const rawSearch = searchParams.get("search") ?? "";
  const search = rawSearch.trim();

  // Local state
  const [searchDraft, setSearchDraft] = useState(search);
  const [selectedDoc, setSelectedDoc] = useState<DocumentListItem | null>(null);
  const [reassignDoc, setReassignDoc] = useState<DocumentListItem | null>(null);
  const [reassignNotice, setReassignNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [reassignmentHistory, setReassignmentHistory] =
    useState<OrderReassignmentAudit[]>([]);
  const [operatorName, setOperatorName] = useState("当前用户");
  const [canManageOrders, setCanManageOrders] = useState(false);
  const [businessDocuments, setBusinessDocuments] = useState<DocumentListItem[]>([]);
  const [operationsOverview, setOperationsOverview] =
    useState<OrdersOperationsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const reassignTriggerRef = useRef<HTMLElement | null>(null);

  // Keep copied URLs aligned with the public filters supported by this page.
  useEffect(() => {
    const canonical = new URLSearchParams(queryString);
    canonical.set("tab", tab);
    if (!isFlowStageId(rawStage)) canonical.delete("stage");
    if (!rawTeam || !TEAM_ORDER.includes(rawTeam as TeamId)) canonical.delete("teamId");
    if (search) canonical.set("search", search);
    else canonical.delete("search");
    canonical.delete("lifecycle");
    canonical.delete("status");
    canonical.delete("view");
    canonical.delete("page");
    if (canonical.toString() !== queryString) {
      router.replace(`/orders?${canonical.toString()}`, { scroll: false });
    }
  }, [queryString, rawStage, rawTeam, router, search, tab]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.orders.list({ scope: "business", lifecycle: "all", page: 1, pageSize: 50 }),
      api.orders.operationsOverview(),
      api.orders.reassignmentHistory(),
      api.me(),
    ])
      .then(([orders, overview, history, session]) => {
        if (cancelled) return;
        setBusinessDocuments(orders.items.map(toDocumentListItem));
        setOperationsOverview(overview);
        setReassignmentHistory(history);
        setOperatorName(session.identity.name);
        setCanManageOrders(
          session.identity.role === "superadmin" || session.identity.role === "frontdesk_admin",
        );
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  // Update URL helper
  const updateQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      });
      next.delete("lifecycle");
      next.delete("status");
      next.delete("view");
      next.delete("page");
      if (!next.has("tab")) next.set("tab", "all");
      router.replace(`/orders?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const selectTab = useCallback(
    (next: DocumentTab) => {
      updateQuery({ tab: next, stage: null });
    },
    [updateQuery],
  );

  const selectStageFromChip = useCallback(
    (next: FlowStageId | null) => {
      updateQuery({
        stage: next,
        tab: "all",
        teamId: null,
        search: null,
      });
    },
    [updateQuery],
  );

  const selectToolbarStage = useCallback(
    (next: FlowStageId | "all") => {
      updateQuery({ stage: next === "all" ? null : next });
    },
    [updateQuery],
  );

  const selectTeam = useCallback(
    (next: TeamId | "") => {
      updateQuery({ teamId: next || null });
    },
    [updateQuery],
  );

  const updateSearch = useCallback(
    (next: string) => {
      setSearchDraft(next);
      updateQuery({ search: next.trim() || null });
    },
    [updateQuery],
  );

  // Sync search draft when URL changes externally
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const documents = useMemo(
    () => [...INSPECTION_DOCUMENTS, ...businessDocuments],
    [businessDocuments],
  );

  const balance = operationsOverview?.firstInspectionDistribution ?? null;
  const workloads = operationsOverview?.workloads ?? [];

  const processCounts = useMemo<ProcessCount[]>(() => {
    return FLOW_STAGES.map((stage) => ({
      ...stage,
      count: documents.reduce(
        (total, document) => total + Number(document.flowStage === stage.id),
        0,
      ),
    }));
  }, [documents]);

  // Compute tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<DocumentTab, number> = { all: 0, inspection: 0, business: 0, completed: 0 };
    for (const doc of documents) {
      counts.all++;
      if (doc.type === "inspection") counts.inspection++;
      else if (doc.type === "business") counts.business++;
      else if (doc.type === "completed") counts.completed++;
    }
    return counts;
  }, [documents]);

  // Filter documents
  const filteredDocs = useMemo(() => {
    let docs = documents;

    // Tab filter
    if (tab === "inspection") docs = docs.filter((d) => d.type === "inspection");
    else if (tab === "business") docs = docs.filter((d) => d.type === "business");
    else if (tab === "completed") docs = docs.filter((d) => d.type === "completed");

    // Stage filter
    if (stageFilter !== "all") docs = docs.filter((d) => d.flowStage === stageFilter);

    // Team filter
    if (teamFilter) docs = docs.filter((d) => d.teamId === teamFilter);

    // Search filter
    if (search) docs = docs.filter((d) => matchesSearch(d, search));

    // Sort by updatedAt descending
    return [...docs].sort((a, b) => {
      const ta = Date.parse(a.updatedAt);
      const tb = Date.parse(b.updatedAt);
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
      return tb - ta;
    });
  }, [documents, tab, stageFilter, teamFilter, search]);

  // Handlers
  const handleOpenDetail = useCallback((doc: DocumentListItem) => {
    detailTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSelectedDoc(doc);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedDoc(null);
    requestAnimationFrame(() => detailTriggerRef.current?.focus());
  }, []);

  const handleReassign = useCallback((doc: DocumentListItem) => {
    reassignTriggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setReassignDoc(doc);
  }, []);

  const handleCloseReassign = useCallback(() => {
    setReassignDoc(null);
    requestAnimationFrame(() => reassignTriggerRef.current?.focus());
  }, []);

  const handleConfirmReassign = useCallback(
    async (result: ReassignmentResult) => {
      if (!reassignDoc) return;
      try {
        const audit = await api.orders.reassign({
          orderId: reassignDoc.id,
          expectedFromTeamId: result.fromTeamId,
          toTeamId: result.toTeamId,
          reason: result.reason,
        });
        setReassignNotice({
          kind: "success",
          message: `已完成改组：${TEAM_LABELS[audit.fromTeamId]} → ${TEAM_LABELS[audit.toTeamId]}，原因：${audit.reason}，操作人：${audit.actor.name}，操作时间：${formatDateTime(audit.changedAt)}。`,
        });
        setReassignDoc(null);
        requestAnimationFrame(() => reassignTriggerRef.current?.focus());
        try {
          const [orders, overview, history] = await Promise.all([
            api.orders.list({ scope: "business", lifecycle: "all", page: 1, pageSize: 50 }),
            api.orders.operationsOverview(),
            api.orders.reassignmentHistory(),
          ]);
          setBusinessDocuments(orders.items.map(toDocumentListItem));
          setOperationsOverview(overview);
          setReassignmentHistory(history);
        } catch (caught) {
          setError(`改组已保存，但最新数据刷新失败：${errorMessage(caught)}`);
        }
      } catch (caught) {
        setReassignNotice({ kind: "error", message: `改组失败：${errorMessage(caught)}` });
      }
    },
    [reassignDoc],
  );

  const selectedStageForChips: FlowStageId | null =
    stageFilter !== "all" ? stageFilter : null;

  return (
    <div
      data-testid="orders-page"
      className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6"
    >
      <div className="mx-auto min-w-0 max-w-[1320px]">
        <PageHeader
          breadcrumb="主营业务 · 工单运营"
          title="工单管理"
          titleTestId="orders-heading"
          description="查询全部业务单据，查看流程数量、今日派检均衡和班组实时负载。"
        />

        <div className="min-w-0 overflow-hidden rounded-[22px] border border-[#dbe5f3] bg-[var(--wh-page-bg)] shadow-card dark:border-slate-700">

          <div aria-busy={loading} className="min-w-0 space-y-4 p-3 sm:p-5">
          {loading && !operationsOverview ? (
            <div
              data-testid="orders-loading"
              className="flex min-h-[320px] items-center justify-center rounded-[22px] border border-line bg-white/80 text-sm text-ink-soft shadow-card dark:bg-slate-800/80 dark:text-slate-400"
            >
              正在读取工单运营数据…
            </div>
          ) : error && !operationsOverview ? (
            <div
              data-testid="orders-load-error"
              className="rounded-[22px] border border-line bg-white/80 p-8 text-center shadow-card dark:bg-slate-800/80"
            >
              <AlertCircle className="mx-auto text-danger" size={28} aria-hidden />
              <h2 className="mt-3 text-base font-bold text-ink dark:text-slate-100">
                工单运营数据读取失败
              </h2>
              <p className="mt-2 text-sm text-danger">{error}</p>
              <button
                type="button"
                onClick={() => setRetryKey((value) => value + 1)}
                className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
              >
                <RefreshCw size={15} aria-hidden /> 重新读取
              </button>
            </div>
          ) : operationsOverview && balance ? (
            <>
              {/* Document tabs */}
              <DocumentTabs active={tab} onChange={selectTab} counts={tabCounts} />

              {/* Operations judgment area: balance + workload */}
              <OperationsJudgment balance={balance} workloads={workloads} />

              {/* Process counts */}
              <ProcessCounts
                counts={processCounts}
                selectedStage={selectedStageForChips}
                onSelectStage={selectStageFromChip}
              />

              {error ? (
                <div
                  data-testid="orders-refresh-error"
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-danger dark:border-rose-500/20 dark:bg-rose-500/10"
                >
                  {error}
                  <button
                    type="button"
                    onClick={() => setRetryKey((value) => value + 1)}
                    className="ml-2 underline"
                  >
                    重试
                  </button>
                </div>
              ) : null}

              {/* Reassignment notice */}
              {reassignNotice ? (
                <div
                  data-testid="reassignment-notice"
                  role={reassignNotice.kind === "error" ? "alert" : "status"}
                  className={reassignNotice.kind === "error"
                    ? "rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
                    : "rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"}
                >
                  {reassignNotice.message}
                  <button
                    type="button"
                    onClick={() => setReassignNotice(null)}
                    className="ml-2 text-[10px] underline"
                  >
                    知道了
                  </button>
                </div>
              ) : null}

              {reassignmentHistory.length > 0 ? (
                <section
                  data-testid="orders-reassignment-audit"
                  aria-labelledby="orders-reassignment-audit-heading"
                  className="rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-500/10"
                >
                  <h2
                    id="orders-reassignment-audit-heading"
                    className="text-[11px] font-semibold text-ink dark:text-slate-100"
                  >
                    最近人工改组
                  </h2>
                  <ul className="mt-1 space-y-1 text-[10px] text-ink-soft dark:text-slate-300">
                    {[...reassignmentHistory].reverse().slice(0, 3).map((audit) => (
                      <li key={audit.id}>
                        <span className="font-mono">{audit.orderNo}</span>
                        {` · ${TEAM_LABELS[audit.fromTeamId]} → ${TEAM_LABELS[audit.toTeamId]} · ${audit.reason} · ${audit.actor.name} · ${formatDateTime(audit.changedAt)}`}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section
                data-testid="orders-query-section"
                aria-labelledby="orders-query-heading"
                className="space-y-3 rounded-[22px] border border-line bg-white/80 p-4 shadow-card dark:bg-slate-800/80"
              >
                <div>
                  <h2
                    id="orders-query-heading"
                    className="text-sm font-bold text-ink dark:text-slate-100"
                  >
                    全部单据查询
                  </h2>
                  <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">
                    查询检查报价、维修工单及已完成历史。
                  </p>
                </div>

                {/* Toolbar */}
                <OrdersToolbar
                  search={searchDraft}
                  onSearchChange={updateSearch}
                  stageFilter={stageFilter}
                  onStageChange={selectToolbarStage}
                  teamFilter={teamFilter}
                  onTeamChange={selectTeam}
                />

                {/* Result count */}
                <div
                  data-testid="orders-result-count"
                  className="text-[11px] text-ink-soft dark:text-slate-400"
                >
                  共 {filteredDocs.length} 条单据
                </div>

                {/* Document table */}
                <OrdersTable
                  documents={filteredDocs}
                  onOpenDetail={handleOpenDetail}
                  onReassign={handleReassign}
                  allowReassign={canManageOrders}
                />
              </section>
            </>
          ) : null}
          </div>
        </div>
      </div>

      {/* Inspection detail modal */}
      {selectedDoc ? (
        <InspectionDetailModal
          report={getInspectionReport(selectedDoc)}
          onClose={handleCloseDetail}
        />
      ) : null}

      {/* Reassignment dialog */}
      {reassignDoc ? (
        <ReassignmentDialog
          document={reassignDoc}
          operatorName={operatorName}
          onClose={handleCloseReassign}
          onConfirm={handleConfirmReassign}
        />
      ) : null}
    </div>
  );
}
