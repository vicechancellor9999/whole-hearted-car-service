import type { UiLanguage } from "./catalog";

const locales: Record<UiLanguage, string> = {
  zh: "zh-CN",
  en: "en-JM",
};

const JAMAICA_TIME_ZONE = "America/Jamaica";

export function intlLocale(language: UiLanguage): string {
  return locales[language];
}

export function formatUiDate(
  value: Date | string | number,
  language: UiLanguage,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(locales[language], {
    timeZone: JAMAICA_TIME_ZONE,
    ...options,
  }).format(value instanceof Date ? value : new Date(value));
}

export function formatUiNumber(
  value: number,
  language: UiLanguage,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locales[language], options).format(value);
}

export function formatUiMoney(value: number, language: UiLanguage): string {
  return `JMD ${formatUiNumber(value, language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
