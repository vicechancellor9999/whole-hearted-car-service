"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Car,
  ClipboardList,
  FileText,
  History,
  Package,
  Paperclip,
  Pencil,
  User,
} from "lucide-react";
import { ApiError, api, isFormalCustomerVehicleApiEnabled, isMockApiEnabled } from "@/lib/api/client";
import { vehicleYearLabel } from "@/lib/customers/vehicle-year";
import type {
  CustomerVehicleWorkspaceResponse,
  VehicleRecord,
} from "@/lib/customers/types";
import { QUICK_BO_STATUS_LABELS, type QuickOrder } from "@/lib/orders/quick-order-types";
import { formatPhoneE164 } from "@/lib/customers/phone";
import { cn, formatDateTime, formatJMDFull } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { RecordDeleteButton } from "@/components/shared/record-delete-dialog";
import { VehicleStatusBadge } from "./badges";
import { customerDisplayName } from "./customer-list";
import {
  DetailEmpty,
  DetailField,
  DetailSection,
  currentSessionKey,
  errorMessage,
  loadWorkspace,
  partStatusLabel,
  partStatusTone,
  taskStatusLabel,
  taskStatusTone,
} from "./detail-shared";
import { VehicleFormDialog } from "./form-dialogs";
import { VehicleReportPhotoArchive } from "./vehicle-report-photo-archive";
import { VehicleReportHistoryArchive } from "./vehicle-report-history-archive";
import type { VehicleInspectionReportArchiveGroup, VehicleInspectionReportPhotoGroup } from "@/lib/api/mock-inspection-reports";
import {
  fetchFormalBusinessOrders,
  type FormalBusinessOrder,
  type FormalBusinessOrderStatus,
} from "@/lib/api/formal-business-orders";

interface VehicleDetailPageProps {
  vehicleId: string;
}

const QUICK_BO_STATUS_TONES: Record<QuickOrder["status"], string> = {
  pending_assign: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  assigned: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  in_repair: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  stalled: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  returned: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
  submitted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
};

const FORMAL_BUSINESS_ORDER_STATUS_LABELS: Record<FormalBusinessOrderStatus, string> = {
  waiting_assignment: "待派单",
  assigned: "已派单",
  in_repair: "维修中",
  return_pending_review: "回单待审核",
  formally_handed_off: "已交单",
};

export function VehicleDetailPage({ vehicleId }: VehicleDetailPageProps) {
  // Native history events are also used by the preview identity switch tests.
  // Subscribing here makes the session key re-evaluate on those route updates.
  const searchParams = useSearchParams();
  void searchParams;
  const sessionKey = currentSessionKey();
  const [vehicle, setVehicle] = useState<VehicleRecord | null>(null);
  const [workspace, setWorkspace] = useState<CustomerVehicleWorkspaceResponse | null>(null);
  const [businessOrders, setBusinessOrders] = useState<QuickOrder[]>([]);
  const [formalBusinessOrders, setFormalBusinessOrders] = useState<FormalBusinessOrder[]>([]);
  const [inspectionReportPhotoGroups, setInspectionReportPhotoGroups] = useState<VehicleInspectionReportPhotoGroup[]>([]);
  const [inspectionReportArchive, setInspectionReportArchive] = useState<VehicleInspectionReportArchiveGroup[]>([]);
  const [dataSessionKey, setDataSessionKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [editing, setEditing] = useState(false);
  const loadGenerationRef = useRef(0);

  const optionalLinkedArchive = useCallback(async <T,>(request: Promise<T[]>): Promise<T[]> => {
    try {
      return await request;
    } catch (caught) {
      // Customer/vehicle records can legitimately pre-date their first linked
      // Inspection Report. The linked domain reports that as 404; for a detail
      // page whose primary vehicle read succeeds, that means an empty archive.
      if (caught instanceof ApiError && caught.status === 404) return [];
      throw caught;
    }
  }, []);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const requestedVehicleId = vehicleId;
    const requestedSessionKey = sessionKey;
    setLoading(true);
    setError(null);
    try {
      const [detail, nextWorkspace, allOrders, formalOrderPage, nextInspectionReportPhotos, nextInspectionReportArchive] = await Promise.all([
        api.vehicles.detail(vehicleId),
        loadWorkspace(),
        isFormalCustomerVehicleApiEnabled ? Promise.resolve([] as QuickOrder[]) : api.quickOrders.list(),
        isFormalCustomerVehicleApiEnabled ? fetchFormalBusinessOrders({ pageSize: 100 }) : Promise.resolve(null),
        isFormalCustomerVehicleApiEnabled ? Promise.resolve([]) : optionalLinkedArchive(api.vehicles.inspectionReportPhotos(vehicleId)),
        isFormalCustomerVehicleApiEnabled ? Promise.resolve([]) : optionalLinkedArchive(api.vehicles.inspectionReportArchive(vehicleId)),
      ]);
      const nextBusinessOrders = allOrders
        .filter((order) => order.vehicleId === vehicleId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (
        loadGenerationRef.current !== generation
        || currentSessionKey() !== requestedSessionKey
        || requestedVehicleId !== vehicleId
      ) return;
      setVehicle(isFormalCustomerVehicleApiEnabled
        ? nextWorkspace.vehicles.find((entry) => entry.id === vehicleId) ?? detail
        : detail);
      setWorkspace(nextWorkspace);
      setBusinessOrders(nextBusinessOrders);
      setFormalBusinessOrders(
        formalOrderPage && detail.formalId
          ? formalOrderPage.items.filter((order) => order.vehicleId === detail.formalId)
          : [],
      );
      setInspectionReportPhotoGroups(nextInspectionReportPhotos);
      setInspectionReportArchive(nextInspectionReportArchive);
      setDataSessionKey(requestedSessionKey);
      setLoading(false);
    } catch (loadError) {
      if (
        loadGenerationRef.current !== generation
        || currentSessionKey() !== requestedSessionKey
        || requestedVehicleId !== vehicleId
      ) return;
      setVehicle(null);
      setWorkspace(null);
      setBusinessOrders([]);
      setInspectionReportPhotoGroups([]);
      setInspectionReportArchive([]);
      setDataSessionKey(requestedSessionKey);
      setError(errorMessage(loadError));
      setLoading(false);
    }
  }, [optionalLinkedArchive, sessionKey, vehicleId]);

  useEffect(() => {
    if (isMockApiEnabled && sessionKey === "anonymous") {
      setLoading(true);
      setError(null);
      setVehicle(null);
      setWorkspace(null);
      setBusinessOrders([]);
      setInspectionReportPhotoGroups([]);
      setInspectionReportArchive([]);
      setDataSessionKey(null);
      setEditing(false);
      loadGenerationRef.current += 1;
      return;
    }
    setVehicle(null);
    setWorkspace(null);
    setBusinessOrders([]);
    setInspectionReportPhotoGroups([]);
    setInspectionReportArchive([]);
    setDataSessionKey(null);
    setEditing(false);
    void load();
    return () => { loadGenerationRef.current += 1; };
  }, [load, reloadSequence, sessionKey]);

  const relationships = useMemo(
    () => (workspace?.relationships ?? []).filter((relationship) => relationship.vehicleId === vehicle?.id),
    [vehicle?.id, workspace],
  );
  const customersById = useMemo(
    () => new Map((workspace?.customers ?? []).map((customer) => [customer.id, customer])),
    [workspace],
  );
  const currentRelationship = relationships.find((relationship) => relationship.endedAt === null) ?? null;
  const historicalRelationships = relationships.filter((relationship) => relationship.endedAt !== null);

  const backLink = (
    <Link
      href="/vehicles"
      data-testid="vehicle-detail-back"
      className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-soft transition-colors hover:border-primary-200 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-primary-300"
    >
      <ArrowLeft size={13} aria-hidden />返回车辆列表
    </Link>
  );

  if (loading || dataSessionKey !== sessionKey || (vehicle !== null && vehicle.id !== vehicleId)) {
    return (
      <div data-testid="vehicle-detail-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
        <div className="mx-auto min-w-0 max-w-[1320px]">
          {backLink}
          <div data-testid="vehicle-detail-loading" role="status" className="rounded-2xl border border-line bg-white p-12 text-center text-sm text-ink-soft shadow-card dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
            正在读取车辆详情…
          </div>
        </div>
      </div>
    );
  }

  if (error || !vehicle) {
    return (
      <div data-testid="vehicle-detail-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
        <div className="mx-auto min-w-0 max-w-[1320px]">
          {backLink}
          <div data-testid="vehicle-detail-error" role="alert" className="rounded-2xl border border-line bg-white p-8 text-center shadow-card dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-sm font-semibold text-danger">{error ?? "未找到该车辆"}</p>
            <button
              type="button"
              data-testid="vehicle-detail-retry"
              onClick={() => setReloadSequence((value) => value + 1)}
              className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentCustomer = currentRelationship ? customersById.get(currentRelationship.customerId) : null;
  const currentCustomerName = currentRelationship
    ? currentCustomer ? customerDisplayName(currentCustomer) : currentRelationship.customerId
    : "";
  const plate = vehicle.plate || "无车牌";

  return (
    <div key={`${sessionKey}:${vehicle.id}`} data-testid="vehicle-detail-page" className="min-h-full min-w-0 bg-[var(--wh-page-bg)] p-3 sm:p-6">
      <div className="mx-auto min-w-0 max-w-[1320px]">
        <PageHeader
          breadcrumb="客户与车辆 / 车辆详情"
          title={plate}
          titleTestId="vehicle-detail-heading"
          description={`${vehicle.makeZh ? `${vehicle.makeZh} ` : ""}${vehicle.make} ${vehicle.modelZh && vehicle.modelZh !== vehicle.model ? `${vehicle.modelZh} ` : ""}${vehicle.model} · ${vehicle.id}`}
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isFormalCustomerVehicleApiEnabled ? <RecordDeleteButton
                record={{ kind: "vehicle", recordNo: vehicle.id, version: vehicle.revision }}
                title="删除车辆档案"
                returnTo="/vehicles"
              /> : null}
              <button
                type="button"
                onClick={() => setEditing(true)}
                data-testid="vehicle-edit-btn"
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
              >
                <Pencil size={14} aria-hidden />编辑
              </button>
            </div>
          }
        />
        {backLink}

        <div className="space-y-4">
          <DetailSection testId="vehicle-section-master" icon={Car} title="车辆主档" hint="品牌、车型、VIN 与登记信息">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-50 text-purple-500 dark:bg-purple-500/15">
                <Car size={20} aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-line bg-white px-2 py-1 font-mono text-base font-bold text-ink dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">{plate}</span>
                  <VehicleStatusBadge status={vehicle.status} />
                  {vehicle.hasOpenDispute ? <span data-testid="vehicle-open-dispute" className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">客户争议中 · #{vehicle.openDisputeId}</span> : null}
                </div>
                <div className="mt-2 break-words text-sm font-semibold text-ink dark:text-slate-100">
                  {vehicle.make} {vehicle.model}
                  {vehicle.makeZh ? <span className="ml-1.5 text-xs font-normal text-ink-soft dark:text-slate-400">{vehicle.makeZh}{vehicle.modelZh && vehicle.modelZh !== vehicle.model ? ` ${vehicle.modelZh}` : ""}</span> : null}
                </div>
                <div className="mt-1 break-all font-mono text-[10px] text-ink-soft dark:text-slate-400">{vehicle.id}</div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField label="车架号（Chassis No.）" value={vehicle.vin} mono />
              <DetailField label="发动机号" value={vehicle.engineNumber} mono />
              <DetailField label="品牌 / 车型" value={`${vehicle.makeZh ? `${vehicle.makeZh} ` : ""}${vehicle.make} / ${vehicle.modelZh && vehicle.modelZh !== vehicle.model ? `${vehicle.modelZh} ` : ""}${vehicle.model}`} />
              <DetailField label="年份" value={vehicleYearLabel(vehicle.year)} />
              <DetailField label="颜色" value={vehicle.color} />
              <DetailField label="车身类型" value={vehicle.bodyType} />
              <DetailField label="燃油 / 排量" value={vehicle.fuelType || vehicle.ccRating ? `${vehicle.fuelType ?? "—"}${vehicle.ccRating ? ` / ${vehicle.ccRating} cc` : ""}` : null} />
              <DetailField label="座位数" value={vehicle.seating ? `${vehicle.seating} 座` : null} />
              <DetailField label="用途" value={vehicle.usage} />
              <DetailField label="登记时间" value={vehicle.createdAt ? formatDateTime(vehicle.createdAt) : null} />
              <DetailField label="更新时间" value={vehicle.updatedAt ? formatDateTime(vehicle.updatedAt) : null} />
              <div className="sm:col-span-2 lg:col-span-3"><DetailField label="车辆特别说明" value={vehicle.specialNotes} /></div>
            </div>
          </DetailSection>

          <>
          <DetailSection testId="vehicle-section-photos" icon={Car} title="照片档案" count={vehicle.photos.length} hint="注册证、检验合格证、维修过程照片都归这辆车">
            {vehicle.photos.length === 0 ? (
              <DetailEmpty>暂无照片——车证、适航证、维修照片拍照后归档到这里</DetailEmpty>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {vehicle.photos.map((photo) => (
                  <figure key={photo.id} data-testid={`vehicle-photo-${photo.id}`} className="overflow-hidden rounded-xl border border-line bg-white dark:border-slate-700 dark:bg-slate-900/50">
                    <a href={photo.url} target="_blank" rel="noreferrer">
                      <img src={photo.url} alt={photo.note} className="h-32 w-full object-cover transition-transform hover:scale-[1.02]" loading="lazy" />
                    </a>
                    <figcaption className="px-2.5 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                          photo.kind === "registration" ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                          : photo.kind === "fitness" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : photo.kind === "repair" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        }`}>
                          {photo.kind === "registration" ? "注册证" : photo.kind === "fitness" ? "适航证" : photo.kind === "repair" ? "维修照片" : "其他"}
                        </span>
                        {photo.linkedOrderId ? <span className="font-mono text-[9px] text-ink-faint dark:text-slate-500">{photo.linkedOrderId}</span> : null}
                      </div>
                      <p className="mt-1 break-words text-[11px] text-ink dark:text-slate-200">{photo.note}</p>
                      <p className="mt-0.5 text-[10px] text-ink-soft dark:text-slate-400">{photo.uploadedBy} · {formatDateTime(photo.uploadedAt)}</p>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </DetailSection>

          {!isFormalCustomerVehicleApiEnabled ? <>
          <DetailSection
            testId="vehicle-section-inspection-report-history"
            icon={FileText}
            title="Inspection Report 历史档案"
            count={inspectionReportArchive.length}
            hint="按每次检查结果分组；包含发现、当前报价、客户文件、通知、回复、旧史与附件引用"
          >
            {inspectionReportArchive.length === 0 ? <DetailEmpty>暂无 Inspection Report 历史</DetailEmpty> : <VehicleReportHistoryArchive groups={inspectionReportArchive} />}
          </DetailSection>

          <DetailSection
            testId="vehicle-section-inspection-report-photos"
            icon={ClipboardList}
            title="Inspection Report 现场照片"
            count={inspectionReportPhotoGroups.reduce((sum, group) => sum + group.photos.length, 0)}
            hint="按检查结果归档；与 Inspection Report 共用同一附件，不复制 Blob"
          >
            {inspectionReportPhotoGroups.length === 0 ? (
              <DetailEmpty>暂无 Inspection Report 现场照片</DetailEmpty>
            ) : (
              <VehicleReportPhotoArchive vehicleId={vehicle.id} groups={inspectionReportPhotoGroups} />
            )}
          </DetailSection>
          </> : null}
          </>

          <div className={cn("grid min-w-0 items-start gap-4", isFormalCustomerVehicleApiEnabled ? "lg:grid-cols-1" : "lg:grid-cols-2")}>
            <div className="min-w-0 space-y-4">
              <DetailSection testId="vehicle-section-current-customers" icon={User} title="当前客户" count={currentRelationship ? 1 : 0}>
                <div data-testid="vehicle-active-relationships">
                  {currentRelationship === null ? (
                    <DetailEmpty>暂无当前客户关系</DetailEmpty>
                  ) : (
                    <Link
                      href={`/customers/${currentRelationship.customerId}`}
                      data-testid={`vehicle-customer-link-${currentRelationship.customerId}`}
                      aria-label={`查看客户 ${currentCustomerName} 详情`}
                      className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900/50"
                    >
                      <div className="min-w-0">
                        <div className="break-words text-sm font-semibold text-ink dark:text-slate-100">{currentCustomerName}</div>
                        <div className="mt-1 break-words text-[10px] text-ink-soft dark:text-slate-400">
                          <span className="font-mono">{currentRelationship.customerId}</span>{currentCustomer?.phone ? ` · ${formatPhoneE164(currentCustomer.phone)}` : ""}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-ink-soft dark:text-slate-400">{currentRelationship.id} · 自 {formatDateTime(currentRelationship.startedAt)}</div>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-primary-700 dark:text-primary-300">
                        客户详情 <ArrowRight size={10} aria-hidden />
                      </span>
                    </Link>
                  )}
                </div>
              </DetailSection>

              <DetailSection testId="vehicle-section-historical-customers" icon={History} title="历史客户关系" count={historicalRelationships.length}>
                {historicalRelationships.length === 0 ? (
                  <DetailEmpty>暂无历史客户关系</DetailEmpty>
                ) : (
                  <div className="space-y-1.5">
                    {historicalRelationships.map((relationship) => {
                      const customer = customersById.get(relationship.customerId);
                      const customerName = customer ? customerDisplayName(customer) : relationship.customerId;
                      return (
                        <Link
                          key={relationship.id}
                          href={`/customers/${relationship.customerId}`}
                          data-testid={`vehicle-customer-history-${relationship.id}`}
                          aria-label={`查看历史关联客户 ${customerName} 详情`}
                          className="flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-xl border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900/50 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="min-w-0 break-words text-xs font-semibold text-ink dark:text-slate-100">{customerName}</span>
                          <span className="shrink-0 text-[10px] text-ink-soft dark:text-slate-400">
                            {formatDateTime(relationship.startedAt)} — {relationship.endedAt ? formatDateTime(relationship.endedAt) : "—"}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </DetailSection>

              <DetailSection
                testId="vehicle-section-business-orders"
                icon={ClipboardList}
                title="关联业务单"
                count={isFormalCustomerVehicleApiEnabled ? formalBusinessOrders.length : businessOrders.length}
                hint="每单入场里程由维修工接车时记录"
              >
                {isFormalCustomerVehicleApiEnabled ? (
                  formalBusinessOrders.length === 0 ? <DetailEmpty>暂无关联业务单</DetailEmpty> : (
                    <div className="space-y-1.5">
                      {formalBusinessOrders.map((businessOrder) => (
                        <Link
                          key={businessOrder.id}
                          href={`/orders/business/${businessOrder.id}`}
                          className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2.5 transition-colors hover:border-primary-200 hover:bg-primary-50/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900/50"
                        >
                          <div className="min-w-0">
                            <div className="break-all font-mono text-xs font-bold text-ink dark:text-slate-100">{businessOrder.orderNo}</div>
                            <div className="mt-1 text-[10px] text-ink-soft dark:text-slate-400">创建：{formatDateTime(businessOrder.createdAt)}</div>
                          </div>
                          <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                            {businessOrder.voided ? "已作废" : FORMAL_BUSINESS_ORDER_STATUS_LABELS[businessOrder.status]}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )
                ) : businessOrders.length === 0 ? (
                  <DetailEmpty>暂无关联业务单</DetailEmpty>
                ) : (
                  <div className="space-y-1.5">
                    {businessOrders.map((businessOrder) => {
                      const hasRecordedMileage = businessOrder.startMileageKm !== null;
                      return (
                        <Link
                          key={businessOrder.id}
                          href={`/orders/business/${businessOrder.id}`}
                          data-testid={`vehicle-business-order-${businessOrder.id}`}
                          aria-label={`查看业务单 ${businessOrder.businessOrderNo} 详情`}
                          className="block min-w-0 rounded-xl border border-line bg-white px-3 py-2.5 transition-colors hover:border-primary-200 hover:bg-primary-50/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-primary-400/50 dark:hover:bg-primary/5"
                        >
                          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="break-all font-mono text-xs font-bold text-ink dark:text-slate-100">
                                  {businessOrder.businessOrderNo}
                                </span>
                                {businessOrder.voidedAt !== null ? (
                                  <span data-testid="vehicle-order-voided" className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">已作废</span>
                                ) : (
                                  <span className={cn(
                                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold",
                                    QUICK_BO_STATUS_TONES[businessOrder.status],
                                  )}>
                                    {QUICK_BO_STATUS_LABELS[businessOrder.status]}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-ink-soft dark:text-slate-400">
                                <span>创建：{formatDateTime(businessOrder.createdAt)}</span>
                                <span>{businessOrder.acceptedAt ? `接车：${formatDateTime(businessOrder.acceptedAt)}` : "尚未接车"}</span>
                              </div>
                            </div>
                            <div
                              data-testid={`vehicle-business-order-mileage-${businessOrder.id}`}
                              className="min-w-0 shrink-0 sm:max-w-[250px] sm:text-right"
                            >
                              <div className="text-xs font-bold tabular-nums text-ink dark:text-slate-100">
                                {hasRecordedMileage
                                  ? `入场里程：${businessOrder.startMileageKm!.toLocaleString("en-US")} km`
                                  : "入场里程：未记录"}
                              </div>
                              <div className="mt-1 break-words text-[10px] text-ink-soft dark:text-slate-400">
                                {hasRecordedMileage
                                  ? `${businessOrder.startMileageRecordedBy} · ${formatDateTime(businessOrder.startMileageRecordedAt!)}`
                                  : businessOrder.acceptedAt ? "接车时未记录里程" : "业务尚未接车"}
                              </div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </DetailSection>

              {!isFormalCustomerVehicleApiEnabled ? <DetailSection testId="vehicle-section-tasks" icon={Calendar} title="任务" count={vehicle.tasks.length}>
                {vehicle.tasks.length === 0 ? (
                  <DetailEmpty>暂无任务</DetailEmpty>
                ) : (
                  <div className="space-y-1.5">
                    {vehicle.tasks.map((task) => (
                      <div key={task.id} className="rounded-xl border border-line bg-white px-3 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <span className="break-words font-semibold text-ink dark:text-slate-100">{task.title}</span>
                          <span className={cn("shrink-0 font-semibold", taskStatusTone(task.status))}>{taskStatusLabel(task.status)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-ink-soft dark:text-slate-400">
                          <span className="font-mono font-semibold">{task.id}</span>
                          <span>负责人：{task.assignee}</span>
                          <span>{task.dueAt ? `截止：${formatDateTime(task.dueAt)}` : "未设截止时间"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </DetailSection> : null}
            </div>

            <div className="min-w-0 space-y-4">
              {!isFormalCustomerVehicleApiEnabled ? <DetailSection testId="vehicle-section-parts-needs" icon={Package} title="配件需求" count={vehicle.partsNeeds.length}>
                {vehicle.partsNeeds.length === 0 ? (
                  <DetailEmpty>暂无配件需求</DetailEmpty>
                ) : (
                  <div className="space-y-1.5">
                    {vehicle.partsNeeds.map((part) => (
                      <div key={part.id} data-testid="vehicle-part-need" className="flex min-w-0 items-start justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-900/50">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {part.urgency === "urgent" ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-600" aria-label="紧急" /> : null}
                            <span className="break-words font-semibold text-ink dark:text-slate-100">{part.name}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-ink-soft dark:text-slate-400">
                            <span className="font-mono font-semibold">{part.id}</span>
                            <span>预估 {formatJMDFull(part.estimatedCost)}</span>
                            <span>{part.urgency === "urgent" ? "紧急" : "普通"}</span>
                          </div>
                        </div>
                        <span className={cn("shrink-0 font-semibold", partStatusTone(part.status))}>{partStatusLabel(part.status)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </DetailSection> : null}

              <DetailSection testId="vehicle-section-attachments" icon={Paperclip} title="可调取附件" count={vehicle.attachments.length}>
                {vehicle.attachments.length === 0 ? (
                  <DetailEmpty>暂无可调取附件</DetailEmpty>
                ) : (
                  <div className="space-y-1.5">
                    {vehicle.attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        data-testid={`vehicle-attachment-${attachment.id}`}
                        className="flex min-w-0 items-start gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-xs transition-colors hover:border-primary-200 dark:border-slate-700 dark:bg-slate-900/50"
                      >
                        <FileText size={14} className="mt-0.5 shrink-0 text-ink-soft dark:text-slate-400" aria-hidden />
                        <div className="min-w-0">
                          <div className="break-all font-semibold text-ink dark:text-slate-100">{attachment.fileName}</div>
                          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-ink-soft dark:text-slate-400">
                            <span className="font-mono font-semibold">{attachment.id}</span>
                            <span>{attachment.mimeType}</span>
                            <span>{attachment.createdBy}</span>
                            <span>{formatDateTime(attachment.createdAt)}</span>
                            <span>打开文件 ↗</span>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </DetailSection>
            </div>
          </div>
          <p data-testid="vehicle-revision" className="sr-only">当前 revision：{vehicle.revision}</p>
        </div>
      </div>

      {editing && workspace ? (
        <VehicleFormDialog
          mode="edit"
          vehicle={vehicle}
          customers={workspace.customers}
          relationships={relationships}
          onClose={() => setEditing(false)}
          onSaved={(record) => {
            setEditing(false);
            setVehicle(record);
            void loadWorkspace().then((nextWorkspace) => {
              if (currentSessionKey() !== sessionKey) return;
              setWorkspace(nextWorkspace);
              if (isFormalCustomerVehicleApiEnabled) {
                setVehicle(nextWorkspace.vehicles.find((entry) => entry.id === vehicleId) ?? record);
              }
            }).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}
