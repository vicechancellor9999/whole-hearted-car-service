"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Eye } from "lucide-react";
import type { QuickOrderFinancialStatement } from "@/lib/billing/quick-order-financial-statement";
import {
  buildQuickInvoicePdf,
  createQuickInvoicePdfGenerationCache,
  quickInvoicePdfFileName,
  type QuickInvoicePdfCustomer,
  type QuickInvoicePdfLanguage,
  type QuickInvoicePdfSource,
  type QuickInvoicePdfVehicle,
} from "@/lib/orders/quick-invoice-pdf";
import { PDF_FONT_URL } from "@/lib/orders/pdf-shared";
import { PdfCanvasPreview } from "./pdf-canvas-preview";

type QuickInvoicePdfAssets = Readonly<{
  fontBytes: Uint8Array;
  logoBytes: Uint8Array;
}>;

let assetsPromise: Promise<QuickInvoicePdfAssets> | null = null;

function fetchPdfAsset(path: string, label: string): Promise<Uint8Array> {
  return fetch(path).then(async (response) => {
    if (!response.ok) throw new Error(`${label}读取失败（${response.status}）`);
    return new Uint8Array(await response.arrayBuffer());
  });
}

function loadQuickInvoicePdfAssets(): Promise<QuickInvoicePdfAssets> {
  if (assetsPromise) return assetsPromise;
  const request = Promise.all([
    fetchPdfAsset(PDF_FONT_URL, "PDF 字体"),
    fetchPdfAsset("/logo-icon.png", "公司 Logo"),
  ]).then(([fontBytes, logoBytes]) => ({ fontBytes, logoBytes }));
  assetsPromise = request;
  void request.catch(() => {
    if (assetsPromise === request) assetsPromise = null;
  });
  return request;
}

export function QuickInvoicePdfSection({
  statement,
  customer,
  vehicle,
}: {
  statement: QuickOrderFinancialStatement;
  customer: QuickInvoicePdfCustomer;
  vehicle: QuickInvoicePdfVehicle;
}) {
  const searchParams = useSearchParams();
  const autoPreview = useRef(false);
  const requestGenerationRef = useRef(0);
  const generationCacheRef = useRef<ReturnType<typeof createQuickInvoicePdfGenerationCache> | null>(null);
  if (generationCacheRef.current === null) {
    generationCacheRef.current = createQuickInvoicePdfGenerationCache(buildQuickInvoicePdf);
  }
  const generationCache = generationCacheRef.current;
  const [language, setLanguage] = useState<QuickInvoicePdfLanguage>("zh");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const source = useMemo<QuickInvoicePdfSource>(() => ({
    contract: "quick_invoice_pdf_source_v1",
    statement,
    customer: {
      id: customer.id,
      nameZh: customer.nameZh,
      nameEn: customer.nameEn,
      organizationName: customer.organizationName,
      phone: customer.phone,
    },
    vehicle: {
      id: vehicle.id,
      plate: vehicle.plate,
      model: vehicle.model,
      modelZh: vehicle.modelZh,
      vin: vehicle.vin,
    },
  }), [customer, statement, vehicle]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    generationCache.invalidate();
    setBusy(false);
    setMessage(null);
    setPreviewBytes(null);
    return () => { generationCache.invalidate(); requestGenerationRef.current += 1; };
  }, [generationCache, language, source]);

  const generate = useCallback(async (): Promise<Uint8Array | null> => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setBusy(true);
    setMessage(null);
    try {
      const assets = await loadQuickInvoicePdfAssets();
      if (requestGenerationRef.current !== generation) return null;
      return await generationCache.load(source, {
        language,
        fontBytes: assets.fontBytes,
        logoBytes: assets.logoBytes,
      });
    } catch (caught) {
      if (requestGenerationRef.current === generation) {
        setMessage(caught instanceof Error ? caught.message : "PDF 生成失败");
      }
      return null;
    } finally {
      if (requestGenerationRef.current === generation) setBusy(false);
    }
  }, [generationCache, language, source]);

  const preview = useCallback(async () => {
    const bytes = await generate();
    if (!bytes) return;
    setPreviewBytes(bytes);
    setMessage("预览已生成；如需留档请点“下载 PDF”。");
  }, [generate]);

  useEffect(() => {
    if (searchParams.get("invoice-preview") === "1" && !autoPreview.current) {
      autoPreview.current = true;
      void preview();
    }
  }, [preview, searchParams]);

  const download = useCallback(async () => {
    const bytes = await generate();
    if (!bytes) return;
    const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = quickInvoicePdfFileName(source, language);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setMessage("已生成并下载 PDF。");
  }, [generate, language, source]);

  const legacy = statement.source.kind === "legacy_quick";

  return (
    <section data-testid="quick-invoice-pdf-section" className="mb-3 rounded-xl border border-line bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-ink dark:text-slate-100">{legacy ? "Business Order 客户文件" : "Invoice 客户文件"}（A4 / PDF · 发给客户）</h3>
          <p className="mt-0.5 text-[11px] text-ink-soft dark:text-slate-400">PDF 在当前已授权页面内由验证过的账目与客户/车辆资料生成，不上传浏览器存储。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="PDF 语言"
            data-testid="quick-invoice-pdf-language"
            value={language}
            disabled={busy}
            onChange={(event) => {
              setLanguage(event.target.value as QuickInvoicePdfLanguage);
              setPreviewBytes(null);
              setMessage(null);
            }}
            className="min-h-9 rounded-lg border border-line bg-white px-3 text-xs dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="bilingual">中英对照</option>
          </select>
          <button type="button" data-testid="quick-invoice-pdf-preview" disabled={busy} onClick={() => void preview()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink hover:border-primary-300 hover:text-primary disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
            <Eye size={13} />{busy ? "生成中…" : "预览"}
          </button>
          <button type="button" data-testid="quick-invoice-pdf-download" disabled={busy} onClick={() => void download()} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
            <Download size={13} />{busy ? "生成中…" : "下载 PDF"}
          </button>
        </div>
      </div>
      {message ? <p role="status" data-testid="quick-invoice-pdf-status" className="mt-2 text-[11px] text-primary dark:text-primary-300">{message}</p> : null}
      {previewBytes ? (
        <PdfCanvasPreview bytes={previewBytes} dataTestId="quick-invoice-pdf-canvas" />
      ) : null}
    </section>
  );
}
