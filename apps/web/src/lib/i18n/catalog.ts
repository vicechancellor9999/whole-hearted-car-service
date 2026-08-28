import { enMessages } from "./messages/en";
import { zhMessages, type ZhMessageKey } from "./messages/zh";

export type UiLanguage = "zh" | "en";
export type MessageKey = ZhMessageKey;
export type MessageVariables = Readonly<Record<string, string | number>>;

const catalogs: Record<UiLanguage, Readonly<Record<MessageKey, string>>> = {
  zh: zhMessages,
  en: enMessages,
};

const VARIABLE_PATTERN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

export function assertCatalogParity(): void {
  const zhKeys = Object.keys(zhMessages).sort();
  const enKeys = Object.keys(enMessages).sort();
  if (zhKeys.length !== enKeys.length || zhKeys.some((key, index) => key !== enKeys[index])) {
    throw new Error("Chinese and English message catalogs do not have identical keys");
  }
}

export function translate(
  key: MessageKey,
  language: UiLanguage,
  variables: MessageVariables = {},
): string {
  const template = catalogs[language][key];
  if (typeof template !== "string") {
    throw new Error(`Missing ${language} translation for ${key}`);
  }
  return template.replace(VARIABLE_PATTERN, (_match, variable: string) => {
    const value = variables[variable];
    if (value === undefined) {
      throw new Error(`Missing translation variable ${variable} for ${key}`);
    }
    return String(value);
  });
}
