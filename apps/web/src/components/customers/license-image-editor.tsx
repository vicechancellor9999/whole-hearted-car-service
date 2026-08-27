"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { RefreshCcw, RotateCcw, RotateCw } from "lucide-react";
import type { LicenseImageTransform, NormalizedRect } from "@/lib/customers/license-extraction/image-input";

type CropEdge = "left" | "top" | "right" | "bottom";
type CropCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const MIN_CROP = 0.05;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

function withEdge(crop: NormalizedRect, edge: CropEdge, rawValue: number): NormalizedRect {
  const value = clamp(rawValue, 0, 1);
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  if (edge === "left") {
    const left = Math.min(value, right - MIN_CROP);
    return { ...crop, x: left, width: right - left };
  }
  if (edge === "top") {
    const top = Math.min(value, bottom - MIN_CROP);
    return { ...crop, y: top, height: bottom - top };
  }
  if (edge === "right") {
    const nextRight = Math.max(value, crop.x + MIN_CROP);
    return { ...crop, width: nextRight - crop.x };
  }
  const nextBottom = Math.max(value, crop.y + MIN_CROP);
  return { ...crop, height: nextBottom - crop.y };
}

function edgeValue(crop: NormalizedRect, edge: CropEdge): number {
  if (edge === "left") return crop.x;
  if (edge === "top") return crop.y;
  if (edge === "right") return crop.x + crop.width;
  return crop.y + crop.height;
}

function rotate(value: LicenseImageTransform["rotation"], direction: -1 | 1): LicenseImageTransform["rotation"] {
  return ((value + direction * 90 + 360) % 360) as LicenseImageTransform["rotation"];
}

export function LicenseImageEditor({
  imageUrl,
  transform,
  disabled = false,
  onChange,
}: {
  imageUrl: string;
  transform: LicenseImageTransform;
  disabled?: boolean;
  onChange: (transform: LicenseImageTransform) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);

  const updateEdge = (edge: CropEdge, value: number) => {
    onChange({ ...transform, crop: withEdge(transform.crop, edge, value) });
  };

  const dragCorner = (corner: CropCorner, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || !stageRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = stageRef.current.getBoundingClientRect();
    const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    let crop = transform.crop;
    if (corner.includes("left")) crop = withEdge(crop, "left", x);
    if (corner.includes("right")) crop = withEdge(crop, "right", x);
    if (corner.includes("top")) crop = withEdge(crop, "top", y);
    if (corner.includes("bottom")) crop = withEdge(crop, "bottom", y);
    onChange({ ...transform, crop });
  };

  const controls: Array<{ edge: CropEdge; label: string }> = [
    { edge: "left", label: "左边界" },
    { edge: "top", label: "上边界" },
    { edge: "right", label: "右边界" },
    { edge: "bottom", label: "下边界" },
  ];

  return (
    <div data-testid="onboarding-license-editor" className="grid min-w-0 gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(260px,0.8fr)]">
      <div className="min-w-0">
        <div
          ref={stageRef}
          className="relative aspect-[1.58/1] min-w-0 overflow-hidden rounded-2xl border border-dashed border-primary/35 bg-slate-100 dark:bg-slate-950"
        >
          <img
            src={imageUrl}
            alt="驾驶证正面预览"
            className="h-full w-full object-contain transition-transform motion-reduce:transition-none"
            style={{ transform: `rotate(${transform.rotation}deg)` }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute border-2 border-primary bg-primary/10 shadow-[0_0_0_999px_rgba(15,23,42,0.34)]"
            style={{
              left: `${transform.crop.x * 100}%`,
              top: `${transform.crop.y * 100}%`,
              width: `${transform.crop.width * 100}%`,
              height: `${transform.crop.height * 100}%`,
            }}
          />
          {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((corner) => (
            <button
              key={corner}
              type="button"
              aria-label={`拖动裁切${corner}`}
              disabled={disabled}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) dragCorner(corner, event);
              }}
              onPointerDown={(event) => dragCorner(corner, event)}
              className="absolute z-10 h-5 w-5 touch-none rounded-full border-2 border-white bg-primary shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40"
              style={{
                left: `${(corner.includes("left") ? transform.crop.x : transform.crop.x + transform.crop.width) * 100}%`,
                top: `${(corner.includes("top") ? transform.crop.y : transform.crop.y + transform.crop.height) * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={disabled} onClick={() => onChange({ ...transform, rotation: rotate(transform.rotation, -1) })} data-testid="onboarding-license-rotate-left" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-soft disabled:opacity-40 dark:bg-slate-900 dark:text-slate-300"><RotateCcw size={14} aria-hidden />左转</button>
          <button type="button" disabled={disabled} onClick={() => onChange({ ...transform, rotation: rotate(transform.rotation, 1) })} data-testid="onboarding-license-rotate-right" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-soft disabled:opacity-40 dark:bg-slate-900 dark:text-slate-300"><RotateCw size={14} aria-hidden />右转</button>
          <button type="button" disabled={disabled} onClick={() => onChange({ rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } })} data-testid="onboarding-license-reset" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold text-ink-soft disabled:opacity-40 dark:bg-slate-900 dark:text-slate-300"><RefreshCcw size={14} aria-hidden />重置</button>
        </div>
      </div>
      <fieldset className="min-w-0 rounded-2xl bg-surface p-3 dark:bg-slate-900/60">
        <legend className="px-1 text-xs font-bold text-ink dark:text-slate-100">精确裁切边界</legend>
        <p className="mb-3 px-1 text-[11px] leading-4 text-ink-soft dark:text-slate-400">拖动图片四角，或使用下列键盘可调控件。</p>
        <div className="space-y-3">
          {controls.map(({ edge, label }) => {
            const value = Number(edgeValue(transform.crop, edge).toFixed(2));
            return (
              <label key={edge} className="grid grid-cols-[1fr_4.5rem] items-center gap-2 text-[11px] font-semibold text-ink-soft dark:text-slate-300">
                <span className="col-span-2">{label}</span>
                <input type="range" min="0" max="1" step="0.01" value={value} disabled={disabled} onChange={(event) => updateEdge(edge, Number(event.target.value))} data-testid={`onboarding-crop-${edge}-range`} className="min-w-0 accent-primary" />
                <input type="number" min="0" max="1" step="0.01" value={value} disabled={disabled} onChange={(event) => updateEdge(edge, Number(event.target.value))} data-testid={`onboarding-crop-${edge}-number`} className="min-h-9 w-full rounded-lg border border-line bg-white px-2 text-xs text-ink dark:bg-slate-800 dark:text-slate-100" />
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
