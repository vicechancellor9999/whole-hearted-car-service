import { expect, test } from "@playwright/test";
import { quickInvoicePdfFileName } from "../../src/lib/orders/quick-invoice-pdf";

test("文件名带 -INV- 与语言后缀，只保留安全字符", () => {
  expect(quickInvoicePdfFileName("KGN-WH-2026081819451", "zh")).toBe("KGN-WH-2026081819451-INV-ZH.pdf");
  expect(quickInvoicePdfFileName("KGN-WH-INV-2026081819451", "zh")).toBe("KGN-WH-INV-2026081819451-ZH.pdf");
  expect(quickInvoicePdfFileName("KGN-WH-2026/08:18-19451", "en")).toBe("KGN-WH-2026-08-18-19451-INV-EN.pdf");
  expect(quickInvoicePdfFileName("KGN-WH-2026081819451", "bilingual")).toBe("KGN-WH-2026081819451-INV-BI.pdf");
});
