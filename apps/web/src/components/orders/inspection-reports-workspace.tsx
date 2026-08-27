"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, FilePlus2, RefreshCw, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { api } from "@/lib/api/client";
import type { InspectionReportListItem, IrCommunicationFilter } from "@/lib/api/mock-inspection-reports";
import type { InspectionReportStatus } from "@/lib/orders/inspection-report";
import type { OrderTeamId } from "@/lib/orders/types";
import { loadTeams, teamNameOf } from "@/lib/teams/team-dictionary";
import { formatIrJamaicaDateTime } from "@/lib/orders/ir-communication-time";
import { IrCreateDialog } from "./ir-create-dialog";

const STATUS_LABELS: Record<InspectionReportStatus, string> = {
  mechanic_submitted: "维修工已提交",
  ai_structured: "AI 已整理",
  awaiting_frontdesk: "待前台审核",
  returned_for_revision: "已退回修改",
  approved: "已审核",
  published: "已发布正式版本",
};

const COMMUNICATION_FILTER_LABELS: Record<IrCommunicationFilter, string> = {
  not_notified: "尚未通知客户",
  awaiting_reply: "已通知、等待回复",
  closed: "已闭环",
  interested: "有意向客户",
  not_interested: "没意向客户",
};
const COMMUNICATION_FILTERS = Object.keys(COMMUNICATION_FILTER_LABELS) as IrCommunicationFilter[];
const EMPTY_COMMUNICATION_COUNTS: Record<IrCommunicationFilter, number> = {
  not_notified: 0,
  awaiting_reply: 0,
  closed: 0,
  interested: 0,
  not_interested: 0,
};
const COMMUNICATION_STATUS_LABELS = {
  not_notified: "尚未通知客户",
  awaiting_reply: "已通知客户，等待回复",
  closed: "客户已回复，检查结果闭环",
} as const;
const RESPONSE_LABELS = { interested: "有意向", not_interested: "没意向" } as const;
const CHANNEL_LABELS = { sms: "短信", email: "Email", whatsapp: "WhatsApp", paper: "纸质交付", in_person: "当面沟通" } as const;

function validBucket(value: string | null): value is IrCommunicationFilter {
  return Boolean(value && (COMMUNICATION_FILTERS as string[]).includes(value));
}

function currentInspectionSessionScope(): string {
  if (typeof window === "undefined") return "server";
  return window.localStorage.getItem("wh_session") ?? "anonymous";
}

interface PipelineRow {
  key: string;
  reportId?: string;
  reportNo: string;
  plate: string;
  modelZh?: string;
  customerName: string;
  customerPhone: string;
  inspectorName: string;
  teamId?: OrderTeamId;
  statusLabel: string;
  bucket: IrCommunicationFilter;
  communicationStatus: InspectionReportListItem["communicationStatus"];
  lastNotification: InspectionReportListItem["lastNotification"];
  currentResponse: InspectionReportListItem["currentResponse"];
  latestGeneratedVersion: number | null;
  latestGeneratedAt: string | null;
  updatedAt: string;
}

/**
 * 检查结果跟进管道（2026-08-10 产品决定）：
 * 分类按"待办动作"而非状态标签；定稿≠已发送；客户回复才闭环；
 * 超期未回复持续催收上榜；转不转业务单是建单侧的事，IR 不追踪。
 */
export function InspectionReportsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bucket = validBucket(searchParams.get("bucket")) ? searchParams.get("bucket") as IrCommunicationFilter : undefined;
  const search = searchParams.get("search") ?? "";
  const requestedPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const createRequested = searchParams.get("create") === "1";
  const sourceBusinessOrderId = searchParams.get("sourceBusinessOrderId") ?? undefined;
  const initialVehiclePlate = searchParams.get("vehiclePlate") ?? undefined;
  const teams = loadTeams();
  const teamId = teams.some((team) => team.id === searchParams.get("teamId")) ? searchParams.get("teamId") as OrderTeamId : undefined;

  const sessionScope = currentInspectionSessionScope();
  const [items, setItems] = useState<InspectionReportListItem[]>([]);
  const [searchDraft, setSearchDraft] = useState(search);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [bucketCounts, setBucketCounts] = useState<Record<IrCommunicationFilter, number>>(EMPTY_COMMUNICATION_COUNTS);
  const [dataSessionScope, setDataSessionScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [canOperate, setCanOperate] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const loadGenerationRef = useRef(0);

  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) value ? next.set(key, value) : next.delete(key);
    router.replace(`/orders/inspections${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const requestedSessionScope = sessionScope;
    setLoading(true);
    setError(null);
    try {
      const [result, session] = await Promise.all([
        api.inspectionReports.list({
          page,
          pageSize: 25,
          communication: bucket,
          ...(search ? { search } : {}),
          ...(teamId ? { teamId } : {}),
        }),
        api.me(),
      ]);
      if (generation !== loadGenerationRef.current || currentInspectionSessionScope() !== requestedSessionScope) return;
      if (result.totalPages > 0 && page > result.totalPages) {
        updateQuery({ page: String(result.totalPages) });
        return;
      }
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setBucketCounts(result.communicationCounts);
      setDataSessionScope(requestedSessionScope);
      setCanOperate(session.identity.role === "superadmin" || session.identity.role === "frontdesk_admin");
    } catch (caught) {
      if (generation !== loadGenerationRef.current || currentInspectionSessionScope() !== requestedSessionScope) return;
      setItems([]);
      setTotal(0);
      setTotalPages(0);
      setBucketCounts(EMPTY_COMMUNICATION_COUNTS);
      setDataSessionScope(requestedSessionScope);
      setCanOperate(false);
      setError(caught instanceof Error ? caught.message : "无法读取检查结果");
    } finally {
      if (generation === loadGenerationRef.current && currentInspectionSessionScope() === requestedSessionScope) setLoading(false);
    }
  }, [bucket, page, search, sessionScope, teamId, updateQuery]);

  useEffect(() => {
    setItems([]);
    setDataSessionScope(null);
    setCanOperate(false);
    setShowCreate(false);
    void load();
    return () => { loadGenerationRef.current += 1; };
  }, [load, retry]);

  useEffect(() => {
    if (createRequested && canOperate) setShowCreate(true);
  }, [canOperate, createRequested]);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    const normalized = searchDraft.trim();
    if (normalized === search) return;
    const timer = window.setTimeout(() => {
      updateQuery({ search: normalized || null, page: null });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, searchDraft, updateQuery]);

  const closeCreate = useCallback(() => {
    setShowCreate(false);
    if (createRequested) updateQuery({
      create: null,
      sourceBusinessOrderId: null,
      vehiclePlate: null,
    });
  }, [createRequested, updateQuery]);

  const rows = useMemo<PipelineRow[]>(() => {
    return items.map((item) => {
      const rowBucket: IrCommunicationFilter = item.communicationStatus;
      return {
        key: item.id,
        reportId: item.id,
        reportNo: item.reportNo,
        plate: item.vehicle.plate,
        ...(item.vehicle.modelZh ? { modelZh: item.vehicle.modelZh } : {}),
        customerName: item.customer.nameZh,
        customerPhone: item.customer.phone,
        inspectorName: item.inspector.name,
        teamId: item.inspector.teamId,
        statusLabel: STATUS_LABELS[item.status],
        bucket: rowBucket,
        communicationStatus: item.communicationStatus,
        lastNotification: item.lastNotification,
        currentResponse: item.currentResponse,
        latestGeneratedVersion: item.latestGeneratedVersion,
        latestGeneratedAt: item.latestGeneratedAt,
        updatedAt: item.updatedAt,
      } satisfies PipelineRow;
    });
  }, [items]);

  const hasFilters = Boolean(bucket || search || teamId);

  return (
    <div data-testid="inspection-reports-workspace" className="px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-[1720px]">
        <PageHeader
          breadcrumb="工单管理"
          title="检查结果"
          description="客户沟通状态由正式通知与客户回复记录自动派生；已闭环可按当前维修意向继续筛选。"
        />

        {canOperate && (
          <div className="mt-3 flex justify-end">
            <button type="button" data-testid="ir-create-open" onClick={() => setShowCreate(true)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700">
              <FilePlus2 size={14} /> 新建检查结果（自然语言）
            </button>
          </div>
        )}

        <div data-testid="ir-bucket-chips" className="flex flex-wrap gap-1.5">
          {COMMUNICATION_FILTERS.map((value) => {
            const count = bucketCounts[value] ?? 0;
            const active = bucket === value;
            const urgent = value === "awaiting_reply" && count > 0;
            return (
              <button
                key={value}
                type="button"
                data-testid={`ir-bucket-${value}`}
                onClick={() => updateQuery({ bucket: active ? null : value, page: null })}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${active ? "border-primary bg-primary text-white" : urgent ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300" : "border-line bg-white/75 text-ink-soft hover:border-primary-200 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300"}`}
              >
                {COMMUNICATION_FILTER_LABELS[value]} <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>

        <section className="mt-3 rounded-[22px] border border-line bg-white/75 p-3 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-[minmax(260px,1fr)_170px]">
            <label className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
              <span className="sr-only">搜索检查结果</span>
              <input
                data-testid="inspection-reports-search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="搜索客户、电话、车牌、报告编号或检查人"
                className="min-h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-100 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>
            <select aria-label="检查班组" value={teamId ?? ""} onChange={(event) => updateQuery({ teamId: event.target.value || null, page: null })} className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm dark:bg-slate-800">
              <option value="">全部检查班组</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-ink-soft dark:text-slate-400">
            <span data-testid="inspection-reports-count">
              {total} 份检查结果
            </span>
            {hasFilters ? <button type="button" onClick={() => router.replace("/orders/inspections")} className="inline-flex min-h-11 items-center font-semibold text-primary">清除筛选</button> : null}
          </div>

          {loading ? <div data-testid="inspection-reports-loading" className="mt-3 h-[360px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /> : null}
          {error ? (
            <div className="mt-3 flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-rose-200 text-center dark:border-rose-500/30">
              <AlertCircle className="text-rose-600" />
              <p className="mt-2 text-sm font-semibold">检查结果读取失败</p>
              <p className="mt-1 text-xs text-ink-soft">{error}</p>
              <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm"><RefreshCw size={14} />重试</button>
            </div>
          ) : null}

          {!loading && !error && dataSessionScope === sessionScope && rows.length === 0 ? (
            <div data-testid="inspection-report-empty" className="mt-3 rounded-2xl border border-dashed border-line py-16 text-center text-sm text-ink-soft">
              没有符合条件的检查结果。
              {hasFilters ? <button type="button" onClick={() => router.replace("/orders/inspections")} className="ml-2 inline-flex min-h-11 items-center font-semibold text-primary">清除筛选</button> : null}
            </div>
          ) : null}

          {!loading && !error && dataSessionScope === sessionScope && rows.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-xl border border-line dark:border-slate-700">
              <table data-testid="inspection-reports-table" className="w-full table-fixed text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface text-[10px] text-ink-soft dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                    <th className="px-3 py-2 font-semibold">报告编号</th>
                    <th className="px-3 py-2 font-semibold">车辆 · 客户</th>
                    <th className="px-3 py-2 font-semibold">检查人 · 班组</th>
                    <th className="px-3 py-2 font-semibold">最新客户文件</th>
                    <th className="px-3 py-2 font-semibold">最后通知</th>
                    <th className="px-3 py-2 font-semibold">沟通状态 · 回复</th>
                    <th className="px-3 py-2 font-semibold">更新</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const detailHref = row.reportId ? `/orders/inspections/${encodeURIComponent(row.reportId)}` : null;
                    return (
                      <tr key={row.key} data-testid="inspection-report-row" data-bucket={row.bucket}
                        onClick={() => { if (detailHref) router.push(detailHref); }}
                        onKeyDown={(event) => {
                          if (!detailHref || (event.key !== "Enter" && event.key !== " ")) return;
                          event.preventDefault();
                          router.push(detailHref);
                        }}
                        tabIndex={detailHref ? 0 : -1}
                        className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-primary-50/40 dark:border-slate-700/60 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2.5">
                          {detailHref ? (
                            <button type="button" data-testid={`ir-detail-link-${row.reportId}`} onClick={(event) => { event.stopPropagation(); router.push(detailHref); }} className="inline-flex min-h-11 items-center font-mono font-semibold text-ink underline-offset-2 hover:text-primary hover:underline dark:text-slate-100">{row.reportNo}</button>
                          ) : (
                            <div className="font-mono font-semibold text-ink dark:text-slate-100">{row.reportNo}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-ink dark:text-slate-100">{row.plate}{row.modelZh ? ` · ${row.modelZh}` : ""}</div>
                          <div className="text-[10px] text-ink-soft dark:text-slate-400">{row.customerName} · {row.customerPhone}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-ink dark:text-slate-100">{row.inspectorName}</div>
                          <div className="text-[10px] text-ink-soft dark:text-slate-400">{teamNameOf(row.teamId) ?? "未分配班组"}</div>
                          <div className="text-[10px] text-ink-soft dark:text-slate-400">{row.statusLabel}</div>
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-ink dark:text-slate-200">
                          {row.latestGeneratedVersion === null ? "尚未生成" : `V${row.latestGeneratedVersion}`}
                          {row.latestGeneratedAt ? <div className="text-[10px] text-ink-soft">Jamaica {formatIrJamaicaDateTime(row.latestGeneratedAt)}</div> : null}
                        </td>
                        <td className="px-3 py-2.5">
                          {row.lastNotification ? <><div className="font-semibold">{CHANNEL_LABELS[row.lastNotification.channel as keyof typeof CHANNEL_LABELS] ?? row.lastNotification.channel}</div><div className="text-[10px] text-ink-soft">Jamaica {formatIrJamaicaDateTime(row.lastNotification.recordedAt)}</div></> : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-ink-soft dark:text-slate-400">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.communicationStatus === "closed" ? "bg-emerald-50 text-emerald-700" : row.communicationStatus === "awaiting_reply" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700"}`}>{COMMUNICATION_STATUS_LABELS[row.communicationStatus]}</span>
                          {row.currentResponse ? <div className="mt-1 font-semibold text-ink">{RESPONSE_LABELS[row.currentResponse]}</div> : null}
                        </td>
                        <td className="px-3 py-2.5 text-[10px] text-ink-soft">Jamaica {formatIrJamaicaDateTime(row.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {!loading && !error && totalPages > 1 ? <nav data-testid="inspection-reports-pagination" aria-label="检查结果分页" className="mt-3 flex items-center justify-end gap-2">
            <button type="button" disabled={page <= 1} onClick={() => updateQuery({ page: String(page - 1) })} className="min-h-10 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-40">上一页</button>
            <span className="text-xs text-ink-soft">第 {page} / {totalPages} 页</span>
            <button type="button" disabled={page >= totalPages} onClick={() => updateQuery({ page: String(page + 1) })} className="min-h-10 rounded-lg border border-line px-3 text-xs font-semibold disabled:opacity-40">下一页</button>
          </nav> : null}
          <p className="mt-3 text-[10px] text-ink-faint dark:text-slate-500">沟通状态由正式通知与已分类客户回复实时计算。</p>
        </section>
      </div>

      {showCreate ? <IrCreateDialog onClose={closeCreate} initialVehiclePlate={initialVehiclePlate} sourceBusinessOrderId={sourceBusinessOrderId} /> : null}
    </div>
  );
}
