import { expect, test } from "@playwright/test";
import { APPROVED_FULL_NAME_PAIRS } from "../../src/lib/customers/name-dictionary";
import {
  CustomerNameTransliterationError,
  splitChinesePersonalName,
  transliterateCustomerName,
} from "../../src/lib/customers/name-transliteration";

test("formats Chinese surnames and given names without tone marks", () => {
  expect(transliterateCustomerName("陈志远")).toMatchObject({
    sourceScript: "zh",
    sourceValue: "陈志远",
    nameZh: "陈志远",
    nameEn: "Chen Zhiyuan",
    method: "offline_pinyin",
    version: "customer-name-v1",
    status: "confirmed",
  });
  expect(transliterateCustomerName("欧阳娜娜").nameEn).toBe("Ouyang Nana");
});

test("recognizes compound surnames before one-character surnames", () => {
  expect(splitChinesePersonalName("欧阳娜娜")).toEqual({ surname: "欧阳", givenName: "娜娜" });
  expect(splitChinesePersonalName("司马光")).toEqual({ surname: "司马", givenName: "光" });
});

test("uses an exact full-name dictionary for English input", () => {
  expect(transliterateCustomerName("  alicia BENNETT ")).toMatchObject({
    sourceScript: "en",
    sourceValue: "Alicia Bennett",
    nameZh: "艾丽西亚·贝内特",
    nameEn: "Alicia Bennett",
    method: "exact_name_dictionary",
  });
});

test("returns approved Chinese transliterations for bulk and organization names", () => {
  const approvedPairs = [
    ["Andre Brown", "安德烈·布朗"],
    ["Shanice Campbell", "沙妮丝·坎贝尔"],
    ["Dwayne Morgan", "德韦恩·摩根"],
    ["Keisha Thompson", "凯莎·汤普森"],
    ["Ricardo Williams", "里卡多·威廉姆斯"],
    ["Nadine Clarke", "纳丁·克拉克"],
    ["Omar Foster", "奥马尔·福斯特"],
    ["Tanya Blake", "坦娅·布莱克"],
    ["Delroy Gordon", "德尔罗伊·戈登"],
    ["Simone Henry", "西蒙娜·亨利"],
    ["Kirk Douglas", "柯克·道格拉斯"],
    ["Marcia Reid", "玛西娅·里德"],
    ["Anthony Stewart", "安东尼·斯图尔特"],
    ["Janet Morrison", "珍妮特·莫里森"],
    ["Barrington Lewis", "巴林顿·刘易斯"],
    ["Collette Pryce", "科莱特·普赖斯"],
    ["Devon McKenzie", "德文·麦肯齐"],
    ["Althea Robinson", "阿尔西娅·罗宾逊"],
    ["Courtney Bailey", "考特尼·贝利"],
    ["Yvonne Grant", "伊冯娜·格兰特"],
    ["Dwayne Clarke", "德韦恩·克拉克"],
    ["Rochelle Grant", "罗谢尔·格兰特"],
  ] as const;

  for (const [nameEn, nameZh] of approvedPairs) {
    expect(transliterateCustomerName(nameEn)).toMatchObject({
      sourceScript: "en",
      nameZh,
      nameEn,
      method: "exact_name_dictionary",
    });
    expect(transliterateCustomerName(nameZh)).toMatchObject({
      sourceScript: "zh",
      nameZh,
      nameEn,
      method: "exact_name_dictionary",
    });
  }
});

test("keeps Chinese personal names surname-first for Chinese and exact English input", () => {
  const canonicalPairs = [
    ["陈美玲", "Chen Meiling"],
    ["王小梅", "Wang Xiaomei"],
    ["李志强", "Li Zhiqiang"],
  ] as const;

  for (const [nameZh, nameEn] of canonicalPairs) {
    expect(transliterateCustomerName(nameZh)).toMatchObject({
      sourceScript: "zh",
      sourceValue: nameZh,
      nameZh,
      nameEn,
      method: "exact_name_dictionary",
    });
    expect(transliterateCustomerName(nameEn)).toMatchObject({
      sourceScript: "en",
      sourceValue: nameEn,
      nameZh,
      nameEn,
      method: "exact_name_dictionary",
    });
  }
});

test("rejects legacy Western-order aliases for Chinese personal names", () => {
  for (const value of ["Meiling Chen", "Xiaomei Wang", "Zhiqiang Li"]) {
    expect(() => transliterateCustomerName(value)).toThrow(
      new CustomerNameTransliterationError(
        "当前纯 Mock 音译库没有该完整姓名",
        "CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED",
      ),
    );
  }
});

test("never reduces an unknown English full name to one surname character", () => {
  for (const value of ["Jason Wong", "Alice Chin", "Vincent Chang"]) {
    expect(() => transliterateCustomerName(value)).toThrow(
      new CustomerNameTransliterationError(
        "当前纯 Mock 音译库没有该完整姓名",
        "CUSTOMER_NAME_TRANSLITERATION_UNSUPPORTED",
      ),
    );
  }
});

test("rejects blank, mixed-script, numeric, and unsupported Chinese input", () => {
  for (const value of ["", "王 David", "Alicia 2", "陈🙂"]) {
    expect(() => transliterateCustomerName(value)).toThrow(
      CustomerNameTransliterationError,
    );
  }
});

test("every approved full-name pair round-trips through one canonical tuple", () => {
  for (const pair of APPROVED_FULL_NAME_PAIRS) {
    const fromEnglish = transliterateCustomerName(pair.en);
    expect(fromEnglish.nameZh).toBe(pair.zh);
    expect(fromEnglish.nameEn).toBe(pair.en);

    const fromChinese = transliterateCustomerName(pair.zh);
    expect(fromChinese.nameZh).toBe(pair.zh);
    expect(fromChinese.nameEn).toBe(pair.en);
  }
});
