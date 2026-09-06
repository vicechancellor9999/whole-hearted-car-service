import { z } from "zod";
import type { RecordDeletionExecuteInput, RecordKind } from "@formal/modules/record-deletion/record-deletion-types";

export const DELETION_RECOVERY_CHANGED = "wh:deletion-recovery-changed";
const locator = z.object({ kind: z.enum(["personal_customer", "company_customer", "vehicle", "business_order", "inspection_report"]), recordNo: z.string().min(1).max(100) });
const inputSchema = z.object({
  root: locator, selectedRecords: z.array(locator).min(1).max(20),
  reasonCode: z.enum(["duplicate", "input_error", "test_data", "other"]), reasonNote: z.string().max(1_000).nullable(),
  confirmationRecordNo: z.string().max(100), previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).refine(value => value.confirmationRecordNo === value.root.recordNo && value.selectedRecords.some(record => record.kind === value.root.kind && record.recordNo === value.root.recordNo));
const entrySchema = z.object({ accountId: z.number().int().positive().refine(Number.isSafeInteger), input: inputSchema, createdAt: z.number().finite() });
export type DeletionRecoveryEntry = { accountId: number; input: RecordDeletionExecuteInput; createdAt: number };
const key = (accountId: number) => `wh:deletion-recovery:v1:${accountId}`;

// These are submitted-request recovery notes, never authoritative deletion facts.
export function readDeletionAttempts(accountId: number): { entries: DeletionRecoveryEntry[]; available: boolean } {
  try {
    const raw = sessionStorage.getItem(key(accountId)) ?? "[]";
    if (raw.length > 2_000_000) return { entries: [], available: false };
    const entries = z.array(entrySchema).max(200).parse(JSON.parse(raw));
    if (entries.some(entry => entry.accountId !== accountId)) return { entries: [], available: false };
    return { entries: entries.filter(entry => entry.createdAt <= Date.now() + 60_000 && entry.createdAt > Date.now() - 86_400_000), available: true };
  } catch { return { entries: [], available: false }; }
}

function write(accountId: number, entries: DeletionRecoveryEntry[]): boolean {
  try {
    sessionStorage.setItem(key(accountId), JSON.stringify(z.array(entrySchema).max(200).parse(entries)));
    window.dispatchEvent(new Event(DELETION_RECOVERY_CHANGED));
    return true;
  } catch { return false; }
}

export function rememberDeletionAttempt(accountId: number, input: RecordDeletionExecuteInput): boolean {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return false;
  const previous = readDeletionAttempts(accountId);
  if (!previous.available) return false;
  const existing = previous.entries.find(entry => entry.input.requestId === input.requestId);
  // Retrying cannot silently replace the scope/reason bound to the original request.
  if (existing && JSON.stringify(existing.input) !== JSON.stringify(parsed.data)) return false;
  return write(accountId, [...previous.entries.filter(entry => entry.input.requestId !== input.requestId), existing ?? { accountId, input: parsed.data, createdAt: Date.now() }]);
}

export function forgetDeletionAttempt(accountId: number, requestId: string): boolean {
  const previous = readDeletionAttempts(accountId);
  return previous.available && write(accountId, previous.entries.filter(entry => entry.input.requestId !== requestId));
}

export function deletionListPath(kind: RecordKind): string {
  if (kind === "inspection_report") return "/orders/inspections";
  if (kind === "business_order") return "/orders/business";
  if (kind === "vehicle") return "/vehicles";
  return "/customers";
}
