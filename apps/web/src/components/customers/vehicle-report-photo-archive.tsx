"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { VehicleInspectionReportPhotoGroup } from "@/lib/api/mock-inspection-reports";
import { formatDateTime } from "@/lib/utils";

export function VehicleReportPhotoArchive({ vehicleId, groups }: {
  vehicleId: string;
  groups: VehicleInspectionReportPhotoGroup[];
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const urlsRef = useRef(urls);
  const generationRef = useRef(0);
  urlsRef.current = urls;

  useEffect(() => {
    const generation = ++generationRef.current;
    for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
    urlsRef.current = {};
    setUrls({});
    const photos = groups.flatMap((group) => group.photos);
    void Promise.all(photos.map(async (photo) => {
      if (photo.storageKind !== "indexeddb_blob") return;
      try {
        const blob = await api.vehicles.inspectionReportPhotoBlob(vehicleId, photo.reportId, photo.id);
        const url = URL.createObjectURL(blob);
        if (generationRef.current !== generation) {
          URL.revokeObjectURL(url);
          return;
        }
        setUrls((current) => ({ ...current, [photo.id]: url }));
      } catch {
        // Missing/corrupt data stays closed and is shown as repair-needed.
      }
    }));
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [groups, vehicleId]);

  useEffect(() => () => {
    for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.reportId} data-testid={`vehicle-ir-photo-group-${group.reportId}`} className="min-w-0 rounded-xl border border-line bg-surface p-3 dark:border-slate-700 dark:bg-slate-900/30">
          <header className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-1">
            <p className="break-all font-mono text-[11px] font-semibold text-ink dark:text-slate-100">{group.reportNo}</p>
            <p className="text-[10px] text-ink-soft dark:text-slate-400">{formatDateTime(group.submittedAt)}</p>
          </header>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
            {group.photos.map((photo) => {
              const url = urls[photo.id];
              return (
                <figure key={photo.id} data-testid={`vehicle-ir-photo-${photo.id}`} className="min-w-0 overflow-hidden rounded-xl border border-line bg-white dark:border-slate-700 dark:bg-slate-900/50">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" aria-label={`打开检查照片 ${photo.id}`} className="relative block h-32 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      <Image src={url} alt="车辆检查现场照片" fill unoptimized sizes="(max-width: 640px) 50vw, 33vw" className="object-cover transition-transform hover:scale-[1.02]" />
                    </a>
                  ) : (
                    <div className="flex h-32 items-center justify-center px-3 text-center text-[11px] text-amber-700 dark:text-amber-300">
                      {photo.storageKind === "legacy_reference" || photo.repairNeeded ? "旧照片待修复" : "照片读取失败"}
                    </div>
                  )}
                  <figcaption className="px-2.5 py-2">
                    <span className="inline-flex rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">检查现场照片</span>
                    <p className="mt-1 break-all font-mono text-[9px] text-ink-faint dark:text-slate-500">{photo.id}</p>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
