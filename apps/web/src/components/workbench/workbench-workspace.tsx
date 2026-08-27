"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  Car,
  ClipboardList,
  CreditCard,
  FileText,
  Printer,
  Search,
  SendHorizontal,
  UserPlus,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type { LinkedOperationsState } from "@/lib/api/mock-orders";
import { readParkingFollowUpSnapshot, type ParkingFollowUpSnapshot } from "@/lib/api/mock-parking-followup";
import { computeWorkbenchReminders, type WorkbenchReminders } from "@/lib/business/workbench-state";
import { QuickOrderCreateDialog } from "@/components/orders/quick-order-create-dialog";
import { cn, formatJMDFull } from "@/lib/utils";

// ---------------------------------------------------------------------------
// 欢迎语池：每次进入工作台随机换一条，页面停留期间不切换
// ---------------------------------------------------------------------------

const GREETINGS = [
  "今天也是把每台车都平平安安送回家的一天。",
  "车间转起来，账目理清楚，客户笑开颜。",
  "先喝口咖啡，今天的工作台已经给你摆好了。",
  "一辆车一辆车来，一笔账一笔账清。",
  "今天也是元气满满的一天！",
  " Jamaica 的太阳照常升起，车间的活照常安排。",
  "早上好！先看看哪些车该通知客户来取了。",
  "工作台已就绪，开始高效的一天吧。",
] as const;

// ---------------------------------------------------------------------------
// 快速入口
// ---------------------------------------------------------------------------

interface QuickAction {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  description: string;
  href: string;
  /** 就地动作（优先于 href），当前支持：create-bo */
  inlineAction?: "create-bo";
}

const QUICK_ACTIONS: QuickAction[] = [
  { icon: Search, label: "综合查询", description: "按车牌、客户、单号查找", href: "/customers" },
  { icon: UserPlus, label: "登记客户+车辆", description: "新客户与新车辆一次完成", href: "/customers" },
  { icon: Car, label: "新增车辆", description: "给已有客户加车", href: "/vehicles" },
  { icon: ClipboardList, label: "新建业务单", description: "大白话输入 AI 拆单", href: "/orders/business", inlineAction: "create-bo" },
  { icon: FileText, label: "新建检查结果", description: "针对指定车辆", href: "/orders/inspections" },
  { icon: CreditCard, label: "收付款", description: "按车牌或单号", href: "/payments" },
  { icon: Printer, label: "打印单据", description: "Business Order / Inspection Report / Invoice / Receipt", href: "/orders/business" },
  { icon: SendHorizontal, label: "办理取车", description: "针对指定车辆", href: "/parking" },
  { icon: Wallet, label: "停车费", description: "查看和处理", href: "/parking" },
  { icon: AlertTriangle, label: "客户欠账", description: "查看欠账客户", href: "/customers" },
];

// ---------------------------------------------------------------------------
// 提醒卡片
// ---------------------------------------------------------------------------

function ReminderCard({ title, count, items, href, tone = "neutral" }: {
  title: string;
  count: number;
  items?: string[];
  href: string;
  tone?: "neutral" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "border-line bg-white dark:border-slate-700 dark:bg-slate-800",
    warning: "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5",
    danger: "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/5",
  }[tone];

  return (
    <Link href={href} className={cn("block rounded-xl border p-3 transition-shadow hover:shadow-md", toneClass)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink dark:text-slate-200">{title}</span>
        <span className={cn("text-lg font-bold tabular-nums", count > 0 ? "text-primary" : "text-ink-faint dark:text-slate-500")}>
          {count}
        </span>
      </div>
      {items && items.length > 0 ? (
        <div className="mt-1.5 space-y-0.5">
          {items.slice(0, 3).map((item) => (
            <p key={item} className="truncate text-[11px] text-ink-soft dark:text-slate-400">{item}</p>
          ))}
          {items.length > 3 ? <p className="text-[10px] text-ink-faint">还有 {items.length - 3} 条…</p> : null}
        </div>
      ) : null}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// 工作台
// ---------------------------------------------------------------------------

export function WorkbenchWorkspace() {
  const [state, setState] = useState<LinkedOperationsState | null>(null);
  const [parkingFollowup, setParkingFollowup] = useState<ParkingFollowUpSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [greeting] = useState(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  const [now, setNow] = useState(new Date());
  const [showCreateBo, setShowCreateBo] = useState(false);

  // 时钟
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [store, snapshot, session] = await Promise.all([
        api.debug.linkedOperationsState(),
        Promise.resolve(readParkingFollowUpSnapshot()),
        api.me(),
      ]);
      setState(store);
      setParkingFollowup(snapshot);
      setEmployeeName(session.identity.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取业务数据");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reminders: WorkbenchReminders | null = useMemo(() => {
    if (!state) return null;
    return computeWorkbenchReminders(
      state.quickOrders,
      state.inspectionReports,
      state.vehicles,
      state.parkingCases,
      parkingFollowup,
      state,
    );
  }, [parkingFollowup, state]);

  const dateStr = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const timeStr = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-ink-soft">正在加载工作台…</div>;
  }

  if (error || !reminders) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm font-semibold text-danger">{error ?? "数据异常"}</p>
        <button type="button" onClick={() => void load()} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white">重试</button>
      </div>
    );
  }

  return (
    <div data-testid="workbench" className="min-h-full bg-[var(--wh-page-bg)] p-4 sm:p-6">
      {/* 欢迎区 */}
      <div data-testid="workbench-welcome" className="mb-5 rounded-2xl border border-line bg-gradient-to-r from-primary-50 to-blue-50 px-5 py-4 dark:border-slate-700 dark:from-slate-800 dark:to-slate-800/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-bold text-ink dark:text-slate-100">{employeeName}</p>
            <p className="mt-0.5 text-xs text-ink-soft dark:text-slate-400">前台</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums text-ink dark:text-slate-100">{timeStr}</p>
            <p className="text-xs text-ink-soft dark:text-slate-400">{dateStr}</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-ink-soft dark:text-slate-300">{greeting}</p>
      </div>

      {/* 快速入口 */}
      <section data-testid="workbench-quick-actions" className="mb-5">
        <h2 className="mb-2 text-sm font-bold text-ink dark:text-slate-100">快速入口</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            const shared = "flex flex-col items-center gap-1.5 rounded-xl border border-line bg-white p-3 text-center transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800";
            const body = (
              <>
                <Icon size={20} className="text-primary" />
                <span className="text-xs font-semibold text-ink dark:text-slate-200">{action.label}</span>
                <span className="text-[10px] text-ink-faint dark:text-slate-500">{action.description}</span>
              </>
            );
            if (action.inlineAction === "create-bo") {
              return (
                <button key={action.label} type="button" data-testid={`quick-${action.label}`}
                  onClick={() => setShowCreateBo(true)}
                  className={shared}>
                  {body}
                </button>
              );
            }
            return (
              <Link
                key={action.label}
                href={action.href}
                data-testid={`quick-${action.label}`}
                className={shared}
              >
                {body}
              </Link>
            );
          })}
        </div>
      </section>

      {/* 未完结提醒 */}
      <section data-testid="workbench-reminders">
        <h2 className="mb-2 text-sm font-bold text-ink dark:text-slate-100">未完结提醒</h2>

        {/* BO */}
        <div className="mb-3">
          <h3 className="mb-1.5 text-xs font-semibold text-ink-soft dark:text-slate-400">
            <ClipboardList size={12} className="mr-1 inline" />业务单
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <ReminderCard title="新建待派单" count={reminders.bo.待派单} href="/orders/business?status=pending_assign" tone={reminders.bo.待派单 > 0 ? "warning" : "neutral"} />
            <ReminderCard title="已派单待接车" count={reminders.bo.已派单} href="/orders/business?status=assigned" tone={reminders.bo.已派单 > 0 ? "warning" : "neutral"} />
            <ReminderCard title="维修中待回单" count={reminders.bo.维修中} href="/orders/business?status=in_repair" tone={reminders.bo.维修中 > 0 ? "warning" : "neutral"} />
            <ReminderCard title="维修中超时" count={reminders.bo.维修中超时} href="/orders/business?status=in_repair" tone={reminders.bo.维修中超时 > 0 ? "danger" : "neutral"} />
            <ReminderCard title="停滞待处理" count={reminders.bo.停滞} href="/orders/business?status=stalled" tone={reminders.bo.停滞 > 0 ? "danger" : "neutral"} />
            <ReminderCard title="回单待交单" count={reminders.bo.回单待审核} href="/orders/business?status=returned" tone={reminders.bo.回单待审核 > 0 ? "danger" : "neutral"} />
          </div>
        </div>

        {/* IR */}
        <div className="mb-3">
          <h3 className="mb-1.5 text-xs font-semibold text-ink-soft dark:text-slate-400">
            <FileText size={12} className="mr-1 inline" />检查结果
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <ReminderCard title="尚未通知客户" count={reminders.ir.notNotified} href="/orders/inspections?bucket=not_notified" tone={reminders.ir.notNotified > 0 ? "warning" : "neutral"} />
            <ReminderCard title="已通知、等待回复" count={reminders.ir.awaitingReply} href="/orders/inspections?bucket=awaiting_reply" tone={reminders.ir.awaitingReply > 0 ? "danger" : "neutral"} />
          </div>
        </div>

        {/* Invoice 与欠账 */}
        <div className="mb-3">
          <h3 className="mb-1.5 text-xs font-semibold text-ink-soft dark:text-slate-400">
            <Wallet size={12} className="mr-1 inline" />账单与欠账
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ReminderCard title="未付款" count={reminders.invoice.未付款} href="/orders/business" tone={reminders.invoice.未付款 > 0 ? "warning" : "neutral"} />
            <ReminderCard title="未付清" count={reminders.invoice.未付清} href="/orders/business" tone={reminders.invoice.未付清 > 0 ? "warning" : "neutral"} />
            <ReminderCard title="已付清" count={reminders.invoice.已付清} href="/orders/business" tone="neutral" />
            <ReminderCard title={`欠账 ${formatJMDFull(reminders.outstandingTotalJmd)}`} count={reminders.outstandingCustomerCount} href="/customers" tone={reminders.outstandingCustomerCount > 0 ? "danger" : "neutral"} />
          </div>
        </div>

        {/* 车辆与取车 */}
        <div className="mb-3">
          <h3 className="mb-1.5 text-xs font-semibold text-ink-soft dark:text-slate-400">
            <Car size={12} className="mr-1 inline" />车辆与取车
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <ReminderCard title="待通知取车" count={reminders.vehiclesReadyForPickup} href="/parking" tone={reminders.vehiclesReadyForPickup > 0 ? "warning" : "neutral"} />
            <ReminderCard title="已通知未取车" count={reminders.vehiclesNotifiedNotPickedUp} href="/parking" tone={reminders.vehiclesNotifiedNotPickedUp > 0 ? "warning" : "neutral"} />
            <ReminderCard title="超时未取车" count={reminders.vehiclesOvertime} href="/parking" tone={reminders.vehiclesOvertime > 0 ? "danger" : "neutral"} />
            <ReminderCard title="今日该发账单" count={reminders.parkingBillsDueToday} href="/parking" tone={reminders.parkingBillsDueToday > 0 ? "danger" : "neutral"} />
            <ReminderCard title="在厂无业务单" count={reminders.vehiclesWithoutBo} href="/vehicles" tone={reminders.vehiclesWithoutBo > 0 ? "danger" : "neutral"} />
          </div>
        </div>
      </section>

      {/* 原有功能入口 */}
      <section data-testid="workbench-legacy" className="mt-6 border-t border-line pt-4 dark:border-slate-700">
        <h2 className="mb-2 text-xs font-semibold text-ink-faint dark:text-slate-500">更多功能</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400">
            经营概览 <ArrowRight size={12} />
          </Link>
          <Link href="/dictionaries#teams" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400">
            班组字典 <ArrowRight size={12} />
          </Link>
          <Link href="/performance" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400">
            绩效管理 <ArrowRight size={12} />
          </Link>
          <Link href="/orders/business" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400">
            业务单管理 <ArrowRight size={12} />
          </Link>
        </div>
      </section>

      {showCreateBo && <QuickOrderCreateDialog onClose={() => setShowCreateBo(false)} />}
    </div>
  );
}
