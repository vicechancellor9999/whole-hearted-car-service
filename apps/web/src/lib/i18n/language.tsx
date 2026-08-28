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
