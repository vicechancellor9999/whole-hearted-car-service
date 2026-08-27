"use client";

import { AlertCircle, Car, ClipboardList, Link2Off, MapPin, Warehouse, type LucideIcon } from "lucide-react";
import type { VehicleCustomerRelationship, VehicleRecord } from "@/lib/customers/types";

export type VehicleSummaryFilter = "all" | "on_site" | "off_site" | "incomplete" | "open_tasks" | "unbound";

export function vehicleArchiveIncomplete(vehicle: VehicleRecord): boolean {
  return !vehicle.plate.trim()
    || !vehicle.vin.trim()
    || !vehicle.make.trim()
    || !vehicle.model.trim()
    || !Number.isFinite(vehicle.year)
    || vehicle.year <= 0
    || vehicle.photos.length === 0;
}

export function vehicleHasOpenTask(vehicle: VehicleRecord): boolean {
  return vehicle.tasks.some((task) => task.status === "pending" || task.status === "in_progress");
}

export function vehicleHasCurrentCustomer(
  vehicleId: string,
  relationships: VehicleCustomerRelationship[],
): boolean {
  return relationships.some((relationship) => (
    relationship.vehicleId === vehicleId && relationship.endedAt === null
  ));
}

export function vehicleMatchesSummaryFilter(
  vehicle: VehicleRecord,
  relationships: VehicleCustomerRelationship[],
  filter: VehicleSummaryFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "on_site" || filter === "off_site") return vehicle.status === filter;
  if (filter === "incomplete") return vehicleArchiveIncomplete(vehicle);
  if (filter === "open_tasks") return vehicleHasOpenTask(vehicle);
  return !vehicleHasCurrentCustomer(vehicle.id, relationships);
}

export function VehicleSummaryCards({
  vehicles,
  relationships,
  activeFilter,
  onFilterChange,
}: {
  vehicles: VehicleRecord[];
  relationships: VehicleCustomerRelationship[];
  activeFilter: VehicleSummaryFilter;
  onFilterChange: (filter: VehicleSummaryFilter) => void;
}) {
  const cards: Array<{
    id: VehicleSummaryFilter;
    label: string;
    value: number;
    detail: string;
    icon: LucideIcon;
    tone: string;
  }> = [
    { id: "all", label: "车辆总数", value: vehicles.length, detail: "当前全部车辆档案", icon: Car, tone: "text-primary bg-primary-50 dark:bg-primary-500/10" },
    { id: "on_site", label: "当前在场", value: vehicles.filter((vehicle) => vehicle.status === "on_site").length, detail: "车辆状态为在场", icon: Warehouse, tone: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" },
    { id: "off_site", label: "当前离场", value: vehicles.filter((vehicle) => vehicle.status === "off_site").length, detail: "车辆状态为离场", icon: MapPin, tone: "text-sky-600 bg-sky-50 dark:bg-sky-500/10" },
    { id: "incomplete", label: "档案待补", value: vehicles.filter(vehicleArchiveIncomplete).length, detail: "车牌 / VIN / 车型 / 照片", icon: AlertCircle, tone: "text-amber-600 bg-amber-50 dark:bg-amber-500/10" },
    { id: "open_tasks", label: "有待办任务", value: vehicles.filter(vehicleHasOpenTask).length, detail: "存在待处理或进行中任务", icon: ClipboardList, tone: "text-violet-600 bg-violet-50 dark:bg-violet-500/10" },
    { id: "unbound", label: "无当前客户", value: vehicles.filter((vehicle) => !vehicleHasCurrentCustomer(vehicle.id, relationships)).length, detail: "尚未绑定当前车主", icon: Link2Off, tone: "text-rose-600 bg-rose-50 dark:bg-rose-500/10" },
  ];

  return (
    <div data-testid="vehicle-summary-cards" className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => {
        const Icon = card.icon;
        const selected = activeFilter === card.id;
        return (
          <button
            key={card.id}
            type="button"
            data-testid={`vehicle-summary-${card.id}`}
            aria-pressed={selected}
            onClick={() => onFilterChange(card.id)}
            className={`min-w-0 rounded-xl border bg-white p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:bg-slate-800 ${selected ? "border-primary shadow-sm ring-1 ring-primary/20" : "border-line hover:border-primary-200"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-ink-soft dark:text-slate-400">{card.label}</span>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${card.tone}`}><Icon size={14} aria-hidden /></span>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink dark:text-slate-100">{card.value.toLocaleString("en-US")}</p>
            <p className="mt-0.5 truncate text-[9px] text-ink-faint dark:text-slate-500">{card.detail}</p>
          </button>
        );
      })}
    </div>
  );
}
