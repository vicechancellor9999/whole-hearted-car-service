import { pinyin } from "pinyin-pro";
import {
  APPROVED_FULL_NAME_PAIRS,
  CHINESE_NAME_OVERRIDES,
  type ApprovedFullNamePair,
} from "./name-dictionary";

export const CUSTOMER_TRANSLITERATION_VERSION = "customer-name-v1" as const;

export type NameSourceScript = "zh" | "en";
export type TransliterationMethod = "offline_pinyin" | "exact_name_dictionary";

export interface CustomerNameResult {
  readonly sourceScript: NameSourceScript;
  readonly sourceValue: string;
  readonly nameZh: string | null;
  readonly nameEn: string;
  readonly method: TransliterationMethod;
  readonly version: typeof CUSTOMER_TRANSLITERATION_VERSION;
  readonly status: "confirmed";
}

export class CustomerNameTransliterationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED"
      | "CUSTOMER_NAME_SCRIPT_INVALID",
  ) {
    super(message);
    this.name = "CustomerNameTransliterationError";
  }
}

export const COMPOUND_SURNAMES = new Set([
  "欧阳", "司马", "上官", "诸葛", "东方", "皇甫", "尉迟", "公孙", "慕容", "司徒",
]);

const HAN_NAME = /^[\u3400-\u4DBF\u4E00-\u9FFF]+$/u;
const CHINESE_SOURCE = /^[\u3400-\u4DBF\u4E00-\u9FFF·]+$/u;
const ENGLISH_NAME = /^[A-Za-z]+(?: [A-Za-z]+)*$/;

function normalizedInput(input: string): string {
  return input.normalize("NFC").trim();
}

function normalizedEnglishName(input: string): string {
  return input.replace(/\s+/g, " ");
}

function key(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function exactEnglishPair(input: string): ApprovedFullNamePair | undefined {
  const lookup = key(input);
  return APPROVED_FULL_NAME_PAIRS.find((pair) => key(pair.en) === lookup);
}

function exactChineseOverride(input: string): ApprovedFullNamePair | undefined {
  return CHINESE_NAME_OVERRIDES.find((pair) => pair.zh === input);
}

function invalidScript(): never {
  throw new CustomerNameTransliterationError(
    "客户姓名必须为纯中文或纯英文姓名",
    "CUSTOMER_NAME_SCRIPT_INVALID",
  );
}

function unsupported(): never {
  throw new CustomerNameTransliterationError(
    "当前纯 Mock 音译库没有该完整姓名",
    "CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED",
  );
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function pinyinSlice(value: string): string[] {
  const syllables = pinyin(value, { toneType: "none", type: "array", surname: "head" });
  if (syllables.length !== [...value].length || syllables.some((syllable) => !/^[a-z]+$/i.test(syllable))) {
    unsupported();
  }
  return syllables;
}

export function splitChinesePersonalName(value: string): { surname: string; givenName: string } {
  const surnameLength = COMPOUND_SURNAMES.has(value.slice(0, 2)) ? 2 : 1;
  return { surname: value.slice(0, surnameLength), givenName: value.slice(surnameLength) };
}

export function transliterateCustomerName(input: string): CustomerNameResult {
  const normalized = normalizedInput(input);
  if (!normalized) invalidScript();

  if (CHINESE_SOURCE.test(normalized)) {
    const override = exactChineseOverride(normalized);
    if (override) {
      return {
        sourceScript: "zh",
        sourceValue: normalized,
        nameZh: override.zh,
        nameEn: override.en,
        method: "exact_name_dictionary",
        version: CUSTOMER_TRANSLITERATION_VERSION,
        status: "confirmed",
      };
    }
    if (!HAN_NAME.test(normalized)) unsupported();
    const { surname, givenName } = splitChinesePersonalName(normalized);
    if (!givenName) unsupported();
    return {
      sourceScript: "zh",
      sourceValue: normalized,
      nameZh: normalized,
      nameEn: `${capitalize(pinyinSlice(surname).join(""))} ${capitalize(pinyinSlice(givenName).join(""))}`,
      method: "offline_pinyin",
      version: CUSTOMER_TRANSLITERATION_VERSION,
      status: "confirmed",
    };
  }

  const english = normalizedEnglishName(normalized);
  if (!ENGLISH_NAME.test(english)) invalidScript();
  const pair = exactEnglishPair(english);
  if (!pair) unsupported();
  return {
    sourceScript: "en",
    sourceValue: pair.en,
    nameZh: pair.zh,
    nameEn: pair.en,
    method: "exact_name_dictionary",
    version: CUSTOMER_TRANSLITERATION_VERSION,
    status: "confirmed",
  };
}
