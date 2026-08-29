"use client";

import { ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Languages, Loader2, LogOut, Moon, Sun, Wrench } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { uploadFormalBusinessOrderAttachment } from "@/lib/api/formal-business-order-attachments";
import {
  fetchFormalMechanicWorkOrder,
  fetchFormalMechanicWorkOrders,
  formalBusinessOrderStatusLabel,
  runFormalRepairRoundAction,
  type FormalMechanicWorkOrder,
  type FormalMechanicWorkOrderSummary,
  type FormalWorkReturnItemResult,
} from "@/lib/api/formal-business-orders";
import { useI18n } from "@/lib/i18n/language";

type IntakeDraft = { mileage: string; photo: File | null };

export function MechanicWorkspace() {
  const { language, setLanguage } = useI18n();
  const { theme, setMode } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = Number(searchParams.get("order")) || null;
  const english = language === "en";
  const [items, setItems] = useState<FormalMechanicWorkOrderSummary[]>([]);
  const [detail, setDetail] = useState<FormalMechanicWorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intake, setIntake] = useState<IntakeDraft>({ mileage: "", photo: null });
  const [summary, setSummary] = useState("");
  const [exception, setException] = useState("");
  const [returnPhotos, setReturnPhotos] = useState<File[]>([]);
  const [results, setResults] = useState<Record<string, "completed" | "not_completed">>({});

  const copy = useMemo(() => english ? {
    title: "My repair jobs", back: "All jobs", empty: "No repair jobs are assigned to your team.",
    intakeTitle: "Receive vehicle", mileage: "Odometer (km)", photo: "Odometer photo",
    receive: "Receive vehicle", receiving: "Saving intake…", work: "Work items", instructions: "Instructions",
    returnTitle: "Submit work return", summary: "Work completed", exception: "Exceptions / unfinished work",
    photos: "Service photos", submit: "Submit for front-desk review", submitting: "Submitting…",
    completed: "Completed", notCompleted: "Not completed", pending: "Submitted — awaiting front-desk review",
    rejected: "Returned for correction", approved: "Approved", signOut: "Sign out",
  } : {
    title: "我的维修任务", back: "全部任务", empty: "当前没有分配给本班组的维修任务。",
    intakeTitle: "接车登记", mileage: "接车里程（km）", photo: "里程照片",
    receive: "确认接车", receiving: "正在保存接车资料…", work: "施工项目", instructions: "施工说明",
    returnTitle: "提交维修回单", summary: "实际完成情况", exception: "异常 / 未完成说明",
    photos: "维修照片", submit: "提交前台审核", submitting: "正在提交…",
    completed: "已完成", notCompleted: "未完成", pending: "回单已提交，等待前台审核",
    rejected: "前台已退回修改", approved: "已审核通过", signOut: "退出登录",
  }, [english]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchFormalMechanicWorkOrders();
      setItems(list.items);
      if (selectedId) {
        const next = await fetchFormalMechanicWorkOrder(selectedId);
        setDetail(next);
        setResults(Object.fromEntries(next.workItems.map((item) => [item.id, "completed"])));
      } else {
        setDetail(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (english ? "Unable to load work orders" : "维修任务读取失败"));
    } finally {
      setLoading(false);
    }
  }, [english, selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const receiveVehicle = async () => {
    const existingMileage = detail?.intakeMileageKm ?? null;
    if (!detail || !intake.photo || (existingMileage === null && !/^\d+$/.test(intake.mileage))) {
      setError(english ? "Enter the odometer and take a clear photo." : "请填写接车里程并拍摄清晰的里程照片。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadFormalBusinessOrderAttachment(detail.businessOrderId, {
        file: intake.photo,
        category: "service_photo",
        caption: english ? "Odometer photo" : "接车里程照片",
      });
      let version = detail.repairRound.version;
      if (detail.status === "assigned") {
        const accepted = await runFormalRepairRoundAction(detail.businessOrderId, {
          action: "accept",
          repairRoundVersion: version,
        });
        version = accepted.current.version;
      }
      if (existingMileage === null) {
        const mileage = await runFormalRepairRoundAction(detail.businessOrderId, {
          action: "record_mileage",
          repairRoundVersion: version,
          odometerKm: Number(intake.mileage),
        });
        version = mileage.current.version;
      }
      await runFormalRepairRoundAction(detail.businessOrderId, {
        action: "attach_intake_photo",
        repairRoundVersion: version,
        fileId: uploaded.fileId,
      });
      setIntake({ mileage: "", photo: null });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (english ? "Unable to save intake" : "接车资料保存失败"));
    } finally {
      setBusy(false);
    }
  };

  const submitReturn = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const attachments = [] as number[];
      for (const file of returnPhotos) {
        const uploaded = await uploadFormalBusinessOrderAttachment(detail.businessOrderId, {
          file,
          category: "service_photo",
          caption: english ? "Service photo" : "维修完工照片",
        });
        attachments.push(uploaded.id);
      }
      const itemResults: FormalWorkReturnItemResult[] = detail.workItems.map((item) => ({
        chargeItemId: item.id,
        category: item.kind,
        labelZh: item.nameZh,
        labelEn: item.nameEn,
        result: results[item.id] ?? "completed",
      }));
      await runFormalRepairRoundAction(detail.businessOrderId, {
        action: "submit_return",
        repairRoundVersion: detail.repairRound.version,
        workSummary: summary,
        exceptionSummary: exception,
        itemResults,
        attachmentIds: attachments,
      });
      setSummary("");
      setException("");
      setReturnPhotos([]);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (english ? "Unable to submit work return" : "维修回单提交失败"));
    } finally {
      setBusy(false);
    }
  };

  const intakeComplete = Boolean(detail?.intakeMileageKm !== null && detail?.intakePhotoFileIds.length);

  return (
    <main className="min-h-screen bg-page text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white"><Wrench size={20} /></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">Whole Hearted</p><p className="text-xs text-ink-soft">{copy.title}</p></div>
          <button type="button" aria-label="Language" onClick={() => setLanguage(english ? "zh" : "en")} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-layer-2"><Languages size={18} /></button>
          <button type="button" aria-label="Theme" onClick={() => setMode(theme === "dark" ? "light" : "dark")} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-layer-2">{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
          <form action="/api/formal/auth/logout" method="post"><button aria-label={copy.signOut} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-layer-2 text-rose-500"><LogOut size={18} /></button></form>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        {error ? <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div> : null}
        {loading ? <div className="flex min-h-64 items-center justify-center text-ink-soft"><Loader2 className="animate-spin" /></div> : null}

        {!loading && !detail ? (
          <section className="space-y-3">
            {items.length === 0 ? <div className="rounded-2xl border border-line bg-card p-8 text-center text-sm text-ink-soft">{copy.empty}</div> : items.map((item) => (
              <button key={item.businessOrderId} type="button" onClick={() => router.push(`/mechanic?order=${item.businessOrderId}`)} className="block w-full rounded-2xl border border-line bg-card p-4 text-left shadow-sm transition hover:border-accent">
                <div className="flex items-start gap-3"><ClipboardCheck className="mt-0.5 shrink-0 text-accent" size={21} /><div className="min-w-0 flex-1"><p className="font-bold">{item.vehicle.plate} · {item.vehicle.description}</p><p className="mt-1 text-xs text-ink-soft">{item.orderNo} · {item.repairRound.assignedTeamName}</p></div><span className="rounded-full bg-layer-3 px-2.5 py-1 text-[11px] font-semibold">{formalBusinessOrderStatusLabel(item.status, language)}</span></div>
                {item.latestRejectionReason ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{copy.rejected}：{item.latestRejectionReason}</p> : null}
              </button>
            ))}
          </section>
        ) : null}

        {detail ? (
          <>
            <button type="button" onClick={() => router.push("/mechanic")} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-accent"><ArrowLeft size={17} />{copy.back}</button>
            <section className="rounded-2xl border border-line bg-card p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xl font-bold">{detail.vehicle.plate}</p><p className="mt-1 text-sm text-ink-soft">{detail.vehicle.description}{detail.vehicle.vin ? ` · VIN ${detail.vehicle.vin}` : ""}</p><p className="mt-2 text-xs text-ink-soft">{detail.orderNo} · {detail.repairRound.assignedTeamName}</p></div><span className="rounded-full bg-layer-3 px-3 py-1.5 text-xs font-semibold">{formalBusinessOrderStatusLabel(detail.status, language)}</span></div></section>

            {detail.latestRejectionReason ? <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-bold">{copy.rejected}</p><p className="mt-1">{detail.latestRejectionReason}</p></section> : null}

            {!intakeComplete && ["assigned", "in_repair"].includes(detail.status) ? (
              <section className="rounded-2xl border border-line bg-card p-5 shadow-sm"><h2 className="text-base font-bold">{copy.intakeTitle}</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">{copy.mileage}<input inputMode="numeric" disabled={detail.intakeMileageKm !== null} placeholder={detail.intakeMileageKm !== null ? String(detail.intakeMileageKm) : undefined} value={intake.mileage} onChange={(event) => setIntake((current) => ({ ...current, mileage: event.target.value.replace(/\D/g, "") }))} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-layer-1 px-3 text-base disabled:cursor-not-allowed disabled:opacity-70" /></label><label className="text-sm font-semibold">{copy.photo}<span className="mt-2 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-accent bg-[var(--wh-background-selected)] px-3 text-accent"><Camera size={18} />{intake.photo?.name ?? copy.photo}</span><input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => setIntake((current) => ({ ...current, photo: event.target.files?.[0] ?? null }))} /></label></div><button disabled={busy} type="button" onClick={() => void receiveVehicle()} className="mt-4 min-h-12 w-full rounded-xl bg-accent px-4 font-bold text-white disabled:opacity-50">{busy ? copy.receiving : copy.receive}</button></section>
            ) : null}

            <section className="rounded-2xl border border-line bg-card p-5 shadow-sm"><h2 className="text-base font-bold">{copy.work}</h2><div className="mt-3 divide-y divide-line">{detail.workItems.map((item) => <article key={item.id} className="py-3"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-accent" size={18} /><div><p className="font-semibold">{english ? item.nameEn || item.nameZh : item.nameZh}</p>{(english ? item.descriptionEn : item.descriptionZh) ? <p className="mt-1 text-sm text-ink-soft">{english ? item.descriptionEn : item.descriptionZh}</p> : null}<p className="mt-1 text-xs text-ink-soft">× {item.quantity}</p></div></div></article>)}</div>{detail.notes.length ? <><h3 className="mt-5 border-t border-line pt-4 text-sm font-bold">{copy.instructions}</h3>{detail.notes.map((note, index) => <p key={`${note.kind}-${index}`} className="mt-2 text-sm text-ink-soft">{english ? note.contentEn || note.contentZh : note.contentZh || note.contentEn}</p>)}</> : null}</section>

            {detail.status === "in_repair" && intakeComplete ? (
              <section className="rounded-2xl border border-line bg-card p-5 shadow-sm"><h2 className="text-base font-bold">{copy.returnTitle}</h2><div className="mt-4 space-y-2">{detail.workItems.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl bg-layer-2 p-3"><span className="min-w-0 flex-1 text-sm font-semibold">{english ? item.nameEn || item.nameZh : item.nameZh}</span><select value={results[item.id] ?? "completed"} onChange={(event) => setResults((current) => ({ ...current, [item.id]: event.target.value as "completed" | "not_completed" }))} className="min-h-10 rounded-lg border border-line bg-card px-2 text-xs font-semibold"><option value="completed">{copy.completed}</option><option value="not_completed">{copy.notCompleted}</option></select></div>)}</div><label className="mt-4 block text-sm font-semibold">{copy.summary}<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-line bg-layer-1 p-3 text-sm" /></label><label className="mt-4 block text-sm font-semibold">{copy.exception}<textarea value={exception} onChange={(event) => setException(event.target.value)} rows={2} className="mt-2 w-full rounded-xl border border-line bg-layer-1 p-3 text-sm" /></label><label className="mt-4 block text-sm font-semibold">{copy.photos}<span className="mt-2 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-layer-2"><Camera size={18} />{returnPhotos.length ? `${returnPhotos.length}` : copy.photos}</span><input type="file" multiple accept="image/*" className="sr-only" onChange={(event) => setReturnPhotos(Array.from(event.target.files ?? []))} /></label><button disabled={busy} type="button" onClick={() => void submitReturn()} className="mt-5 min-h-12 w-full rounded-xl bg-accent px-4 font-bold text-white disabled:opacity-50">{busy ? copy.submitting : copy.submit}</button></section>
            ) : null}

            {detail.status === "return_pending_review" ? <section className="rounded-2xl border border-sky-300 bg-sky-50 p-5 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100"><p className="font-bold">{detail.latestWorkReturn?.review?.result === "approved" ? copy.approved : copy.pending}</p></section> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
