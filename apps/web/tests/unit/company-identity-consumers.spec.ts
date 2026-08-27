import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { WHOLE_HEARTED_COMPANY_IDENTITY } from "../../src/lib/company-identity";

test("active BO print consumer uses one content-equivalent company identity boundary without copied literals", () => {
  expect(WHOLE_HEARTED_COMPANY_IDENTITY).toEqual({
    legalName: "Whole Hearted Car Service Limited",
    logoUrl: "/logo-icon.png",
    address: "16 Ferry Pen, Kingston, Jamaica",
    footerAddress: "16 Ferry Pen, Kingston",
    whatsapp: ["1 876-899-3924", "1 876-333-3322"],
    contactLine: "WhatsApp: 1 876-899-3924 / 1 876-333-3322",
    trn: "003650332",
  });

  for (const relativePath of ["src/components/orders/quick-order-print.tsx"]) {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    expect(source).toContain("WHOLE_HEARTED_COMPANY_IDENTITY");
    expect(source).not.toContain('src="/logo-icon.png"');
    expect(source).not.toContain(">Whole Hearted Car Service Limited<");
    expect(source).not.toContain(">16 Ferry Pen, Kingston, Jamaica<");
    expect(source).not.toContain(">WhatsApp: 1 876-899-3924 / 1 876-333-3322<");
    expect(source).not.toContain(">TRN: 003650332<");
    expect(source).not.toContain("Whole Hearted Car Service Limited · 16 Ferry Pen, Kingston ·");
  }
});
