export function documentCameraConstraints(): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 2560 },
      height: { ideal: 1440 },
    },
  };
}

const VEHICLE_DOCUMENT_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const VEHICLE_DOCUMENT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export type VehicleDocumentImageSelection =
  | { readonly file: File }
  | { readonly error: string };

export function selectVehicleDocumentImage(files: Iterable<File>): VehicleDocumentImageSelection {
  const image = Array.from(files).find((file) => VEHICLE_DOCUMENT_IMAGE_TYPES.has(file.type));
  if (!image) return { error: "仅支持 JPEG 或 PNG 图片" };
  if (image.size > VEHICLE_DOCUMENT_MAX_IMAGE_BYTES) return { error: "图片必须小于 12 MB" };
  return { file: image };
}

const two = (value: number) => String(value).padStart(2, "0");

export function capturedVehiclePhotoName(now = new Date()): string {
  return `vehicle-scan-${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.jpg`;
}

export async function captureVehicleDocumentFrame(video: HTMLVideoElement): Promise<File> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("高拍仪画面尚未准备好，请稍后再拍");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法截取高拍仪画面");
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.94));
  if (!blob) throw new Error("高拍仪拍照失败，请重试");
  return new File([blob], capturedVehiclePhotoName(), { type: "image/jpeg" });
}
