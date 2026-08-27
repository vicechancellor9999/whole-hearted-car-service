"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { CustomerRecord } from "@/lib/customers/types";
import type { OtpVerificationRecord } from "@/lib/customers/verification-types";
import { formatPhoneE164 } from "@/lib/customers/phone";
import { Dialog } from "@/components/ui/dialog";

type OtpDialogMode = "invalidate" | "verify";

interface OtpVerificationDialogProps {
  customer: CustomerRecord;
  activeRecord?: OtpVerificationRecord;
  mode: OtpDialogMode;
  boundSessionKey: string;
  onClose: () => void;
  onChanged: (customer: CustomerRecord) => void;
  onDone: (customer: CustomerRecord) => void;
  returnFocusElement?: HTMLElement | null;
}

function mutationId(operation: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `customer-ui-${operation}-${suffix}`;
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "OTP 操作失败，请重试";
}

export function OtpVerificationDialog({
  customer,
  activeRecord,
  mode,
  boundSessionKey,
  onClose,
  onChanged,
  onDone,
  returnFocusElement,
}: OtpVerificationDialogProps) {
  const [reason, setReason] = useState("");
  const pendingRecord = mode === "verify" && activeRecord && !activeRecord.verifiedAt
    ? activeRecord
    : undefined;
  const [phone, setPhone] = useState(
    pendingRecord
      ? formatPhoneE164(pendingRecord.phoneE164)
      : customer.phone ? formatPhoneE164(customer.phone) : "",
  );
  const [requestedCustomer, setRequestedCustomer] = useState<CustomerRecord | null>(null);
  const initialPendingId = pendingRecord?.id ?? null;
  const [otpRecordId, setOtpRecordId] = useState<string | null>(initialPendingId);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidateMutationId = useRef(mutationId("otp-invalidate"));
  const requestMutationId = useRef(mutationId("otp-request"));
  const verifyMutationId = useRef(mutationId("otp-verify"));

  const assertBoundSession = () => {
    const raw = window.localStorage.getItem("wh_session");
    let key = "invalid";
    try {
      const session = raw ? JSON.parse(raw) as { identity?: { id?: unknown; role?: unknown } } : null;
      key = raw ? `${String(session?.identity?.id ?? "invalid")}:${String(session?.identity?.role ?? "invalid")}` : "anonymous";
    } catch {
      key = "invalid";
    }
    if (key !== boundSessionKey) throw new Error("会话已变化，请关闭对话框后重新操作");
  };

  const invalidate = async () => {
    if (!activeRecord?.verifiedAt || activeRecord.invalidatedAt) {
      setError("只能作废当前已验证且尚未作废的 OTP 记录");
      return;
    }
    if (!reason.trim()) {
      setError("请填写作废原因");
      return;
    }
    setPending(true);
    setError(null);
    try {
      assertBoundSession();
      const next = await api.customers.invalidateOtp(customer.id, {
        otpRecordId: activeRecord.id,
        reason: reason.trim(),
        clientMutationId: invalidateMutationId.current,
      });
      onDone(next);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  };

  const request = async () => {
    if (!phone.trim()) {
      setError("请填写可联系的验证号码");
      return;
    }
    setPending(true);
    setError(null);
    try {
      assertBoundSession();
      const next = await api.customers.requestOtp(customer.id, {
        phoneE164: phone.trim(),
        clientMutationId: requestMutationId.current,
      });
      const record = next.verificationArchive.otpRecords.at(-1);
      if (!record || record.verifiedAt) throw new Error("未取得待验证的 OTP 记录，请重试");
      setRequestedCustomer(next);
      setOtpRecordId(record.id);
      setPhone(formatPhoneE164(record.phoneE164));
      onChanged(next);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  };

  const verify = async () => {
    if (!otpRecordId) {
      setError("请先发送验证码");
      return;
    }
    if (!code.trim()) {
      setError("请输入验证码");
      return;
    }
    setPending(true);
    setError(null);
    try {
      assertBoundSession();
      const next = await api.customers.verifyOtp((requestedCustomer ?? customer).id, {
        otpRecordId,
        code: code.trim(),
        clientMutationId: verifyMutationId.current,
      });
      onDone(next);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      title={mode === "invalidate" ? "标记 OTP 号码联系不上" : "重新 OTP 验证"}
      onClose={onClose}
      dataTestId="otp-verification-dialog"
      closeLabel="关闭 OTP 验证"
      returnFocusElement={returnFocusElement}
      className="w-[min(520px,calc(100vw-2rem))]"
    >
      <div className="space-y-4 p-5">
        {mode === "invalidate" ? (
          <>
            <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              当前验证号码：<strong className="font-mono">{activeRecord ? formatPhoneE164(activeRecord.phoneE164) : "—"}</strong>。作废后保留原记录，并要求客户提供能联系得上的号码重新验证。
            </div>
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">
              作废原因
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                placeholder="例如：多次拨打无法接通"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => void invalidate()}
              className="min-h-10 w-full rounded-xl bg-rose-600 px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {pending ? "正在作废…" : "确认作废"}
            </button>
          </>
        ) : (
          <>
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">
              验证号码
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={otpRecordId !== null}
                inputMode="tel"
                className="mt-1 min-h-10 w-full rounded-xl border border-line bg-white px-3 font-mono text-sm disabled:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:disabled:bg-slate-900"
                placeholder="+1 876 555 0000"
              />
            </label>
            {otpRecordId === null ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void request()}
                className="min-h-10 w-full rounded-xl bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {pending ? "正在发送…" : "发送验证码"}
              </button>
            ) : (
              <>
                <p className="rounded-xl border border-primary-100 bg-primary-50 p-3 text-xs text-primary-800 dark:border-primary-500/30 dark:bg-primary/10 dark:text-primary-200">
                  纯 Mock 演示验证码：<strong className="font-mono text-sm">123456</strong>
                </p>
                <label className="block text-xs font-semibold text-ink dark:text-slate-200">
                  验证码
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="mt-1 min-h-10 w-full rounded-xl border border-line bg-white px-3 font-mono text-sm tracking-[0.35em] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                </label>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void verify()}
                  className="min-h-10 w-full rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {pending ? "正在验证…" : "确认验证"}
                </button>
              </>
            )}
          </>
        )}
        {error ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</p> : null}
      </div>
    </Dialog>
  );
}
