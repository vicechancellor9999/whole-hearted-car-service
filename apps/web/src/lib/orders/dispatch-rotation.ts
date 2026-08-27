/** 一键轮换派组（8/18 老板确认，8/20 收紧）：
 * - 车间一组 ⇄ 车间二组轮流派单；手动点班组卡不算；工程机械/钣金喷漆不参与。
 * - 一个单只能点一次「一键轮换」：多点一次等于没轮换，所以记录点过的单号，点过后按钮禁用。
 * - 更前置的「优先建议」= 这辆车上一单负责的班组（由调用方从工单列表算），轮换指针不受它影响。
 */
export type RotationTeam = "t1" | "t2";

const STORAGE_KEY = "wh_quick_rotation_v1";
const USED_STORAGE_KEY = "wh_quick_rotation_used_v1";

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: Record<string, unknown>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 忽略存储异常
  }
}

export function loadLastRotationTeam(): RotationTeam | null {
  const stored = readJson(STORAGE_KEY);
  const team = stored?.team;
  return team === "t1" || team === "t2" ? team : null;
}

/** 下一次轮换建议指向哪一组：与上次点击相反；从未点过 → 车间一组。 */
export function suggestRotationTeam(): RotationTeam {
  return loadLastRotationTeam() === "t1" ? "t2" : "t1";
}

/** 点「一键轮换」按钮时记录（只记录点击的时刻），并记下这张单已经用过了。 */
export function recordRotationTeam(team: RotationTeam, orderId?: string): void {
  writeJson(STORAGE_KEY, { team });
  if (orderId) {
    const used = readJson(USED_STORAGE_KEY) ?? {};
    used[orderId] = true;
    writeJson(USED_STORAGE_KEY, used);
  }
}

/** 这张单是否已经点过「一键轮换」（一个单只能点一次，8/20 老板）。 */
export function hasRotationRecordedForOrder(orderId: string): boolean {
  const used = readJson(USED_STORAGE_KEY);
  return used?.[orderId] === true;
}
