import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const signaturePath = path.join(
  repositoryRoot,
  "public/seed-evidence/alicia-bennett-agreement-v1.3-signature.png",
);
const outputPath = path.join(
  repositoryRoot,
  "public/seed-evidence/alicia-bennett-agreement-v1.3-signed.pdf",
);

export const CUSTOMER_SEED_AGREEMENT = Object.freeze({
  agreementVersion: "1.3",
  customerName: "Alicia Bennett",
  signedAt: "2026-05-16T10:00:00.000Z",
  recordedBy: "uat-seed",
});

function fixedDate() {
  return new Date(CUSTOMER_SEED_AGREEMENT.signedAt);
}

export async function generateCustomerSeedAgreementPdf({
  signatureBytes,
  outputFile = outputPath,
} = {}) {
  const resolvedSignatureBytes = signatureBytes ?? await readFile(signaturePath);
  const document = await PDFDocument.create({ updateMetadata: false });
  document.setTitle(`Synthetic Customer Service Agreement ${CUSTOMER_SEED_AGREEMENT.agreementVersion}`);
  document.setAuthor("Whole Hearted Car Service UAT");
  document.setSubject("Synthetic demonstration evidence; no legal effect");
  document.setKeywords(["SYNTHETIC DEMO", "customer agreement", "UAT"]);
  document.setProducer("Whole Hearted Car Service deterministic UAT generator");
  document.setCreator("Whole Hearted Car Service deterministic UAT generator");
  document.setCreationDate(fixedDate());
  document.setModificationDate(fixedDate());

  const page = document.addPage([612, 792]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const signature = await document.embedPng(resolvedSignatureBytes);

  page.drawRectangle({ x: 34, y: 34, width: 544, height: 724, borderWidth: 2, borderColor: rgb(0.13, 0.23, 0.39) });
  page.drawText("CUSTOMER SERVICE AGREEMENT", { x: 96, y: 704, size: 23, font: bold, color: rgb(0.13, 0.23, 0.39) });
  page.drawText(`VERSION ${CUSTOMER_SEED_AGREEMENT.agreementVersion} - SYNTHETIC TRAINING DEMO`, {
    x: 118, y: 670, size: 12, font: bold, color: rgb(0.13, 0.23, 0.39),
  });

  const lines = [
    "This fictional document records a demonstration customer-service agreement.",
    "It exists only to test evidence retrieval and has no legal effect.",
    "The service centre will record requested work clearly, provide available estimates,",
    "and preserve customer acknowledgements as an auditable demonstration record.",
  ];
  lines.forEach((line, index) => page.drawText(line, {
    x: 72, y: 618 - index * 24, size: 11, font: regular, color: rgb(0.08, 0.1, 0.14),
  }));

  page.drawText("CUSTOMER", { x: 72, y: 470, size: 10, font: bold, color: rgb(0.13, 0.23, 0.39) });
  page.drawText(CUSTOMER_SEED_AGREEMENT.customerName, { x: 72, y: 446, size: 16, font: bold });
  page.drawText("SIGNED AT", { x: 72, y: 408, size: 10, font: bold, color: rgb(0.13, 0.23, 0.39) });
  page.drawText(CUSTOMER_SEED_AGREEMENT.signedAt, { x: 72, y: 386, size: 11, font: regular });

  page.drawImage(signature, { x: 112, y: 122, width: 388, height: 258 });
  page.drawText("SYNTHETIC DEMO", {
    x: 70, y: 355, size: 53, font: bold, rotate: degrees(32), color: rgb(0.56, 0.57, 0.58), opacity: 0.35,
  });
  page.drawText("NOT A REAL AGREEMENT - NO LEGAL EFFECT", {
    x: 109, y: 74, size: 13, font: bold, color: rgb(0.67, 0.1, 0.08),
  });

  const bytes = await document.save({
    addDefaultPage: false,
    useObjectStreams: false,
    updateFieldAppearances: false,
  });
  if (outputFile) await writeFile(outputFile, bytes);
  return bytes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requestedOutput = process.argv[2] ? path.resolve(process.argv[2]) : outputPath;
  await generateCustomerSeedAgreementPdf({ outputFile: requestedOutput });
}
