/**
 * 停车取车跟进层（2026-08-11 老板口述规则）：
 * - 车没有下一步工作安排（业务单已交单完结）→ 提醒【员工】通知客户取车，系统不直接联系客户
 * - 通知次日为宽限期；第三日取车免费；第四日起按天计费（第 N 天 = N-3 天费用）
 * - 每 3 天提醒员工发一次停车费账单，直到取车
 * 独立 overlay 存储，不改 linked-operations 状态机。
 */

export interface ParkingNotification {
  orderId: string;
  notifiedAt: string; // YYYY-MM-DD
  channel: "phone" | "whatsapp" | "sms" | "in_person";
  note: string;
  actorName: string;
}

export interface ParkingBillSend {
  orderId: string;
  sentAt: string;
  note: string;
  actorName: string;
}

interface ParkingFollowUpState {
  revision: number;
  notifications: ParkingNotification[];
  billSends: ParkingBillSend[];
}

const STORAGE_KEY = "wh_parking_followup_v1";
const DAY_MS = 86_400_000;
const JAMAICA_TIME_ZONE = "America/Jamaica";
const JAMAICA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: JAMAICA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function emptyState(): ParkingFollowUpState {
  return { revision: 1, notifications: [], billSends: [] };
}

function loadState(): ParkingFollowUpState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as ParkingFollowUpState;
    if (!Array.isArray(parsed.notifications) || !Array.isArray(parsed.billSends)) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

function saveState(state: ParkingFollowUpState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function mutate<T>(fn: (state: ParkingFollowUpState) => T): T {
  const state = loadState();
  const result = fn(state);
  state.revision += 1;
  saveState(state);
  return result;
}

export class ParkingFollowUpDomainError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ParkingFollowUpDomainError";
  }
}

export interface ParkingFollowUpSnapshot {
  revision: number;
  notifications: ParkingNotification[];
  billSends: ParkingBillSend[];
}

export function readParkingFollowUpSnapshot(): ParkingFollowUpSnapshot {
  const state = loadState();
  return {
    revision: state.revision,
    notifications: state.notifications.map((item) => ({ ...item })),
    billSends: state.billSends.map((item) => ({ ...item })),
  };
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ParkingFollowUpDomainError(`${label}不能为空`, 400);
  return value.trim();
}

export function parkingLocalCalendarDate(dayOffset = 0, nowMs: number = Date.now()): string {
  const parts = new Map(
    JAMAICA_DATE_FORMATTER.formatToParts(new Date(nowMs)).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.get("year"));
  const month = Number(parts.get("month"));
  const day = Number(parts.get("day"));
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

/** 记录员工已通知客户取车：从通知日起算宽限与计费。 */
export function recordParkingNotification(
  orderId: string,
  channel: ParkingNotification["channel"],
  note: string,
  actorName: string,
): ParkingNotification {
  return mutate((state) => {
    if (state.notifications.some((item) => item.orderId === orderId)) {
      throw new ParkingFollowUpDomainError("该业务单已记录过取车通知", 409);
    }
    const entry: ParkingNotification = {
      orderId: requireText(orderId, "业务单"),
      notifiedAt: parkingLocalCalendarDate(),
      channel,
      note: requireText(note, "通知内容"),
      actorName: requireText(actorName, "经办人"),
    };
    state.notifications.push(entry);
    return { ...entry };
  });
}

/** 记录员工已发送停车费账单：不重置计费，只留痕。 */
export function recordParkingBillSent(
  orderId: string,
  note: string,
  actorName: string,
): ParkingBillSend {
  return mutate((state) => {
    if (!state.notifications.some((item) => item.orderId === orderId)) {
      throw new ParkingFollowUpDomainError("尚未记录取车通知，不能发账单", 409);
    }
    const entry: ParkingBillSend = {
      orderId: requireText(orderId, "业务单"),
      sentAt: new Date().toISOString(),
      note: requireText(note, "账单说明"),
      actorName: requireText(actorName, "经办人"),
    };
    state.billSends.push(entry);
    return { ...entry };
  });
}

/** 通知后的自然日数（通知当天 = 0）。 */
export function parkingElapsedDays(notifiedAt: string, nowMs: number = Date.now()): number {
  const jamaicaToday = Date.parse(`${parkingLocalCalendarDate(0, nowMs)}T00:00:00.000Z`);
  const notifiedDate = Date.parse(`${notifiedAt}T00:00:00.000Z`);
  return Math.max(0, Math.floor((jamaicaToday - notifiedDate) / DAY_MS));
}

/** 计费天数：第三日（elapsed=2）仍免费，第四日（elapsed=3）起 1 天，按天累计。 */
export function parkingBillableDays(notifiedAt: string, nowMs: number = Date.now()): number {
  return Math.max(0, parkingElapsedDays(notifiedAt, nowMs) - 2);
}

/** 今日是否该提醒员工发账单：计费开始后每 3 天一次（elapsed = 3, 6, 9…）。 */
export function parkingReminderDue(notifiedAt: string, nowMs: number = Date.now()): boolean {
  const elapsed = parkingElapsedDays(notifiedAt, nowMs);
  return elapsed >= 3 && (elapsed - 3) % 3 === 0;
}

/** 宽限状态文案。 */
export function parkingGraceLabel(notifiedAt: string, nowMs: number = Date.now()): string {
  const elapsed = parkingElapsedDays(notifiedAt, nowMs);
  if (elapsed <= 1) return "宽限期（次日）";
  if (elapsed === 2) return "宽限最后一日（今日取车免费）";
  return "已超宽限，计费中";
}
