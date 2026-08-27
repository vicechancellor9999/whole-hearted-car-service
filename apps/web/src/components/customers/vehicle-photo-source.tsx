"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Camera, FileImage, ScanLine, X } from "lucide-react";
import {
  captureVehicleDocumentFrame,
  documentCameraConstraints,
  selectVehicleDocumentImage,
} from "@/lib/customers/vehicle-document-camera";

export function VehiclePhotoSource({
  imageUrl,
  busy,
  onFile,
}: {
  readonly imageUrl: string | null;
  readonly busy: boolean;
  readonly onFile: (file: File | null) => void;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const acceptFiles = useCallback(
    (files: Iterable<File>) => {
      if (busy) return;
      const selection = selectVehicleDocumentImage(files);
      if ("error" in selection) {
        setCameraError(selection.error);
        return;
      }
      setCameraError(null);
      onFile(selection.file);
    },
    [busy, onFile],
  );

  const stopCamera = () => {
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
  };

  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);

  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      const pastedFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (pastedFiles.length === 0) return;
      event.preventDefault();
      acceptFiles(pastedFiles);
    };
    window.addEventListener("paste", pasteImage);
    return () => window.removeEventListener("paste", pasteImage);
  }, [acceptFiles]);

  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (busy || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const dragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragging(false);
  };

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFiles(Array.from(event.dataTransfer.files));
  };

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("当前浏览器没有检测到可用的高拍仪或摄像头，请改用“选择扫描图片”。");
      return;
    }
    stopCamera();
    setStarting(true);
    setCameraError(null);
    try {
      setStream(await navigator.mediaDevices.getUserMedia(documentCameraConstraints()));
    } catch {
      setCameraError("无法打开高拍仪。请确认设备已连接并允许浏览器使用摄像头，或改用“选择扫描图片”。");
    } finally {
      setStarting(false);
    }
  };

  const capture = async () => {
    if (!videoRef.current) return;
    setCameraError(null);
    try {
      acceptFiles([await captureVehicleDocumentFrame(videoRef.current)]);
      stopCamera();
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "高拍仪拍照失败，请重试");
    }
  };

  if (stream) {
    return (
      <div className="overflow-hidden rounded-xl border border-primary/35 bg-slate-950">
        <video ref={videoRef} autoPlay playsInline muted data-testid="form-vehicle-camera-preview" className="aspect-[4/3] w-full object-contain" />
        <div className="grid grid-cols-2 gap-2 bg-white p-2 dark:bg-slate-900">
          <button type="button" disabled={busy} onClick={() => void capture()} data-testid="form-vehicle-camera-capture" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-45"><Camera size={15} aria-hidden />拍照</button>
          <button type="button" onClick={stopCamera} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 text-xs font-bold text-ink-soft dark:text-slate-300"><X size={15} aria-hidden />关闭取景</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        data-testid="form-vehicle-image-dropzone"
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={dragLeave}
        onDrop={dropFiles}
      >
        {imageUrl ? (
          <div
            className={`overflow-hidden rounded-xl border bg-surface transition dark:bg-slate-900 ${dragging ? "border-primary ring-2 ring-primary/25" : "border-line"}`}
          >
            <img src={imageUrl} alt="待识别的车辆资料照片" className="aspect-[4/3] w-full object-contain" />
          </div>
        ) : (
          <div
            className={`flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed px-4 text-center transition ${dragging ? "border-primary bg-primary-50 ring-2 ring-primary/25 dark:bg-primary/20" : "border-primary/35 bg-primary-50/35 dark:bg-primary/10"}`}
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-primary shadow-sm dark:bg-slate-900"><ScanLine size={21} aria-hidden /></span>
            <strong className="mt-3 text-sm text-ink dark:text-slate-100">{dragging ? "松开即可添加图片" : "拖拽、粘贴或扫描图片"}</strong>
            <span className="mt-1 text-xs text-ink-soft dark:text-slate-400">支持 Command+V · 车辆登记证、检验合格证、清晰车牌</span>
          </div>
        )}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={busy || starting} onClick={() => void openCamera()} data-testid="form-vehicle-camera-open" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-bold text-white disabled:opacity-45"><Camera size={15} aria-hidden />{starting ? "正在打开…" : "打开高拍仪"}</button>
        <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-primary px-3 text-xs font-bold text-primary"><FileImage size={15} aria-hidden />选择扫描图片<input type="file" accept="image/jpeg,image/png" capture="environment" data-testid="form-vehicle-recognition-file" onChange={(event) => {
          acceptFiles(Array.from(event.target.files ?? []));
          event.currentTarget.value = "";
        }} className="sr-only" /></label>
      </div>
      {cameraError ? <p role="alert" data-testid="form-vehicle-camera-error" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-950/35 dark:text-amber-300">{cameraError}</p> : null}
    </div>
  );
}
