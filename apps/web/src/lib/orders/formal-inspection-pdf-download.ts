import { buildFormalInspectionDocument, type InspectionDocumentLanguage } from "./formal-inspection-document";
import type { FormalInspectionReportDetail } from "../api/formal-inspections";

export async function createFormalInspectionPdf(detail: FormalInspectionReportDetail, language: InspectionDocumentLanguage, signal: AbortSignal): Promise<Blob> {
  const model = buildFormalInspectionDocument(detail, language);
  const assetSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const readAsset = async (url: string) => {
    const response = await fetch(url, { signal: assetSignal });
    if (!response.ok) throw new Error(`PDF 资源加载失败 (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const [{ renderFormalInspectionPdf }, fontBytes, logoBytes] = await Promise.all([
    import("./formal-inspection-pdf"), readAsset("/fonts/NotoSansSC-Regular-wh.ttf"), readAsset(model.company.logoUrl),
  ]);
  signal.throwIfAborted();
  const bytes = await renderFormalInspectionPdf(model, { fontBytes, logoBytes });
  signal.throwIfAborted();
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
