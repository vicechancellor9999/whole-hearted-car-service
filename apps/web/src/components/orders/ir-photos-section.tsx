"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Save, X } from "lucide-react";
import { api } from "@/lib/api/client";
import {
  inspectReportPhotoFile,
} from "@/lib/attachments/indexeddb-attachment-store";
import type {
  InspectionReportDetailResponse,
  InspectionReportPhotoDto,
} from "@/lib/api/mock-inspection-reports";

type PhotoStatus = {
  kind: "idle" | "reading" | "dirty" | "saving" | "saved" | "error";
  message: string;
};

type LocalPhoto = {
  localOccurrenceId: string;
  file: File;
  url: string;
};

function mutationId(): string {
  return `ir-photo-${Date.now()}-${crypto.randomUUID()}`;
}

function currentPhotoSessionKey(): string {
  return typeof window === "undefined" ? "server" : window.localStorage.getItem("wh_session") ?? "anonymous";
}

/** IR-wide photo editor. Blob bytes live only in the dedicated IndexedDB store. */
export function IrPhotosSection({ detail, onUpdated }: {
  detail: InspectionReportDetailResponse;
  onUpdated: (next: InspectionReportDetailResponse) => void;
}) {
  const [canonicalPhotos, setCanonicalPhotos] = useState(() => detail.photos);
  const [localPhotos, setLocalPhotos] = useState<LocalPhoto[]>([]);
  const [deleteIds, setDeleteIds] = useState<Set<string>>(() => new Set());
  const [canonicalUrls, setCanonicalUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<PhotoStatus>({
    kind: "idle",
    message: detail.photos.length ? `照片已保存（${detail.photos.length} 张）` : "尚未添加现场照片",
  });
  const sessionKey = currentPhotoSessionKey();
  const renderScopeKey = `${detail.id}\0${sessionKey}`;
  const renderScopeRef = useRef(renderScopeKey);
  renderScopeRef.current = renderScopeKey;
  const reportSessionRef = useRef(renderScopeKey);
  const occurrenceRef = useRef(0);
  const localPhotosRef = useRef(localPhotos);
  const canonicalUrlRef = useRef<Record<string, string>>({});
  const resolverGenerationRef = useRef(0);
  const selectionGenerationRef = useRef(0);
  const asyncScopeGenerationRef = useRef(0);
  const intentRef = useRef<{ signature: string; mutationId: string } | null>(null);
  localPhotosRef.current = localPhotos;
  canonicalUrlRef.current = canonicalUrls;

  useEffect(() => {
    const reportSessionKey = `${detail.id}\0${sessionKey}`;
    if (reportSessionRef.current !== reportSessionKey) {
      reportSessionRef.current = reportSessionKey;
      selectionGenerationRef.current += 1;
      asyncScopeGenerationRef.current += 1;
      for (const photo of localPhotosRef.current) URL.revokeObjectURL(photo.url);
      for (const url of Object.values(canonicalUrlRef.current)) URL.revokeObjectURL(url);
      localPhotosRef.current = [];
      canonicalUrlRef.current = {};
      setLocalPhotos([]);
      setDeleteIds(new Set());
      setCanonicalUrls({});
      occurrenceRef.current = 0;
      intentRef.current = null;
      setStatus({
        kind: "idle",
        message: detail.photos.length ? `照片已保存（${detail.photos.length} 张）` : "尚未添加现场照片",
      });
    }
    setCanonicalPhotos(detail.photos);
    const activeIds = new Set(detail.photos.map((photo) => photo.id));
    setDeleteIds((current) => new Set([...current].filter((id) => activeIds.has(id))));
  }, [detail.id, detail.photos, sessionKey]);

  useEffect(() => {
    const generation = ++resolverGenerationRef.current;
    const previous = canonicalUrlRef.current;
    canonicalUrlRef.current = {};
    setCanonicalUrls({});
    for (const url of Object.values(previous)) URL.revokeObjectURL(url);
    void Promise.all(canonicalPhotos.map(async (photo) => {
      if (photo.storageKind !== "indexeddb_blob") return;
      try {
        const blob = await api.inspectionReports.photoBlob(detail.id, photo.id);
        const url = URL.createObjectURL(blob);
        if (
          resolverGenerationRef.current !== generation
          || renderScopeRef.current !== `${detail.id}\0${sessionKey}`
          || sessionKey !== currentPhotoSessionKey()
        ) {
          URL.revokeObjectURL(url);
          return;
        }
        setCanonicalUrls((current) => ({ ...current, [photo.id]: url }));
      } catch {
        // Missing or corrupt bytes stay closed and render as a repair-needed card.
      }
    }));
    return () => {
      if (resolverGenerationRef.current === generation) resolverGenerationRef.current += 1;
    };
  }, [canonicalPhotos, detail.id, sessionKey]);

  useEffect(() => () => {
    selectionGenerationRef.current += 1;
    asyncScopeGenerationRef.current += 1;
    for (const photo of localPhotosRef.current) URL.revokeObjectURL(photo.url);
    for (const url of Object.values(canonicalUrlRef.current)) URL.revokeObjectURL(url);
  }, []);

  const appendPhotos = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    const generation = selectionGenerationRef.current;
    const asyncScope = asyncScopeGenerationRef.current;
    const reportSessionKey = renderScopeRef.current;
    setStatus({ kind: "reading", message: "正在验证照片…" });
    try {
      await Promise.all(selected.map(inspectReportPhotoFile));
      if (
        selectionGenerationRef.current !== generation
        || asyncScopeGenerationRef.current !== asyncScope
        || renderScopeRef.current !== reportSessionKey
        || reportSessionKey !== `${detail.id}\0${currentPhotoSessionKey()}`
      ) return;
      const additions = selected.map((file): LocalPhoto => {
        occurrenceRef.current += 1;
        return {
          localOccurrenceId: `${detail.id}-local-${occurrenceRef.current}`,
          file,
          url: URL.createObjectURL(file),
        };
      });
      if (
        selectionGenerationRef.current !== generation
        || asyncScopeGenerationRef.current !== asyncScope
        || renderScopeRef.current !== reportSessionKey
        || reportSessionKey !== `${detail.id}\0${currentPhotoSessionKey()}`
      ) {
        for (const photo of additions) URL.revokeObjectURL(photo.url);
        return;
      }
      setLocalPhotos((current) => [...current, ...additions]);
      intentRef.current = null;
      setStatus({ kind: "dirty", message: `已添加 ${additions.length} 张，尚未保存` });
    } catch (caught) {
      if (
        asyncScopeGenerationRef.current !== asyncScope
        || renderScopeRef.current !== reportSessionKey
        || reportSessionKey !== `${detail.id}\0${currentPhotoSessionKey()}`
      ) return;
      setStatus({ kind: "error", message: caught instanceof Error ? caught.message : "照片验证失败" });
    }
  }, [detail.id]);

  const removeLocalPhoto = useCallback((localOccurrenceId: string) => {
    setLocalPhotos((current) => current.filter((photo) => {
      if (photo.localOccurrenceId !== localOccurrenceId) return true;
      URL.revokeObjectURL(photo.url);
      return false;
    }));
    intentRef.current = null;
    setStatus({ kind: "dirty", message: "未保存照片已移除" });
  }, []);

  const removeCanonicalPhoto = useCallback((id: string) => {
    setDeleteIds((current) => new Set(current).add(id));
    intentRef.current = null;
    setStatus({ kind: "dirty", message: "照片已标记删除，尚未保存" });
  }, []);

  const visibleCanonical = useMemo(
    () => canonicalPhotos.filter((photo) => !deleteIds.has(photo.id)),
    [canonicalPhotos, deleteIds],
  );
  const dirty = localPhotos.length > 0 || deleteIds.size > 0;

  const save = useCallback(async () => {
    if (!dirty) return;
    const orderedDeleteIds = canonicalPhotos.flatMap((photo) => deleteIds.has(photo.id) ? [photo.id] : []);
    const signature = JSON.stringify({
      reportId: detail.id,
      expectedRevision: detail.revision,
      deleteIds: orderedDeleteIds,
      localOccurrences: localPhotos.map((photo) => ({ id: photo.localOccurrenceId, name: photo.file.name, size: photo.file.size })),
    });
    if (intentRef.current?.signature !== signature) intentRef.current = { signature, mutationId: mutationId() };
    const stableMutationId = intentRef.current.mutationId;
    const asyncScope = asyncScopeGenerationRef.current;
    const reportSessionKey = renderScopeRef.current;
    const scopeIsCurrent = () => asyncScopeGenerationRef.current === asyncScope
      && renderScopeRef.current === reportSessionKey
      && reportSessionKey === `${detail.id}\0${currentPhotoSessionKey()}`;
    setStatus({ kind: "saving", message: "正在保存照片…" });
    try {
      const result = await api.inspectionReports.updatePhotos(detail.id, {
        reportId: detail.id,
        expectedRevision: detail.revision,
        mutationId: stableMutationId,
        deleteIds: orderedDeleteIds,
        files: localPhotos.map((photo) => photo.file),
      });
      if (!scopeIsCurrent()) return;
      for (const photo of localPhotos) URL.revokeObjectURL(photo.url);
      setLocalPhotos([]);
      setDeleteIds(new Set());
      intentRef.current = null;
      const next = { ...detail, revision: result.revision, photos: result.photos };
      setCanonicalPhotos(next.photos);
      onUpdated(next);
      setStatus({ kind: "saved", message: next.photos.length ? `照片已保存（${next.photos.length} 张）` : "现场照片已清空" });
    } catch (caught) {
      if (!scopeIsCurrent()) return;
      const message = caught instanceof Error ? caught.message : "照片保存失败";
      if (typeof caught === "object" && caught !== null && "status" in caught && caught.status === 409) {
        try {
          const latest = await api.inspectionReports.detail(detail.id);
          if (!scopeIsCurrent()) return;
          const active = new Set(latest.photos.map((photo) => photo.id));
          setDeleteIds((current) => new Set([...current].filter((id) => active.has(id))));
          setCanonicalPhotos(latest.photos);
          intentRef.current = null;
          onUpdated(latest);
        } catch {
          // Keep the complete local intent when refresh also fails.
        }
      }
      if (!scopeIsCurrent()) return;
      setStatus({ kind: "error", message });
    }
  }, [canonicalPhotos, deleteIds, detail.id, detail.revision, dirty, localPhotos, onUpdated]);

  const busy = status.kind === "reading" || status.kind === "saving";
  const statusColor = status.kind === "error"
    ? "text-rose-600 dark:text-rose-300"
    : status.kind === "saved"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-ink-soft dark:text-slate-400";

  const preview = (key: string, url: string | undefined, alt: string, testId: string, remove: () => void, repairNeeded = false) => (
    <div key={key} className="group relative min-w-0 overflow-hidden rounded-xl border border-line bg-surface dark:border-slate-600 dark:bg-slate-900/40">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label={`打开原图：${alt}`} className="block aspect-square min-w-0">
          <Image src={url} alt={alt} data-testid={testId} fill unoptimized sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw" className="object-cover" />
        </a>
      ) : (
        <div className="flex aspect-square items-center justify-center px-3 text-center text-[11px] text-amber-700 dark:text-amber-300">
          {repairNeeded ? "旧照片待修复" : "照片正在读取…"}
        </div>
      )}
      <button type="button" aria-label={`删除${alt}`} disabled={busy} onClick={remove}
        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/75 text-white shadow-sm transition hover:bg-rose-600 disabled:opacity-50">
        <X size={14} />
      </button>
    </div>
  );

  return (
    <section data-testid="ir-photo-section" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-ink dark:text-slate-100">现场照片</h3>
          <p className="mt-0.5 text-[11px] leading-5 text-ink-soft dark:text-slate-400">照片归属整份检查结果及车辆档案，不进入客户 PDF。</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink hover:border-primary-300 hover:text-primary dark:border-slate-600 dark:text-slate-200">
            <ImagePlus size={14} /> 添加照片
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-testid="ir-photo-input" className="sr-only" disabled={busy}
              onChange={(event) => { void appendPhotos(event.target.files); event.target.value = ""; }} />
          </label>
          <button type="button" data-testid="ir-photo-save" disabled={busy || !dirty} onClick={() => void save()}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50">
            <Save size={14} /> {status.kind === "saving" ? "保存中…" : "保存照片"}
          </button>
        </div>
      </div>

      {visibleCanonical.length + localPhotos.length > 0 ? (
        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {visibleCanonical.map((photo, index) => preview(
            photo.id,
            canonicalUrls[photo.id],
            `现场照片 ${index + 1}`,
            `ir-photo-thumb-${index}`,
            () => removeCanonicalPhoto(photo.id),
            photo.storageKind === "legacy_reference" || (photo.storageKind === "indexeddb_blob" && canonicalUrls[photo.id] === undefined),
          ))}
          {localPhotos.map((photo, index) => preview(
            photo.localOccurrenceId,
            photo.url,
            `待上传现场照片 ${visibleCanonical.length + index + 1}`,
            `ir-photo-thumb-${visibleCanonical.length + index}`,
            () => removeLocalPhoto(photo.localOccurrenceId),
          ))}
        </div>
      ) : (
        <label className="mt-3 flex min-h-28 min-w-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface px-4 text-center text-xs text-ink-soft hover:border-primary-300 hover:text-primary dark:border-slate-600 dark:bg-slate-900/30 dark:text-slate-400">
          <ImagePlus size={22} />
          <span>点击添加现场照片，可一次选择多张</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={busy}
            onChange={(event) => { void appendPhotos(event.target.files); event.target.value = ""; }} />
        </label>
      )}

      <p role={status.kind === "error" ? "alert" : "status"} aria-live="polite" data-testid="ir-photo-status"
        className={`mt-2 text-[11px] font-medium ${statusColor}`}>
        {status.message}
      </p>
    </section>
  );
}
