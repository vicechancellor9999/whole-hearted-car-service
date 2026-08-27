"use client";

import { useEffect, useState } from "react";
import { Download, FileWarning, ZoomIn, ZoomOut } from "lucide-react";
import { validateEvidenceAsset } from "@/lib/customers/evidence-assets";
import type { EvidenceAsset } from "@/lib/customers/verification-types";
import { Dialog } from "@/components/ui/dialog";

interface EvidenceAssetViewerProps {
  asset: EvidenceAsset | null;
  title?: string;
  onClose: () => void;
  returnFocusElement?: HTMLElement | null;
}

function validationMessage(asset: EvidenceAsset | null): string | null {
  if (!asset) return null;
  try {
    validateEvidenceAsset(asset);
    return null;
  } catch {
    return "证据文件校验失败，已拒绝打开。请重新上传有效文件。";
  }
}

export function EvidenceAssetViewer({
  asset,
  title = "查看证据",
  onClose,
  returnFocusElement,
}: EvidenceAssetViewerProps) {
  const [zoom, setZoom] = useState(1);
  const error = validationMessage(asset);
  const synthetic = asset?.url.startsWith("/seed-evidence/") ?? false;
  const [renderUrl, setRenderUrl] = useState<string | null>(null);

  useEffect(() => {
    setZoom(1);
    setRenderUrl(null);
    if (!asset || error) return;
    if (!asset.url.startsWith("data:")) {
      setRenderUrl(asset.url);
      return;
    }
    const base64 = asset.url.split(",")[1];
    if (!base64) return;
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType }));
    setRenderUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [asset, error]);

  return (
    <Dialog
      open={asset !== null}
      title={title}
      onClose={onClose}
      closeLabel="关闭证据"
      dataTestId="evidence-asset-viewer"
      returnFocusElement={returnFocusElement}
      className="w-[min(1040px,calc(100vw-2rem))]"
    >
      <div className="p-4 sm:p-5">
        {error || !asset ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            <FileWarning size={18} className="mt-0.5 shrink-0" aria-hidden />
            {error ?? "没有可查看的证据文件。"}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="break-all text-sm font-bold text-ink dark:text-slate-100">{asset.fileName}</p>
                <p className="mt-0.5 text-[11px] text-ink-soft dark:text-slate-400">
                  {synthetic ? "合成演示资料 · " : ""}{asset.mimeType} · {Math.ceil(asset.sizeBytes / 1024)} KB
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {asset.mimeType !== "application/pdf" ? (
                  <>
                    <button
                      type="button"
                      aria-label="缩小证据图片"
                      disabled={zoom <= 0.5}
                      onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-line disabled:opacity-40 dark:border-slate-600"
                    >
                      <ZoomOut size={15} aria-hidden />
                    </button>
                    <span className="min-w-12 text-center text-xs font-semibold tabular-nums text-ink-soft dark:text-slate-300">{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      aria-label="放大证据图片"
                      disabled={zoom >= 2}
                      onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-line disabled:opacity-40 dark:border-slate-600"
                    >
                      <ZoomIn size={15} aria-hidden />
                    </button>
                  </>
                ) : null}
                <a
                  href={renderUrl ?? undefined}
                  download={asset.fileName}
                  aria-disabled={renderUrl === null}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-primary-200 px-3 text-xs font-bold text-primary hover:bg-primary-50 dark:border-primary-500/50 dark:text-primary-300"
                >
                  <Download size={14} aria-hidden />下载证据
                </a>
              </div>
            </div>

            {!renderUrl ? (
              <p role="status" className="rounded-xl bg-surface p-5 text-center text-xs text-ink-soft dark:bg-slate-900/50 dark:text-slate-400">正在准备证据预览…</p>
            ) : asset.mimeType === "application/pdf" ? (
              <iframe
                data-testid="evidence-pdf-frame"
                title={`证据文件 ${asset.fileName}`}
                src={renderUrl}
                className="h-[min(68vh,760px)] w-full rounded-xl border border-line bg-white dark:border-slate-600"
              />
            ) : (
              <div className="max-h-[68vh] overflow-auto rounded-xl border border-line bg-slate-100 p-3 dark:border-slate-600 dark:bg-slate-950">
                {/* Evidence may be a runtime data URL, so Next/Image cannot safely know its dimensions. */}
                <img
                  src={renderUrl}
                  alt={`证据文件 ${asset.fileName}`}
                  style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                  className="mx-auto block h-auto max-w-full transition-transform motion-reduce:transition-none"
                />
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
