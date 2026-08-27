export interface QuotationVersion {
  readonly id: string;
  readonly version: number;
  readonly quotationItemIds: ReadonlyArray<string>;
  readonly createdAt: string;
}

/**
 * The pre-v8 Quotation shape is retained as an exact, read-only archive.  It is
 * deliberately not the writable Quotation contract used by the current IR.
 */
export interface LegacyQuotationArchive {
  readonly id: string;
  readonly quotationNo: string;
  readonly inspectionReportId: string;
  readonly versions: ReadonlyArray<QuotationVersion>;
  readonly [legacyField: string]: unknown;
}

export const DEFAULT_QUOTATION_NOTE_ZH = "本报价仅涵盖当前阶段；本阶段完成（如拆解）后，后续维修方案与费用将另行出具检查报告与报价。";
export const DEFAULT_QUOTATION_NOTE_EN = "This quotation covers the current stage only. After this stage is completed, further repair plans and costs will be issued in a new inspection report and quotation.";

export type GeneratedCustomerFileLanguage = "zh" | "en" | "bilingual";

export interface GeneratedCustomerFileAttachmentMetadata {
  readonly id: string;
  readonly language: GeneratedCustomerFileLanguage;
  readonly fileName: string;
  readonly byteLength: number;
  readonly mediaType: "application/pdf";
}

export interface GeneratedCustomerFileBundleMetadata {
  readonly id: string;
  readonly reportId: string;
  readonly quotationId: string;
  readonly generation: number;
  readonly generatedAt: string;
  readonly contentRevision: number;
  readonly rendererVersion: string;
  readonly attachments: ReadonlyArray<GeneratedCustomerFileAttachmentMetadata>;
}

/** Quotation has a distinct identifier and independently versioned contents. */
export interface Quotation {
  readonly id: string;
  readonly quotationNo: string;
  readonly inspectionReportId: string;
  readonly noteZh: string;
  readonly noteEn: string;
  readonly versions: ReadonlyArray<QuotationVersion>;
}

/** One continuously editable Quotation. Generated V numbers are counters only. */
export interface CurrentQuotation {
  readonly id: string;
  readonly quotationNo: string;
  readonly inspectionReportId: string;
  readonly lineIds: ReadonlyArray<string>;
  /** Read-only legacy category adjustments that still reduce receivable until manually reallocated. */
  readonly legacyReceivableAdjustmentIds: ReadonlyArray<string>;
  readonly noteZh: string;
  readonly noteEn: string;
  /** Monotonic customer-file content token; unrelated canonical writes never change it. */
  readonly contentRevision: number;
  readonly generationCounter: number;
  readonly lastGeneratedAt: string | null;
  /** Compatibility field whose value is now explicitly the Quotation content token. */
  readonly generatedFromRevision: number | null;
  readonly activeGeneratedBundle: GeneratedCustomerFileBundleMetadata | null;
}
