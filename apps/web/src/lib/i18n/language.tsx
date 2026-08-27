"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type UiLanguage = "zh" | "en";

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
  toggle: () => void;
}

const LanguageContext = createContext<LanguageContextValue>({ language: "zh", toggle: () => undefined });

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

  return (
    <LanguageContext.Provider value={{ language, toggle }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
