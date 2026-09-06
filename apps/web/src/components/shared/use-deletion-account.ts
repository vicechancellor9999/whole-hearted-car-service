"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { withRequestDeadline } from "@/lib/api/request-deadline";

export function useDeletionAccount() {
  const [account, setAccount] = useState<{ id: number; generation: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const reload = useCallback(() => {
    const current = ++generation.current;
    setAccount(null);
    setError(null);
    void withRequestDeadline(async signal => {
      const response = await fetch("/api/formal/auth/session", { credentials: "same-origin", cache: "no-store", signal });
      if (!response.ok) throw new Error("无法确认当前账号，请重新读取删除权限。");
      const payload = await response.json() as { account?: { id?: unknown; role?: unknown } };
      signal.throwIfAborted();
      const { id, role } = payload.account ?? {};
      return typeof id === "number" && Number.isSafeInteger(id) && id > 0 && (role === "super_admin" || role === "front_desk") ? id : null;
    }, 15_000, "账号读取超时，可以重新读取删除权限。")
      .then(id => { if (current === generation.current) setAccount(id ? { id, generation: current } : null); })
      .catch(reason => { if (current === generation.current) setError(reason instanceof Error ? reason.message : "账号读取失败"); });
  }, []);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => { if (mounted) reload(); });
    window.addEventListener("wh:formal-session-changed", reload);
    return () => { mounted = false; generation.current += 1; window.removeEventListener("wh:formal-session-changed", reload); };
  }, [reload]);
  const isCurrentAccount = useCallback(() => Boolean(account && account.generation === generation.current), [account]);
  return { accountId: account?.id ?? null, error, reload, isCurrentAccount };
}
