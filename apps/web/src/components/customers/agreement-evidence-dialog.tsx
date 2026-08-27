"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { createSignedAgreementPdf } from "@/lib/customers/agreement-pdf";
import {
  createEvidenceAssetFromFile,
  EvidenceAssetError,
  MAX_EVIDENCE_ASSET_BYTES,
} from "@/lib/customers/evidence-assets";
import type { CustomerRecord } from "@/lib/customers/types";
import { Dialog } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/ui/signature-pad";
import { CURRENT_CUSTOMER_AGREEMENT_VERSION } from "./detail-shared";

interface AgreementEvidenceDialogProps {
  customer: CustomerRecord;
  boundSessionKey: string;
  boundActorId: string;
  onClose: () => void;
  onChanged: (customer: CustomerRecord) => void;
  returnFocusElement?: HTMLElement | null;
}

function mutationId(): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `customer-ui-agreement-sign-${suffix}`;
}

function readableError(error: unknown): string {
  if (error instanceof EvidenceAssetError) return "协议证据文件无效，请检查文件类型、内容和大小后重试。";
  return error instanceof Error && error.message ? error.message : "协议登记失败，请重试";
}

function fileFromDataUrl(dataUrl: string, fileName: string): File {
  const [header, encoded] = dataUrl.split(",");
  const mimeType = /^data:([^;]+);base64$/.exec(header)?.[1];
  if (!encoded || mimeType !== "image/png") throw new EvidenceAssetError();
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new File([bytes], fileName, { type: mimeType });
}

function displayName(customer: CustomerRecord): string {
  return customer.nameSourceValue ?? customer.organizationName ?? customer.id;
}

export function AgreementEvidenceDialog({
  customer,
  boundSessionKey,
  boundActorId,
  onClose,
  onChanged,
  returnFocusElement,
}: AgreementEvidenceDialogProps) {
  const [medium, setMedium] = useState<"electronic" | "paper">("electronic");
  const [signedBy, setSignedBy] = useState(displayName(customer));
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [physicalRecordNumber, setPhysicalRecordNumber] = useState("");
  const [physicalStorageLocation, setPhysicalStorageLocation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signMutationId = useRef(mutationId());

  const assertBoundSession = () => {
    const raw = window.localStorage.getItem("wh_session");
    let key = "invalid";
    try {
      const session = raw ? JSON.parse(raw) as { identity?: { id?: unknown; role?: unknown } } : null;
      key = raw ? `${String(session?.identity?.id ?? "invalid")}:${String(session?.identity?.role ?? "invalid")}` : "anonymous";
    } catch {
      key = "invalid";
    }
    if (key !== boundSessionKey) throw new Error("会话已变化，请关闭对话框后重新操作");
  };

  const sign = async () => {
    if (!signedBy.trim()) {
      setError("请填写签署人姓名");
      return;
    }
    if (medium === "electronic" && !signatureDataUrl) {
      setError("请先在签名板完成电子签名");
      return;
    }
    if (medium === "paper" && paperFile) {
      const accepted = ["image/jpeg", "image/png", "application/pdf"].includes(paperFile.type);
      if (!accepted) {
        setError("纸质协议扫描件只接受 JPEG、PNG 或 PDF");
        return;
      }
      if (paperFile.size > MAX_EVIDENCE_ASSET_BYTES) {
        setError("纸质协议扫描件不得超过 512 KB");
        return;
      }
    }
    if (medium === "paper"
      && Boolean(physicalRecordNumber.trim()) !== Boolean(physicalStorageLocation.trim())) {
      setError("纸质档案号和存放位置必须同时填写或同时留空");
      return;
    }
    if (medium === "paper" && !paperFile
      && (!physicalRecordNumber.trim() || !physicalStorageLocation.trim())) {
      setError("未上传扫描件时，必须同时填写纸质档案号和存放位置");
      return;
    }

    setPending(true);
    setError(null);
    try {
      assertBoundSession();
      let updated: CustomerRecord;
      if (medium === "electronic") {
        const signingPreview = await api.customers.prepareAgreementSigning(customer.id, {
          version: CURRENT_CUSTOMER_AGREEMENT_VERSION,
          signedBy: signedBy.trim(),
        });
        assertBoundSession();
        const evidenceCreatedAt = signingPreview.signedAt;
        const signatureAsset = await createEvidenceAssetFromFile(
          fileFromDataUrl(signatureDataUrl!, `agreement-${CURRENT_CUSTOMER_AGREEMENT_VERSION}-signature.png`),
          boundActorId,
          () => evidenceCreatedAt,
        );
        assertBoundSession();
        const signedDocumentAsset = await createSignedAgreementPdf({
          customerDisplayName: displayName(customer),
          agreementVersion: CURRENT_CUSTOMER_AGREEMENT_VERSION,
          signedBy: signedBy.trim(),
          signedAt: evidenceCreatedAt,
          signatureAsset,
          actorId: boundActorId,
        });
        assertBoundSession();
        updated = await api.customers.signAgreement(customer.id, {
          medium: "electronic",
          version: CURRENT_CUSTOMER_AGREEMENT_VERSION,
          signedBy: signedBy.trim(),
          signatureAsset,
          signedDocumentAsset,
          signingToken: signingPreview.token,
          clientMutationId: signMutationId.current,
        });
      } else {
        const evidenceCreatedAt = customer.updatedAt;
        const paperScanAsset = paperFile
          ? await createEvidenceAssetFromFile(paperFile, boundActorId, () => evidenceCreatedAt)
          : undefined;
        assertBoundSession();
        updated = await api.customers.signAgreement(customer.id, {
          medium: "paper",
          version: CURRENT_CUSTOMER_AGREEMENT_VERSION,
          signedBy: signedBy.trim(),
          ...(paperScanAsset ? { paperScanAsset } : {}),
          ...(physicalRecordNumber.trim() ? { physicalRecordNumber: physicalRecordNumber.trim() } : {}),
          ...(physicalStorageLocation.trim() ? { physicalStorageLocation: physicalStorageLocation.trim() } : {}),
          clientMutationId: signMutationId.current,
        });
      }
      onChanged(updated);
      onClose();
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      title="登记客户服务协议"
      onClose={onClose}
      dataTestId="agreement-evidence-dialog"
      closeLabel="关闭协议登记"
      returnFocusElement={returnFocusElement}
      className="w-[min(680px,calc(100vw-2rem))]"
    >
      <div className="space-y-4 p-5">
        <fieldset>
          <legend className="text-xs font-semibold text-ink dark:text-slate-200">签署形式</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["electronic", "paper"] as const).map((value) => (
              <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${medium === value ? "border-primary bg-primary-50 text-primary-800 dark:bg-primary/10 dark:text-primary-200" : "border-line text-ink dark:border-slate-600 dark:text-slate-200"}`}>
                <input type="radio" name="agreement-medium" value={value} checked={medium === value} onChange={() => { setMedium(value); setError(null); }} />
                {value === "electronic" ? "电子版" : "纸质版"}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-ink dark:text-slate-200">
            协议版本
            <input value={CURRENT_CUSTOMER_AGREEMENT_VERSION} readOnly className="mt-1 min-h-10 w-full rounded-xl border border-line bg-slate-100 px-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200" />
          </label>
          <label className="text-xs font-semibold text-ink dark:text-slate-200">
            签署人
            <input value={signedBy} onChange={(event) => setSignedBy(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
          </label>
        </div>

        {medium === "electronic" ? (
          <SignaturePad
            label="客户电子签名"
            testId="agreement-signature-pad"
            onChange={(_signed, dataUrl) => setSignatureDataUrl(dataUrl)}
          />
        ) : (
          <div className="space-y-3 rounded-xl border border-line p-4 dark:border-slate-600">
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">
              纸质协议扫描件（JPEG／PNG／PDF，最大 512 KB）
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                onChange={(event) => setPaperFile(event.target.files?.[0] ?? null)}
                className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-white p-2 text-xs dark:border-slate-600 dark:bg-slate-700"
              />
            </label>
            <p className="text-[11px] leading-4 text-ink-soft dark:text-slate-400">如没有扫描件，必须用下面两项说明纸质原件在哪里调取。</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-ink dark:text-slate-200">
                纸质档案号
                <input value={physicalRecordNumber} onChange={(event) => setPhysicalRecordNumber(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
              </label>
              <label className="text-xs font-semibold text-ink dark:text-slate-200">
                存放位置
                <input value={physicalStorageLocation} onChange={(event) => setPhysicalStorageLocation(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-line bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100" />
              </label>
            </div>
          </div>
        )}

        {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p> : null}
        <button type="button" disabled={pending} onClick={() => void sign()} className="min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:opacity-50">
          {pending ? "正在登记…" : `确认登记${medium === "electronic" ? "电子版" : "纸质版"}协议`}
        </button>
      </div>
    </Dialog>
  );
}
