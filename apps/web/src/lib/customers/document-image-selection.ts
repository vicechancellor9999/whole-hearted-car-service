const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_BYTES = 12 * 1024 * 1024;

export type DocumentImageSelection = { file: File } | { error: string };

export function selectSingleDocumentImage(files: Iterable<File>): DocumentImageSelection {
  const supported = Array.from(files).filter((file) => SUPPORTED_TYPES.has(file.type));
  if (supported.length > 1) return { error: "一次只能添加一张驾驶证正面" };
  if (supported.length === 0) return { error: "仅支持 JPEG 或 PNG 图片" };
  const file = supported[0];
  if (file.size <= 0 || file.size > MAX_BYTES) return { error: "图片必须小于 12 MB" };
  return { file };
}

export function isEditablePasteTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown };
  const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toUpperCase() : "";
  return candidate.isContentEditable === true || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}
