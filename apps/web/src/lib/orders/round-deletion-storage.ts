import { z } from "zod";

const id = z.number().int().positive().refine(Number.isSafeInteger);
const attemptSchema = z.object({
  accountId: id, businessOrderId: id, roundId: id, roundNo: id.min(2), createdAt: z.number().finite(),
  status: z.enum(["pending", "unconfirmed", "completed"]), error: z.string().max(4000).optional(),
  input: z.object({
    action: z.literal("delete_invalid_after_sales"), repairRoundVersion: id,
    previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    reasonCode: z.enum(["duplicate", "input_error", "test_data", "other"]), reasonNote: z.string().max(1000),
    confirmationRecordNo: z.string().min(1).max(100), requestId: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  }),
}).refine(value => value.input.confirmationRecordNo.endsWith(`/R${value.roundNo}`));
export type RoundDeletionAttempt = z.infer<typeof attemptSchema>;
const key = (accountId: number, businessOrderId: number) => `wh:round-deletion:v1:${accountId}:${businessOrderId}`;

// Recovery notes are not deletion facts. A refresh never executes a request.
export function readRoundDeletionAttempt(accountId: number, businessOrderId: number): { attempt: RoundDeletionAttempt | null; available: boolean } {
  try {
    const raw = sessionStorage.getItem(key(accountId, businessOrderId)) ?? "null";
    if (raw.length > 32_000) return { attempt: null, available: false };
    const value: unknown = JSON.parse(raw);
    if (value === null) return { attempt: null, available: true };
    const parsed = attemptSchema.safeParse(value);
    if (!parsed.success || parsed.data.accountId !== accountId || parsed.data.businessOrderId !== businessOrderId) return { attempt: null, available: false };
    if (parsed.data.createdAt <= Date.now() - 86_400_000 || parsed.data.createdAt > Date.now() + 60_000) return { attempt: null, available: true };
    return { attempt: parsed.data.status === "pending" ? { ...parsed.data, status: "unconfirmed" } : parsed.data, available: true };
  } catch { return { attempt: null, available: false }; }
}

export function saveRoundDeletionAttempt(attempt: RoundDeletionAttempt, onlyIfExisting = false): boolean {
  try {
    const parsed = attemptSchema.parse(attempt);
    const prior = readRoundDeletionAttempt(parsed.accountId, parsed.businessOrderId);
    if (!prior.available) return false;
    if (onlyIfExisting && !prior.attempt) return true; // A late response cannot resurrect a dismissed reminder.
    if (prior.attempt && JSON.stringify(prior.attempt.input) !== JSON.stringify(parsed.input)) return false;
    sessionStorage.setItem(key(parsed.accountId, parsed.businessOrderId), JSON.stringify(parsed));
    return true;
  } catch { return false; }
}

export function clearRoundDeletionAttempt(attempt: RoundDeletionAttempt): boolean {
  try {
    const prior = readRoundDeletionAttempt(attempt.accountId, attempt.businessOrderId);
    if (!prior.available) return false;
    if (prior.attempt && prior.attempt.input.requestId !== attempt.input.requestId) return false;
    sessionStorage.setItem(key(attempt.accountId, attempt.businessOrderId), "null");
    return true;
  } catch { return false; }
}
