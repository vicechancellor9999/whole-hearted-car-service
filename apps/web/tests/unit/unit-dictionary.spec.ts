import { expect, test } from "@playwright/test";
import {
  addChargeUnit,
  loadChargeUnits,
  removeChargeUnit,
  updateChargeUnit,
} from "../../src/lib/billing/unit-dictionary";
import {
  addPaymentMethod,
  loadPaymentMethods,
  removePaymentMethod,
  updatePaymentMethod,
} from "../../src/lib/payments/method-dictionary";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("收费单位字典有标准单位，并支持新增、修改和删除自定义单位", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage(), dispatchEvent: () => true },
  });
  try {
    expect(loadChargeUnits().map((entry) => entry.zh)).toEqual(["工时", "个", "项", "次", "套"]);
    const added = addChargeUnit("桶", "pail");
    expect(loadChargeUnits()).toContainEqual(added);
    expect(updateChargeUnit(added.id, "桶装", "pail")).toMatchObject({ zh: "桶装" });
    removeChargeUnit(added.id);
    expect(loadChargeUnits().some((entry) => entry.id === added.id)).toBe(false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("收费单位字典拒绝空白和重名", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage(), dispatchEvent: () => true },
  });
  try {
    expect(() => addChargeUnit(" ", "blank")).toThrow(/不能为空/);
    expect(() => addChargeUnit("工时", "hour")).toThrow(/已存在/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("支付方式字典支持修改标准项及新增、修改、删除自定义项", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: memoryStorage(), dispatchEvent: () => true },
  });
  try {
    expect(loadPaymentMethods().map((entry) => entry.zh)).toEqual(["刷卡", "现金", "银行转账-NCB"]);
    expect(updatePaymentMethod("card", "银行卡", "Card")).toMatchObject({ zh: "银行卡" });
    const added = addPaymentMethod("支票", "Cheque");
    expect(updatePaymentMethod(added.value, "公司支票", "Company cheque")).toMatchObject({ zh: "公司支票" });
    removePaymentMethod(added.value);
    expect(loadPaymentMethods().some((entry) => entry.value === added.value)).toBe(false);
    expect(() => removePaymentMethod("cash")).toThrow(/不能删除/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
