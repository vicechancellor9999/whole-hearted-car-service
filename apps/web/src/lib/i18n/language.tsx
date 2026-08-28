"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, type MessageKey, type MessageVariables, type UiLanguage } from "./catalog";
import { formatUiDate, formatUiMoney, formatUiNumber, intlLocale } from "./format";

export type { UiLanguage } from "./catalog";

const STORAGE_KEY = "wh_language_v1";

/** 界面翻译字典（导航/页面抬头/通用标签；页面内文案逐步跟上）。 */
const DICT: Record<string, string> = {
  "经营概览": "Dashboard",
  "业务工作台": "Business Workbench",
  "基础字典": "Master Data",
  "员工管理": "Employees",
  "绩效管理": "Performance",
  "配件报价大厅": "Parts Quotation Desk",
  "收付款与交车": "Payments & Release",
  "停车费": "Parking Fees",
  "客户档案": "Customers",
  "车辆档案": "Vehicles",
  "车辆主档": "Vehicle",
  "检查结果": "Inspection Reports",
  "业务单｜Business Order": "Business Orders",
  "检查结果｜Inspection Report": "Inspection Reports",
  "客户联系与通知": "Customer Contact & Notices",
  "记账核算": "Accounting",
  "内部培训": "Training",
  "系统设置": "Settings",
  "营业收入统计": "Revenue Statistics",
  "运营概览": "Operations Overview",
  "新建工单": "New Work Order",
  "新建客户": "New Customer",
  "新建检查结果": "New Inspection Report",
  "检查结果报告": "Inspection Report",
  "工单管理": "Order Management",
  "客户与车辆管理": "Customers & Vehicles",
  "公司管理": "Company",
  "系统": "System",
  "Mock 数据模式": "Mock data mode",
  "已连接后端": "Connected to backend",
  "主营业务": "Core Operations",
  "主营业务 · 工单运营": "Core Operations · Order Workflow",
  "客户与车辆 / 客户详情": "Customers & Vehicles / Customer Details",
  "客户与车辆 / 车辆详情": "Customers & Vehicles / Vehicle Details",
  "经营分析 · 收退款实绩": "Business Analysis · Payment and Refund Results",
  "经营概览 · 今日净收款": "Dashboard · Today's Net Receipts",
  "收付款台账": "Payments Ledger",
  "今日净收款明细": "Today's Net Receipts",
  "系统 · 基础资料": "System · Master Data",
  "工单管理 · 正式数据": "Order Management · Formal Data",
  "待取车": "Vehicles Awaiting Collection",
  "客户与车辆": "Customers & Vehicles",
  "集中维护客户正式资料、启停状态与当前车辆关系。": "Maintain formal customer records, account status and current vehicle relationships.",
  "集中维护客户正式资料、当前车辆关系、风险状态、挂账资格与可追溯的验证证据。": "Maintain customer records, current vehicle relationships, risk status, credit eligibility and traceable verification evidence.",
  "维护车辆正式资料、当前客户关系、照片档案、零件需求与车辆任务。": "Maintain formal vehicle records, current customer relationships, photo archives, parts requirements and vehicle tasks.",
  "客户档案、车辆信息与历史关系的统一工作台": "A unified workspace for customer records, vehicle details and relationship history.",
  "经营参数、AI 服务、基础字典与本机偏好。": "Business parameters, AI services, master data and device preferences.",
  "按今日、本周、本月、本年查看逐笔收款、退款和净收款趋势；所有数字与收付款记录同步。": "Review individual payments, refunds and net receipt trends by day, week, month or year. Every total stays in sync with the ledger.",
  "停车费以受保护的取车通知与已提交账单快照为准；减免、认领与收款均写入同一财务账本。": "Parking fees follow protected collection notices and submitted invoice snapshots. Waivers, claims and payments share one financial ledger.",
  "只从正式交单与车辆当前 Business Order 状态生成候选；不记录停车位置。": "Candidates come only from formal handoffs and the vehicle's current Business Order status. Parking locations are not tracked.",
  "系统初始只有超级管理员；由超级管理员按实际人员新增、修改或删除员工。": "The system starts with one Super Administrator, who manages staff accounts for actual employees.",
  "客户沟通状态由正式通知与客户回复记录自动派生；已闭环可按当前维修意向继续筛选。": "Customer communication status is derived from formal notices and replies. Closed items can still be filtered by the customer's current repair decision.",
  "针对指定车辆新建业务单：前台大白话输入，AI 拆成工时/配件双语收费项，人工可改后确认生成。": "Create a Business Order for a selected vehicle. Staff enter plain-language work details, AI separates labor and parts into bilingual charges, and staff review before confirming.",
  "仅显示今天实际发生的逐笔收款与退款；今日净收款等于收款减去退款。": "Shows only payments and refunds posted today. Today's net receipts equal payments minus refunds.",
  "全局查看每张 Business Order 的应收、逐笔收款、逐笔退款与未结余额，并从本页直接发起对应操作。": "Review receivables, individual payments, refunds and outstanding balances for every Business Order, and start each action directly here.",
  "统一维护业务页面允许使用的班组、支付方式、收费单位和员工岗位。": "Maintain the repair teams, payment methods, charging units and staff roles available throughout the system.",
  "今日普通车辆首次派检均衡、四组实时负载与流程数量；所有数字均来自同一运营数据源。": "Monitor today's first-inspection assignment balance, live team workload and workflow counts from one operational data source.",
  "查询全部业务单据，查看流程数量、今日派检均衡和班组实时负载。": "Search all business records and review workflow counts, today's inspection assignment balance and live team workload.",
  "这里读取正式后端保存的车辆、费用承担方、收费版本和维修状态；刷新页面后事实保持不变。": "This page reads vehicles, payers, charge versions and repair status from the formal backend. These facts remain unchanged after refresh.",
  "Inspection Report 是独立检查成果，必须归属车辆；可选关联来源 Business Order。": "An Inspection Report is an independent inspection result that must belong to a vehicle and may reference a source Business Order.",
};

export function translateUi(zh: string, language: UiLanguage): string {
  if (language === "zh") return zh;
  return DICT[zh] ?? zh;
}

interface LanguageContextValue {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
  toggle: () => void;
  locale: string;
  t: (key: MessageKey, variables?: MessageVariables) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatMoney: (value: number) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "zh",
  setLanguage: () => undefined,
  toggle: () => undefined,
  locale: "zh-CN",
  t: (key, variables) => translate(key, "zh", variables),
  formatDate: (value, options) => formatUiDate(value, "zh", options),
  formatNumber: (value, options) => formatUiNumber(value, "zh", options),
  formatMoney: (value) => formatUiMoney(value, "zh"),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<UiLanguage>("zh");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") setLanguage(stored);
    } catch {
      // 忽略存储异常
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en-JM";
  }, [language]);

  const persistLanguage = useCallback((next: UiLanguage) => {
    setLanguage(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略存储异常
    }
  }, []);

  const toggle = useCallback(() => {
    setLanguage((current) => {
      const next: UiLanguage = current === "zh" ? "en" : "zh";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // 忽略存储异常
      }
      return next;
    });
  }, []);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage: persistLanguage,
    toggle,
    locale: intlLocale(language),
    t: (key, variables) => translate(key, language, variables),
    formatDate: (input, options) => formatUiDate(input, language, options),
    formatNumber: (input, options) => formatUiNumber(input, language, options),
    formatMoney: (input) => formatUiMoney(input, language),
  }), [language, persistLanguage, toggle]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

export const useI18n = useLanguage;
