"use client";

import { useRouter } from "next/navigation";
import { Car, ChevronRight } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { CustomerRecord, VehicleCustomerRelationship, VehicleRecord } from "@/lib/customers/types";
import { customerDisplayName } from "./customer-list";
import { VehicleStatusBadge } from "./badges";
import { vehicleYearLabel } from "@/lib/customers/vehicle-year";

interface VehicleListProps {
  vehicles: VehicleRecord[];
  customersById: Map<string, CustomerRecord>;
  relationships: VehicleCustomerRelationship[];
}

function activeCustomerName(
  vehicleId: string,
  relationships: VehicleCustomerRelationship[],
  customersById: Map<string, CustomerRecord>,
): string {
  const relationship = relationships.find(
    (entry) => entry.vehicleId === vehicleId && entry.endedAt === null,
  );
  const customer = relationship ? customersById.get(relationship.customerId) : null;
  return customer ? customerDisplayName(customer) : "暂无当前客户";
}

function VehicleIdentity({ vehicle, testIdSuffix = "" }: { vehicle: VehicleRecord; testIdSuffix?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-purple-50 text-purple-500 dark:bg-purple-500/15">
        <Car size={14} aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs font-bold text-ink dark:bg-slate-900 dark:text-slate-100">{vehicle.plate || "无车牌"}</span>
          <span className="truncate text-xs text-ink-soft dark:text-slate-300">
            {vehicle.makeZh ? `${vehicle.makeZh} ` : ""}{vehicle.make} {vehicle.modelZh && vehicle.modelZh !== vehicle.model ? `${vehicle.modelZh} ` : ""}{vehicle.model}{vehicle.variant ? ` ${vehicle.variant}` : ""}
          </span>
        </div>
        <div
          data-testid={`vehicle-secondary-${vehicle.id}${testIdSuffix}`}
          className="mt-0.5 truncate text-[10px] text-ink-soft dark:text-slate-400"
        >
          {[vehicleYearLabel(vehicle.year), vehicle.color, vehicle.id].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}

function VehicleTableRow({
  vehicle,
  customerNames,
}: {
  vehicle: VehicleRecord;
  customerNames: string;
}) {
  const router = useRouter();
  const openTaskCount = vehicle.tasks.filter((task) => task.status !== "completed").length;
  const openDetail = () => router.push(`/vehicles/${vehicle.id}`);
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail();
    }
  };
  return (
    <tr
      data-testid={`vehicle-row-${vehicle.id}`}
      role="link"
      tabIndex={0}
      aria-label={`查看车辆 ${vehicle.plate || "无车牌"} 详情`}
      onClick={openDetail}
      onKeyDown={handleKeyDown}
      className="cursor-pointer border-b border-line bg-white transition-colors last:border-b-0 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:bg-slate-800 dark:hover:bg-slate-700/40"
    >
      <td className="px-3 py-1.5"><VehicleIdentity vehicle={vehicle} /></td>
      <td className="truncate px-3 py-1.5 text-xs text-ink dark:text-slate-200">{customerNames}</td>
      <td data-testid={`vehicle-mileage-${vehicle.id}`} className="px-3 py-1.5 text-right text-xs tabular-nums text-ink dark:text-slate-200">
        {vehicle.mileage === null ? <span className="text-amber-600">待补</span> : `${vehicle.mileage.toLocaleString("en-US")} ${vehicle.mileageUnit}`}
      </td>
      <td className="px-3 py-1.5 text-center text-[11px] text-ink-soft dark:text-slate-300">
        <span className="font-semibold text-ink dark:text-slate-100">{vehicle.photos.length}</span> 照片
        <span className="mx-1 text-ink-faint">·</span>
        <span className="font-semibold text-ink dark:text-slate-100">{vehicle.attachments.length}</span> 附件
      </td>
      <td className="px-3 py-1.5 text-center">
        {openTaskCount > 0 ? (
          <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{openTaskCount} 项待办</span>
        ) : (
          <span className="text-[10px] text-ink-faint">无待办</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center justify-end gap-2">
          {vehicle.hasOpenDispute ? (
            <span data-testid={`vehicle-dispute-${vehicle.id}`} className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">争议中</span>
          ) : null}
          <VehicleStatusBadge status={vehicle.status} dataTestId={`vehicle-status-${vehicle.status}-${vehicle.id}`} />
          <button
            type="button"
            data-testid={`vehicle-open-${vehicle.id}`}
            aria-label={`查看车辆 ${vehicle.plate || "无车牌"} 详情`}
            onClick={(event) => {
              event.stopPropagation();
              openDetail();
            }}
            className="grid h-7 w-7 place-items-center rounded-md border border-line bg-white text-ink-soft hover:border-primary-200 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:bg-slate-900 dark:text-slate-300 dark:hover:text-primary-300"
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
      </td>
    </tr>
  );
}

function VehicleCard({
  vehicle,
  customerNames,
}: {
  vehicle: VehicleRecord;
  customerNames: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      data-testid={`vehicle-card-${vehicle.id}`}
      aria-label={`查看车辆 ${vehicle.plate || "无车牌"} 详情`}
      onClick={() => router.push(`/vehicles/${vehicle.id}`)}
      className="w-full rounded-xl border border-line bg-white p-3 text-left shadow-card transition-colors hover:border-primary-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:bg-slate-800"
    >
      <div className="flex items-start justify-between gap-2">
        <VehicleIdentity vehicle={vehicle} testIdSuffix="-mobile" />
        <div className="flex shrink-0 flex-col items-end gap-1">
          {vehicle.hasOpenDispute ? <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">争议中</span> : null}
          <VehicleStatusBadge status={vehicle.status} dataTestId={`vehicle-status-${vehicle.status}-${vehicle.id}-mobile`} />
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-soft dark:text-slate-300">
        <span className="max-w-full truncate rounded-full bg-gray-100 px-2 py-0.5 dark:bg-slate-700">{customerNames}</span>
        <span data-testid={`vehicle-mileage-${vehicle.id}-mobile`} className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-slate-700">里程 {vehicle.mileage === null ? "待补" : `${vehicle.mileage.toLocaleString("en-US")} ${vehicle.mileageUnit}`}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-slate-700">照片 {vehicle.photos.length}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-slate-700">任务 {vehicle.tasks.length}</span>
      </div>
    </button>
  );
}

export function VehicleList({ vehicles, customersById, relationships }: VehicleListProps) {
  if (vehicles.length === 0) {
    return (
      <div data-testid="vehicle-list-empty" className="flex flex-col items-center justify-center py-16 text-center">
        <Car size={32} className="text-ink-soft dark:text-slate-400" aria-hidden />
        <p className="mt-2 text-sm text-ink-soft dark:text-slate-400">未找到匹配的车辆</p>
        <p className="mt-1 text-xs text-ink-soft dark:text-slate-400">尝试调整搜索条件或重置筛选</p>
      </div>
    );
  }

  return (
    <div data-testid="vehicle-list" className="h-full min-h-0">
      <div className="hidden h-full min-h-0 overflow-hidden sm:block">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface text-left dark:bg-slate-900/40">
              <th className="px-3 py-2 text-[11px] font-semibold text-ink-soft dark:text-slate-400">车牌 / 车型</th>
              <th className="w-[220px] px-3 py-2 text-[11px] font-semibold text-ink-soft dark:text-slate-400">当前客户</th>
              <th className="w-[120px] px-3 py-2 text-right text-[11px] font-semibold text-ink-soft dark:text-slate-400">最新里程</th>
              <th className="w-[145px] px-3 py-2 text-center text-[11px] font-semibold text-ink-soft dark:text-slate-400">照片 / 附件</th>
              <th className="w-[105px] px-3 py-2 text-center text-[11px] font-semibold text-ink-soft dark:text-slate-400">待办任务</th>
              <th className="w-[130px] px-3 py-2 text-right text-[11px] font-semibold text-ink-soft dark:text-slate-400">状态 / 操作</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => (
              <VehicleTableRow
                key={vehicle.id}
                vehicle={vehicle}
                customerNames={activeCustomerName(vehicle.id, relationships, customersById)}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2.5 sm:hidden">
        {vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            customerNames={activeCustomerName(vehicle.id, relationships, customersById)}
          />
        ))}
      </div>
    </div>
  );
}
