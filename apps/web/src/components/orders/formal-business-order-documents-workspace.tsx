"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, LoaderCircle, Printer, Maximize, Minimize, ChevronDown, History, X } from "lucide-react";
import styles from "./document-reader.module.css";
import {
  createFormalDocumentRevision,
  fetchFormalDocumentDetail,
  formalDocumentKindLabel,
  formalDocumentRevisionFileUrl,
  type FormalBusinessOrderDocument,
  type FormalBusinessOrderDocumentDetail,
} from "@/lib/api/formal-business-orders";
import { formatDateTime } from "@/lib/utils";
import { PdfCanvasPreview } from "@/components/orders/pdf-canvas-preview";
import { printPdfBytes } from "@/lib/orders/ir-pdf-print";
import { useI18n } from "@/lib/i18n/language";

const PAIRED_COPY_LABELS = ["办公室联", "客户联"] as const;

export function FormalBusinessOrderDocumentsWorkspace({
  businessOrderId,
  documents,
  canWrite,
  busy,
  onGenerate,
  currentChargeVersionNo,
}: {
  businessOrderId: number;
  documents: FormalBusinessOrderDocument[];
  canWrite: boolean;
  busy: boolean;
  currentChargeVersionNo?: number;
  onGenerate(kind: FormalBusinessOrderDocument["kind"]): Promise<FormalBusinessOrderDocument | null>;
}) {
  const { language } = useI18n();
  const english = language === "en";
  const [showLegacyOffice, setShowLegacyOffice] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const visibleDocuments = useMemo(() => documents.filter((document) => showLegacyOffice || document.kind !== "office_archive"), [documents, showLegacyOffice]);
  const newestDocumentId = useMemo(() => [...visibleDocuments].sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))[0]?.id ?? null, [visibleDocuments]);
  const labelFor = (kind: FormalBusinessOrderDocument["kind"]) => kind === "customer_copy"
    ? (english ? "Fee confirmation · Office + customer" : "费用确认单 · 办公室联＋客户联")
    : formalDocumentKindLabel(kind, language);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(newestDocumentId);
  const [detail, setDetail] = useState<FormalBusinessOrderDocumentDetail | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);
  const [pdfFile, setPdfFile] = useState<{ url: string; bytes: Uint8Array } | null>(null);
  const [retry, setRetry] = useState(0);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const wasFullscreen = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationLanguage, setGenerationLanguage] = useState<"zh" | "en">(english ? "en" : "zh");
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<"detail" | "file" | "repair" | "print">("detail");
  const [recovering, setRecovering] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printLock = useRef(false);
  const recoveryLock = useRef(false);
  const recoveryEpoch = useRef(0);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [failedGenerationKind, setFailedGenerationKind] = useState<FormalBusinessOrderDocument["kind"] | null>(null);
  const generationLock = useRef(false);
  const [documentLanguageChoice, setDocumentLanguageChoice] = useState<{
    documentId: number | null;
    language: "zh" | "en";
  }>({ documentId: null, language: "zh" });

  const generateAndSelect = async (kind: FormalBusinessOrderDocument["kind"]) => {
    if (generationLock.current || recoveryLock.current) return;
    generationLock.current = true;
    try {
      const document = await onGenerate(kind);
      if (document) { selectDocument(document.id); setDocumentLanguageChoice({ documentId: document.id, language: generationLanguage }); setGenerationOpen(false); setFailedGenerationKind(null); }
      else setFailedGenerationKind(kind);
    } catch { setFailedGenerationKind(kind); }
    finally { generationLock.current = false; }
  };
  const selectDocument = (id: number) => {
    setHistoryOpen(false);
    recoveryEpoch.current += 1;
    setRecoveryNotice(null);
    setRetry((value) => value + 1);
    setSelectedDocumentId(id); setDetail(null); setSelectedRevisionId(null); setPdfFile(null); setDocumentError(null);
  };

  const effectiveSelectedDocumentId = visibleDocuments.some((document) => document.id === selectedDocumentId)
    ? selectedDocumentId
    : newestDocumentId;
  const selectedDocument = documents.find((document) => document.id === effectiveSelectedDocumentId) ?? null;
  const currentDetail = detail?.document.id === selectedDocument?.id && detail?.document.businessOrderId === businessOrderId ? detail : null;
  const availableRevisions = currentDetail?.revisions ?? [];
  const selectedRevision = availableRevisions.find((revision) => revision.id === selectedRevisionId)
    ?? availableRevisions.at(-1) ?? null;
  // v16 introduced identical office + customer copies; later renderer names
  // describe unrelated fixes and need not retain the old "-paired" suffix.
  const rendererGeneration = Number(/^bo-a4-v(\d+)(?:-|$)/u.exec(selectedRevision?.rendererVersion ?? "")?.[1] ?? 0);
  const isPaired = selectedDocument?.kind === "customer_copy" && rendererGeneration >= 16;
  const supportsEnglish = selectedDocument?.kind !== "mechanic_work" && Boolean(selectedRevision?.englishFileId);
  const documentLanguage = documentLanguageChoice.documentId === effectiveSelectedDocumentId
    && supportsEnglish
    ? documentLanguageChoice.language
    : "zh";
  const pdfUrl = selectedDocument && selectedRevision ? formalDocumentRevisionFileUrl(businessOrderId, selectedDocument.id, selectedRevision.id, { language: documentLanguage }) : null;
  const pdfBytes = pdfUrl && pdfFile?.url === pdfUrl ? pdfFile.bytes : null;
  const handlePreviewError = useCallback(() => {
    setPdfFile(null); setErrorSource("file");
    setDocumentError(english ? "The PDF could not be displayed. Retry loading; if it still fails, create a repair revision." : "PDF 无法显示。请先重试读取；若仍失败，可以按原单据内容生成修复版。");
  }, [english]);
  useEffect(() => () => { recoveryEpoch.current += 1; }, [businessOrderId, effectiveSelectedDocumentId, documentLanguage]);
  useEffect(() => {
    if (!fullscreen && wasFullscreen.current) fullscreenButtonRef.current?.focus();
    wasFullscreen.current = fullscreen;
  }, [fullscreen]);
  const openDialog = useCallback((node: HTMLDialogElement | null) => { if (node && !node.open) node.showModal(); }, []);
  const toggleFullscreen = () => setFullscreen((value) => !value);
  useEffect(() => {
    if (!selectedDocument) return;
    let active = true;
    void fetchFormalDocumentDetail(businessOrderId, selectedDocument.id)
      .then((next) => {
        if (!active) return;
        const latest = next.revisions.at(-1) ?? null;
        setDetail(next); setSelectedRevisionId(latest?.id ?? null);
        if (!latest) {
          setErrorSource("detail");
          setDocumentError(english ? "The document is saved, but has no readable print revision. Regenerate its file using the saved content." : "单据内容已保存，但没有可读取的打印版本。可以按已保存的内容重新生成文件。");
        }
      })
      .catch((caught) => { if (active) { setErrorSource("detail"); setDocumentError(english ? "Could not load document revisions. Retry to check the saved document." : (caught instanceof Error ? caught.message : "单据版本读取失败")); } })
      ;
    return () => { active = false; };
  }, [businessOrderId, english, selectedDocument, retry]);

  useEffect(() => {
    if (!pdfUrl) return;
    let active = true;
    const controller = new AbortController();
    void fetch(pdfUrl, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(english ? "Could not load the PDF file" : "PDF 文件读取失败");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (active) { setPdfFile({ url: pdfUrl, bytes }); setDocumentError(null); }
      })
      .catch((caught) => { if (active) { setErrorSource("file"); setDocumentError(english ? "Could not load the PDF file. Retry loading, or create a repair revision from the saved document." : (caught instanceof Error ? caught.message : "PDF 文件读取失败")); } })
      ;
    return () => { active = false; controller.abort(); };
  }, [pdfUrl, english, retry]);

  const recoverFile = async () => {
    if (!canWrite || busy || recoveryLock.current || generationLock.current || !selectedDocument || !currentDetail) return;
    recoveryLock.current = true;
    setRecovering(true); setRecoveryNotice(null);
    const epoch = recoveryEpoch.current;
    const documentId = selectedDocument.id;
    const expectedLatestRevisionNo = currentDetail.latestRevisionNo;
    const applyRecovered = (next: FormalBusinessOrderDocumentDetail) => {
      if (epoch !== recoveryEpoch.current) return;
      setDetail(next); setSelectedRevisionId(next.revisions.at(-1)?.id ?? null);
      setDocumentError(null); setPdfFile(null);
      setRecoveryNotice(english ? "Print revision ready. Loading its preview; earlier files are retained." : "打印版本已就绪，正在加载预览；原有版本继续保留。");
    };
    try {
      const fresh = await fetchFormalDocumentDetail(businessOrderId, documentId);
      if (epoch !== recoveryEpoch.current) return;
      // Reconcile an earlier uncertain response or another user's successful repair first.
      if (fresh.latestRevisionNo > expectedLatestRevisionNo) { applyRecovered(fresh); return; }
      await createFormalDocumentRevision(businessOrderId, documentId, {
        expectedLatestRevisionNo,
        fieldOverrides: fresh.revisions.at(-1)?.fieldOverrides ?? {},
      });
      const repaired = await fetchFormalDocumentDetail(businessOrderId, documentId);
      if (repaired.latestRevisionNo <= expectedLatestRevisionNo) throw new Error(english ? "The print revision is not yet confirmed. Retry to check its status." : "尚未确认打印版本保存成功，请重试核对结果。");
      applyRecovered(repaired);
    } catch (caught) {
      // A failed response does not mean the transaction failed. Never blindly POST again.
      try {
        const reconciled = await fetchFormalDocumentDetail(businessOrderId, documentId);
        if (reconciled.latestRevisionNo > expectedLatestRevisionNo) { applyRecovered(reconciled); return; }
      } catch { /* Keep the original snapshot and the recovery action available. */ }
      if (epoch === recoveryEpoch.current) {
        setErrorSource("repair");
        setDocumentError(english ? "File recovery could not be confirmed. Retry to check the existing result before generating again." : `${caught instanceof Error ? caught.message : "文件恢复失败"}。单据内容仍保留，再次重试会先核对已有结果。`);
      }
    } finally { recoveryLock.current = false; setRecovering(false); }
  };

  const selectRevision = (revisionId: number) => {
    recoveryEpoch.current += 1; setRecoveryNotice(null);
    setDocumentError(null); setPdfFile(null);
    setSelectedRevisionId(revisionId);
  };

  const printCurrent = async () => {
    if (!pdfBytes || !selectedDocument || !selectedRevision || printLock.current) return;
    printLock.current = true;
    setPrinting(true);
    setDocumentError(null);
    try {
      await printPdfBytes({
        metadata: { id: `${selectedRevision.id}-${documentLanguage}`, language: documentLanguage, fileName: `${selectedDocument.documentNo}-R${selectedRevision.revisionNo}-${documentLanguage.toUpperCase()}.pdf` },
        bytes: pdfBytes,
      });
    } catch (caught) {
      setErrorSource("print");
      setDocumentError(english ? "System print did not start. Download this PDF and print it in a local reader, or retry in Safari / Chrome." : `${caught instanceof Error ? caught.message : "无法调用系统打印。"} 可点击下方“下载 PDF”继续打印。`);
    } finally { printLock.current = false; setPrinting(false); }
  };

  const workspace = (
    <div className={`${styles.reader} ${fullscreen ? styles.fullscreen : ""}`}>
      <section className="flex h-full min-h-0 flex-col">
        <div className={styles.toolbar} aria-label={english ? "Document actions" : "单据操作"}>
          <div className={styles.documentChoice}>
            <select aria-label={english ? "Select document" : "选择单据"} value={effectiveSelectedDocumentId ?? ""} onChange={(event) => selectDocument(Number(event.target.value))} className={styles.documentSelect}><option value="" disabled>{english ? "Select document" : "选择单据"}</option>{visibleDocuments.map((item) => <option key={item.id} value={item.id}>{item.kind === "customer_copy" ? (english ? "Fee confirmation" : "费用确认单") : labelFor(item.kind)} · V{item.chargeVersionNo} · {item.documentNo}</option>)}</select>
            <button type="button" aria-label={english ? "Document history" : "单据历史"} title={english ? "Document history" : "单据历史"} aria-expanded={historyOpen} aria-controls="document-history" onClick={() => { setHistoryOpen((value) => !value); setGenerationOpen(false); }} className={styles.iconButton}><History size={18} /></button>
          </div>
          <div className={styles.actions}>
            {selectedDocument?.kind !== "mechanic_work" ? <div className={styles.languages} aria-label={english ? "Document language" : "单据语言"}><button type="button" aria-pressed={documentLanguage === "zh"} onClick={() => { setDocumentError(null); setDocumentLanguageChoice({ documentId: effectiveSelectedDocumentId, language: "zh" }); }}>{english ? "Chinese" : "中文"}</button><button type="button" aria-pressed={documentLanguage === "en"} disabled={!supportsEnglish} onClick={() => { setDocumentError(null); setDocumentLanguageChoice({ documentId: effectiveSelectedDocumentId, language: "en" }); }}>English</button></div> : null}
            {canWrite ? <button type="button" aria-expanded={generationOpen} aria-controls="document-generation-actions" onClick={() => { setGenerationOpen((value) => !value); setHistoryOpen(false); }} className={styles.secondaryButton}>{english ? "Generate" : "生成单据"}<ChevronDown size={14} /></button> : null}
            {selectedDocument && selectedRevision ? <a aria-label={english ? "Download PDF" : "下载 PDF"} title={english ? "Download PDF" : "下载 PDF"} href={formalDocumentRevisionFileUrl(businessOrderId, selectedDocument.id, selectedRevision.id, { language: documentLanguage, download: true })} className={styles.iconButton}><Download size={18} /></a> : null}
            <button ref={fullscreenButtonRef} type="button" onClick={toggleFullscreen} aria-label={fullscreen ? (english ? "Exit reader" : "退出全屏") : (english ? "Expand" : "全屏看单据")} title={fullscreen ? (english ? "Exit reader" : "退出全屏") : (english ? "Expand" : "全屏看单据")} className={styles.iconButton}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>
            <button type="button" disabled={!pdfBytes || printing} aria-busy={printing} onClick={() => void printCurrent()} className={styles.printButton}>{printing ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : <Printer size={16} />}{printing ? (english ? "Preparing…" : "准备打印…") : (english ? "System print" : "系统打印")}</button>
          </div>
          {canWrite && generationOpen ? <section id="document-generation-actions" aria-label={english ? "Generate documents" : "生成单据选项"} className="absolute right-0 top-full z-30 mt-2 w-full max-w-sm rounded-xl border border-line bg-card p-3 shadow-lg" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setGenerationOpen(false); } }}>
            <p className="mb-3 text-sm leading-6 text-ink-soft">{english ? "Office and customer copies share the same content and language, and print together." : "办公室联与客户联内容、语言一致，一次生成、成套打印。"}</p>
            <label className="mb-3 flex items-center justify-between gap-3 text-sm">{english ? "Copy language" : "两联语言"}<select aria-label={english ? "Generation language" : "生成语言"} value={generationLanguage} onChange={(event) => setGenerationLanguage(event.target.value as "zh" | "en")} className="min-h-11 rounded-lg border border-line bg-card px-3"><option value="zh">中文</option><option value="en">English</option></select></label>
            <div className="grid gap-2">{(["customer_copy", "mechanic_work"] as const).map((kind) => <button key={kind} disabled={busy || recovering} type="button" onClick={() => void generateAndSelect(kind)} className="min-h-11 rounded-lg border border-primary px-3 text-left text-sm font-semibold text-primary disabled:opacity-50">{kind === "customer_copy" ? (english ? "Generate office + customer copies" : "生成费用确认单（办公室联＋客户联）") : (english ? "Generate mechanic copy" : "生成维修工联")}</button>)}</div>
            <button type="button" onClick={() => setGenerationOpen(false)} className="mt-2 min-h-11 w-full rounded-lg text-sm text-ink-soft">{english ? "Close" : "收起"}</button>
          </section> : null}
        </div>
        {failedGenerationKind ? <div role="alert" className="mt-2 shrink-0 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{english ? "Generation was not confirmed. Retry the same request to recover its saved result." : "尚未确认生成结果。重试会复用本次请求，核对已保存的单据。"}<button disabled={busy || recovering} onClick={() => void generateAndSelect(failedGenerationKind)} type="button" className="ml-2 min-h-11 px-3 font-semibold underline">{english ? "Retry generation" : "重试生成"}</button></div> : null}
        <div className={styles.stage}>
          {historyOpen ? <section id="document-history" aria-label={english ? "Document history list" : "单据历史列表"} className={styles.history} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setHistoryOpen(false); } }}>
            <div className="flex items-center justify-between pb-2"><h2 className="text-sm font-semibold">{english ? "Document history" : "单据历史"}</h2><button type="button" aria-label={english ? "Close history" : "关闭历史"} className={styles.iconButton} onClick={() => setHistoryOpen(false)}><X size={16} /></button></div>
            {availableRevisions.length ? <label className={styles.revisionChoice}>{english ? "Print revision" : "打印版本"}<select aria-label={english ? "Print revision" : "打印版本"} value={selectedRevision?.id ?? ""} onChange={(event) => { selectRevision(Number(event.target.value)); setHistoryOpen(false); }}>{availableRevisions.map((revision) => <option key={revision.id} value={revision.id}>R{revision.revisionNo} · {formatDateTime(revision.createdAt)}</option>)}</select></label> : null}
            {documents.some((document) => document.kind === "office_archive") ? <button type="button" aria-expanded={showLegacyOffice} onClick={() => setShowLegacyOffice((value) => !value)} className="mb-2 min-h-11 text-xs text-primary underline">{showLegacyOffice ? (english ? "Hide legacy office copies" : "收起旧版独立办公室联") : (english ? "View legacy office copies" : "查看旧版独立办公室联")}</button> : null}
            {visibleDocuments.length === 0 ? <p className="px-3 py-8 text-center text-xs text-ink-soft">{english ? "No formal print documents have been generated." : "尚未生成正式打印文件。"}</p> : visibleDocuments.map((document) => <button key={document.id} type="button" onClick={() => selectDocument(document.id)} className={`block w-full border-b border-line px-3 py-3 text-left text-xs last:border-0 ${effectiveSelectedDocumentId === document.id ? "bg-primary-50 text-primary" : "hover:bg-surface"}`}><strong className="block">{document.documentNo}</strong><span className="mt-1 block text-ink-soft">{labelFor(document.kind)} · V{document.chargeVersionNo}</span><time className="mt-1 block text-[10px] text-ink-soft">{formatDateTime(document.generatedAt)}</time></button>)}
          </section> : null}
          <div className={styles.preview}>
            {selectedDocument && selectedRevision ? <div className={styles.caption}><span>{selectedDocument.documentNo} <span className="mx-1.5">/</span> R{selectedRevision.revisionNo}</span>{selectedDocument.kind === "customer_copy" ? <span>{isPaired ? (english ? "Office + customer · Paired print" : "办公室联＋客户联 · 按所选语言成套打印") : (english ? "Historical single copy. Generate a new fee confirmation for paired printing." : "历史独立联；生成新费用确认单即可成套打印。")}</span> : <span>{english ? "Mechanic copy" : "维修工联"}</span>}</div> : null}
            {selectedDocument && currentChargeVersionNo != null && selectedDocument.chargeVersionNo !== currentChargeVersionNo ? <p className="shrink-0 bg-amber-50 px-3 py-2 text-xs text-amber-900">{english ? `Historical document · charges V${selectedDocument.chargeVersionNo}; current charges V${currentChargeVersionNo}. Generate a new copy for the current charges.` : `历史单据 · 收费 V${selectedDocument.chargeVersionNo}；当前收费 V${currentChargeVersionNo}。需要确认当前费用时，请生成新联。`}</p> : null}
            {documentError ? <div role="alert" className="m-3 max-h-[55%] shrink-0 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <p>{documentError}</p>
              {currentDetail && errorSource !== "print" ? <p className="mt-1 text-xs leading-5">{canWrite ? (english ? "Repair uses this document’s saved content and keeps earlier revisions. If recovery still fails, ask an administrator to check storage and the print service." : "恢复使用本单据已保存的内容，并保留原版本。若仍失败，请管理员检查文件存储和打印服务。") : (english ? "Ask the front desk or an administrator to recover this document, then retry loading." : "请前台或管理员恢复此单据的打印文件，然后重试读取。")}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <button disabled={recovering || printing} type="button" onClick={() => { if (errorSource === "print") { void printCurrent(); return; } setDocumentError(null); setRecoveryNotice(null); setPdfFile(null); setRetry((value) => value + 1); }} className="min-h-11 rounded-lg border border-rose-300 px-3 font-semibold disabled:opacity-50">{errorSource === "print" ? (english ? "Retry print" : "重试打印") : (english ? "Retry" : "重试")}</button>
                {errorSource === "print" && pdfUrl ? <a href={`${pdfUrl}&download=1`} download className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 font-semibold text-white"><Download size={16} />{english ? "Download PDF" : "下载 PDF"}</a> : null}
                {canWrite && currentDetail && (availableRevisions.length === 0 || errorSource === "file" || errorSource === "repair") ? <button disabled={busy || recovering} type="button" onClick={() => void recoverFile()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 font-semibold text-white disabled:opacity-50">{recovering ? <LoaderCircle size={16} className="animate-spin" /> : null}{recovering ? (english ? "Recovering…" : "正在恢复文件…") : availableRevisions.length ? (english ? "Create repair revision" : "生成修复版") : (english ? "Regenerate file" : "重新生成文件")}</button> : null}
                {canWrite && errorSource === "repair" ? <a href={`/orders/business/${businessOrderId}?tab=operations`} className="inline-flex min-h-11 items-center px-3 underline">{english ? "Review order details" : "检查业务单明细"}</a> : null}
              </div>
            </div> : null}
            {recoveryNotice && !documentError ? <p role="status" className="shrink-0 px-3 py-2 text-xs text-emerald-700">{pdfBytes ? (english ? "File recovered. Preview and printing are ready." : "文件已恢复，可以预览和打印。") : recoveryNotice}</p> : null}
            {pdfBytes ? <div className="min-h-0 flex-1 overflow-hidden"><PdfCanvasPreview key={pdfUrl} bytes={pdfBytes} onError={handlePreviewError} dataTestId="business-document-pdf-canvas" fitWidth showZoomControls fillHeight compactToolbar continuousPages={isPaired} copyLabels={isPaired ? PAIRED_COPY_LABELS : undefined} thumbnailTestIdPrefix="business-document-page" /></div> : selectedDocument && !documentError ? <div role="status" className="grid min-h-0 flex-1 place-content-center justify-items-center gap-3 py-8 text-sm"><LoaderCircle className="animate-spin text-primary" />{english ? "Loading selected document…" : "正在加载所选单据…"}</div> : <div className="grid min-h-0 flex-1 place-items-center py-8 text-xs text-ink-soft">{selectedDocument ? (english ? "Use the recovery actions above to continue." : "使用上方恢复操作继续处理此单据。") : (english ? "Select or generate a formal document to preview it here." : "选择或生成一份正式文件后在这里预览。")}</div>}
          </div>
        </div>
      </section>

    </div>
  );
  return fullscreen ? createPortal(<dialog ref={openDialog} aria-label={english ? "Document reading workspace" : "单据阅读工作区"} onCancel={() => setFullscreen(false)} onClose={() => setFullscreen(false)} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-card p-0 text-ink">{workspace}</dialog>, document.body) : workspace;
}
