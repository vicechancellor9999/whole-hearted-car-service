import { transliterateCustomerName } from "./name-transliteration";

/**
 * 双语自动翻译（2026-08-12 老板要求）：客户姓名与车型中英互译。
 * 客户姓名改由版本化安全音译域处理；车辆仍使用现有本地词典。
 */

/** 判断是否含中日韩字符（决定翻译方向）。 */
export function containsCjk(text: string): boolean {
  return /[一-鿿]/.test(text);
}

/**
 * 姓名互译兼容入口。新域只接受已确认完整姓名；无法安全音译时返回 null，绝不缩成姓氏。
 */
export function translatePersonName(input: string): string | null {
  try {
    const result = transliterateCustomerName(input);
    return result.sourceScript === "zh" ? result.nameEn : result.nameZh;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 车辆品牌/车型词典
// ---------------------------------------------------------------------------

const MAKE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["丰田", "Toyota"], ["本田", "Honda"], ["日产", "Nissan"], ["铃木", "Suzuki"],
  ["马自达", "Mazda"], ["现代", "Hyundai"], ["起亚", "Kia"], ["五十铃", "Isuzu"],
  ["三菱", "Mitsubishi"], ["斯巴鲁", "Subaru"], ["大众", "Volkswagen"], ["奔驰", "Mercedes-Benz"],
  ["宝马", "BMW"], ["福特", "Ford"], ["路虎", "Land Rover"],
];

const MODEL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["卡罗拉", "Corolla"], ["海狮", "Hiace"], ["飞度", "Fit"], ["骐达", "Tiida"],
  ["奇骏", "X-Trail"], ["雨燕", "Swift"], ["吉姆尼", "Jimny"], ["途胜", "Tucson"],
  ["狮跑", "Sportage"], ["森林人", "Forester"], ["凯美瑞", "Camry"], ["思域", "Civic"],
  ["雅阁", "Accord"], ["天籁", "Teana"],
];

/** 品牌互译（Toyota ↔ 丰田）。 */
export function translateVehicleMake(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pair = MAKE_PAIRS.find(([zh, en]) => (containsCjk(trimmed) ? zh === trimmed : en.toLowerCase() === trimmed.toLowerCase()));
  return pair ? (containsCjk(trimmed) ? pair[1] : pair[0]) : null;
}

/** 车型互译（卡罗拉 ↔ Corolla）；含品牌的组合名（"丰田 卡罗拉"）拆开各翻各的。 */
export function translateVehicleModel(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const pair = MODEL_PAIRS.find(([zh, en]) => (containsCjk(trimmed) ? zh === trimmed : en.toLowerCase() === trimmed.toLowerCase()));
  if (pair) return containsCjk(trimmed) ? pair[1] : pair[0];
  // 组合名："丰田 卡罗拉" ↔ "Toyota Corolla"
  const parts = trimmed.split(/\s+/);
  if (parts.length === 2) {
    const make = translateVehicleMake(parts[0]);
    const model = translateVehicleModel(parts[1]);
    if (make || model) return [make ?? parts[0], model ?? parts[1]].join(" ");
  }
  return null;
}
