import { expect, test } from "@playwright/test";
import { mockTranslate, parseChargeEntryInput, parseQuickOrderInput, zhNumeralToNumber } from "../../src/lib/orders/nl-parse";

// 老板 2026-08-16 真实例句（宝马单）——拆单器的验收标准
const BOSS_EXAMPLE = `水泵漏防冻液 需要更换水泵，再加防冻液工时25,000
全车水管老化，需要更换所有水管。工时85,000
前左右刹车片和前左右刹车片传感器，前左右刹车盘 工时50,000
后左右刹车片和后左右刹车片后传感器，后左右刹车盘 工时50,000
更换涡轮增压水管 工时80,000
更换气门室盖垫漏油 更换气门室盖垫 工时35,000
更换刹车油 工时10000
需要清洗剂八瓶 工时免费。`;

test("中文数字转换", () => {
  expect(zhNumeralToNumber("八")).toBe(8);
  expect(zhNumeralToNumber("两")).toBe(2);
  expect(zhNumeralToNumber("十")).toBe(10);
  expect(zhNumeralToNumber("十五")).toBe(15);
  expect(zhNumeralToNumber("二十五")).toBe(25);
  expect(zhNumeralToNumber("8")).toBe(8);
});

test("老板宝马例句：八行全拆出，工时分类与金额正确", () => {
  const items = parseQuickOrderInput(BOSS_EXAMPLE);
  const labor = items.filter((i) => i.category === "labor");
  const parts = items.filter((i) => i.category === "parts");
  expect(labor.map((i) => i.unitPriceJmd)).toEqual([25000, 85000, 50000, 50000, 80000, 35000, 10000]);
  expect(labor.reduce((sum, i) => sum + i.unitPriceJmd * i.quantity, 0)).toBe(335000);
  // 刹车清单行拆出 3 条配件待报价 + 清洗剂八瓶工时免费 → 配件 8 瓶 × 0
  expect(parts.filter((p) => p.pendingQuote)).toHaveLength(6); // 前/后两条刹车清单行各拆 3 条
  const cleaner = parts.find((p) => !p.pendingQuote);
  expect(cleaner?.quantity).toBe(8);
  expect(cleaner?.unitPriceJmd).toBe(0);
  // 每行都有英文翻译
  for (const item of items) expect(item.descEn.length).toBeGreaterThan(0);
});

test("翻译词典命中", () => {
  expect(mockTranslate("更换刹车油")).toBe("Replace brake fluid");
  expect(mockTranslate("更换气门室盖垫")).toContain("valve cover gasket");
  expect(mockTranslate("前左右刹车片")).toContain("Front left & right");
  // 未命中的留占位提示人工补
  expect(mockTranslate("玄学项目")).toContain("[待翻译]");
});

test("无价格无工时词的实物清单 → 配件待报价", () => {
  const items = parseQuickOrderInput("水泵一个\n防冻液两瓶");
  expect(items[0].category).toBe("parts");
  expect(items[0].pendingQuote).toBe(true);
  expect(items[1].quantity).toBe(2);
});

test("空输入返回空数组", () => {
  expect(parseQuickOrderInput("")).toHaveLength(0);
  expect(parseQuickOrderInput("\n\n  \n")).toHaveLength(0);
});

test("自然语言同时拆分收费项目和版本化备注，备注行不会误生成收费项目", () => {
  const result = parseChargeEntryInput(`发动机诊断工时 10000
客户反馈：故障灯偶发点亮
施工说明：先读取故障码再确认维修范围
责任说明：客户自带配件不提供配件保修
提前告知：追加维修须再次确认`);

  expect(result.items).toHaveLength(1);
  expect(result.items[0].descZh).toBe("发动机诊断");
  expect(result.notes.map((note) => [note.kind, note.contentZh])).toEqual([
    ["customer_concern", "故障灯偶发点亮"],
    ["work_instruction", "先读取故障码再确认维修范围"],
    ["liability_notice", "客户自带配件不提供配件保修"],
    ["liability_notice", "追加维修须再次确认"],
  ]);
});

test("拆开症状与维修动作：名称=更换水泵，备注=水泵漏防冻液，还需要加防冻液（8/18 老板）", () => {
  const items = parseQuickOrderInput("水泵漏防冻液 需要更换水泵，再加防冻液 工时25,000");
  expect(items).toHaveLength(1);
  expect(items[0].descZh).toBe("更换水泵");
  expect(items[0].remarkZh).toBe("水泵漏防冻液，再加防冻液");
  expect(items[0].unit).toBe("工时");
  expect(items[0].unitPriceJmd).toBe(25_000);
});

test("无「需要」的写法也拆症状：更换气门室盖垫漏油 更换气门室盖垫 → 名称=更换气门室盖垫，备注=气门室盖垫漏油（8/18）", () => {
  const items = parseQuickOrderInput("更换气门室盖垫漏油 更换气门室盖垫 工时35,000");
  expect(items).toHaveLength(1);
  expect(items[0].descZh).toBe("更换气门室盖垫");
  expect(items[0].remarkZh).toBe("气门室盖垫漏油");
  expect(items[0].unitPriceJmd).toBe(35_000);
});

test("配件清单+工时费拆成 1 工时 + N 配件（8/18）", () => {
  const items = parseQuickOrderInput("后左右刹车片和后左右刹车片传感器，后左右刹车盘 工时费 50000");
  const labor = items.filter((item) => item.category === "labor");
  const parts = items.filter((item) => item.category === "parts");
  expect(labor).toHaveLength(1);
  expect(labor[0].descZh).toBe("更换后左右刹车片、后左右刹车片传感器、后左右刹车盘");
  expect(labor[0].unitPriceJmd).toBe(50_000);
  expect(parts.map((item) => item.descZh)).toEqual(["后左右刹车片", "后左右刹车片传感器", "后左右刹车盘"]);
  expect(parts.every((item) => item.pendingQuote)).toBe(true);
});

test("正式收费本地回退保留短金额和小数，但不把数量或车型年份当价格", () => {
  const result = parseChargeEntryInput("诊断工时 800\n清洗剂2瓶 单价12.50\n清洗剂5000瓶\n2017款车辆检查工时待报价");
  expect(result.items.map(item => [item.unitPriceJmd, item.quantity, item.pendingQuote])).toEqual([
    [800, 1, false], [12.5, 2, false], [0, 5000, true], [0, 1, true],
  ]);
});

test("正式收费工时免费不等于清洗剂免费，明确免费配件仍是0元", () => {
  const result = parseChargeEntryInput("清洗剂八瓶 工时免费\n检查工时免费\n机油滤芯1件 免费\n清洗剂1瓶 0元");
  expect(result.items.map(item => [item.category, item.pendingQuote, item.unitPriceJmd])).toEqual([
    ["parts", true, 0], ["labor", false, 0], ["parts", false, 0], ["parts", false, 0],
  ]);
  expect(result.items[0].remarkZh).toContain("工时免费");
});

test("正式收费不把总价或多项混合报价当作某个项目单价", () => {
  const result = parseChargeEntryInput("清洗剂2瓶 合计800元\n诊断工时800元 配件1200元");
  expect(result.items.every(item => item.pendingQuote)).toBe(true);
  expect(JSON.stringify(result)).toContain("800");
  expect(JSON.stringify(result)).toContain("1200");
});
