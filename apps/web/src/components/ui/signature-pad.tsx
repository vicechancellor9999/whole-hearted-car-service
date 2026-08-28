"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import type { SignatureStrokePoint } from "@/lib/billing/discount-approval";

interface SignaturePadProps {
  label: string;
  onChange: (
    signed: boolean,
    dataUrl: string | null,
    rawStrokes: ReadonlyArray<ReadonlyArray<SignatureStrokePoint>>,
  ) => void;
  testId?: string;
}

/** 简单稳定的内容哈希（djb2），用于把签名图像绑定为证据哈希。 */
export function hashSignatureData(dataUrl: string): string {
  let hash = 5381;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash = ((hash << 5) + hash + dataUrl.charCodeAt(index)) >>> 0;
  }
  return `sig-djb2-${hash.toString(16)}-${dataUrl.length}`;
}

/** 现场手写签名板：鼠标与触屏均可书写，笔迹即签名证据。 */
export function SignaturePad({ label, onChange, testId = "signature-pad" }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const strokesRef = useRef<SignatureStrokePoint[][]>([]);
  const [hasInk, setHasInk] = useState(false);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#1e293b";
  }, []);

  useEffect(() => {
    setupCanvas();
  }, [setupCanvas]);

  const emitChange = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (hasInkRef.current) {
      onChange(true, canvas.toDataURL("image/png"), structuredClone(strokesRef.current));
    } else {
      onChange(false, null, []);
    }
  }, [onChange]);

  const pointFrom = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, time: event.timeStamp };
  }, []);

  const handleDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const context = event.currentTarget.getContext("2d");
      if (!context) return;
      const point = pointFrom(event);
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      strokesRef.current.push([point]);
      drawingRef.current = true;
      hasInkRef.current = true;
      setHasInk(true);
    },
    [pointFrom],
  );

  const handleMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const context = event.currentTarget.getContext("2d");
      if (!context) return;
      const point = pointFrom(event);
      strokesRef.current.at(-1)?.push(point);
      context.lineTo(point.x, point.y);
      context.stroke();
    },
    [pointFrom],
  );

  const handleUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    emitChange();
  }, [emitChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasInkRef.current = false;
    strokesRef.current = [];
    setHasInk(false);
    onChange(false, null, []);
  }, [onChange]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">{label}</span>
        <button
          type="button"
          data-testid={`${testId}-clear`}
          onClick={clear}
          disabled={!hasInk}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-ink-soft hover:bg-layer-2 disabled:opacity-40"
        >
          <Eraser size={12} />
          清除重签
        </button>
      </div>
      <div className="relative mt-1 overflow-hidden rounded-lg border border-dashed border-line-strong bg-card">
        <canvas
          data-testid={testId}
          ref={canvasRef}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerLeave={handleUp}
          className="h-32 w-full cursor-crosshair touch-none"
          aria-label={label}
        />
        {!hasInk ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
            <PenLine size={13} />
            在此处手写签名
          </div>
        ) : null}
      </div>
    </div>
  );
}
