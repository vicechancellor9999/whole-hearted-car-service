/**
 * One customer-document identity boundary.  Customer-facing BO, Invoice and
 * Inspection Report renderers consume these exact values instead of keeping
 * divergent copies of the legal identity in each document.
 */
export interface CompanyIdentity {
  readonly legalName: string;
  readonly logoUrl: string;
  readonly address: string;
  readonly footerAddress: string;
  readonly whatsapp: ReadonlyArray<string>;
  readonly contactLine: string;
  readonly trn: string;
}

export const WHOLE_HEARTED_COMPANY_IDENTITY: CompanyIdentity = Object.freeze({
  legalName: "Whole Hearted Car Service Limited",
  logoUrl: "/logo-icon.png",
  address: "16 Ferry Pen, Kingston, Jamaica",
  footerAddress: "16 Ferry Pen, Kingston",
  whatsapp: Object.freeze(["1 876-899-3924", "1 876-333-3322"]),
  contactLine: "WhatsApp: 1 876-899-3924 / 1 876-333-3322",
  trn: "003650332",
});
