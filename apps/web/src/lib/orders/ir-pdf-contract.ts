import type { CompanyIdentity } from "../company-identity";
import type { FixedTotalChargeLine, UnitPricedChargeLine } from "../billing/quoted-charges";
import type { PdfLanguage } from "./pdf-shared";

export const IR_PDF_RENDERER_VERSION = "ir-a4-v1";
export type IrPdfLanguage = PdfLanguage;
export type IrPdfChargeLine = Omit<UnitPricedChargeLine, "sourceId"> | Omit<FixedTotalChargeLine, "sourceId">;

export interface IrPdfSource {
  readonly company: CompanyIdentity;
  readonly reportNo: string;
  readonly quotationNo: string;
  readonly generation: { readonly version: number; readonly generatedAt: string };
  readonly customer: { readonly nameZh: string; readonly nameEn: string | null; readonly phone: string };
  readonly vehicle: {
    readonly plate: string;
    readonly modelZh?: string;
    readonly modelEn?: string;
    readonly vin?: string;
  };
  readonly quotation: {
    readonly noteZh: string;
    readonly noteEn: string;
    readonly lines: ReadonlyArray<IrPdfChargeLine>;
  };
}
