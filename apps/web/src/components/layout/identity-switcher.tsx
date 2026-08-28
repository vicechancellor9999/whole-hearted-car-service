"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Identity, Session } from "@/lib/types";
import { api, isMockApiEnabled } from "@/lib/api/client";
import { getFormalPcPolicy } from "@/lib/auth/formal-pc-access";

interface IdentitySwitcherProps {
  /** Compact mode for sidebar bottom, full mode for topbar */
  variant?: "compact" | "full";
}

const FORMAL_AUTH_ENABLED = process.env.NEXT_PUBLIC_FORMAL_AUTH !== "false";

type FormalAccount = {
  id: number;
  displayName: string;
  role: "super_admin" | "front_desk" | "owner" | "mechanic";
  delegatedPermissions: "sensitive_operations.execute"[];
};

const formalRoleLabels: Record<FormalAccount["role"], { zh: string; en: string }> = {
  super_admin: { zh: "超级管理员", en: "Super Administrator" },
  front_desk: { zh: "前台", en: "Front Desk" },
  owner: { zh: "老板视角", en: "Owner View" },
  mechanic: { zh: "维修工", en: "Mechanic" },
};

const frontendRoleCodes: Record<FormalAccount["role"], string> = {
  super_admin: "superadmin",
  front_desk: "frontdesk_admin",
  owner: "owner_readonly",
  mechanic: "mechanic",
};

function formalIdentity(account: FormalAccount): Identity {
  const role = formalRoleLabels[account.role];
  return {
    id: `account-${account.id}`,
    name: account.displayName,
    nameEn: account.displayName,
    role: frontendRoleCodes[account.role],
    roleLabel: role.zh,
    roleLabelEn: role.en,
    scope: account.role === "mechanic" ? "assigned" : "all",
    avatarColor: "#4169e1",
    initials: account.displayName.trim().slice(0, 2).toUpperCase() || "WH",
  };
}

function persistSession(session: Session): void {
  window.localStorage.setItem("wh_session", JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("wh:formal-session-changed", { detail: session }));
}

function sameIdentity(left: Identity | undefined, right: Identity): boolean {
  if (!left) return false;
  return left.id === right.id
    && left.name === right.name
    && left.nameEn === right.nameEn
    && left.role === right.role
    && left.roleLabel === right.roleLabel
    && left.roleLabelEn === right.roleLabelEn
    && left.scope === right.scope
    && left.avatarColor === right.avatarColor
    && left.initials === right.initials;
}

export function IdentitySwitcher({ variant = "full" }: IdentitySwitcherProps) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    if (FORMAL_AUTH_ENABLED) {
      void fetch("/api/formal/auth/session", { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
          if (response.status === 401) {
            window.location.assign("/login");
            return null;
          }
          if (!response.ok) throw new Error("正式会话读取失败");
          return response.json() as Promise<{ account: FormalAccount; expiresAt: string }>;
        })
        .then((payload) => {
          if (!active || !payload) return;
          const identity = formalIdentity(payload.account);
          const policy = getFormalPcPolicy(
            payload.account.role,
            payload.account.delegatedPermissions,
          );
          if (!policy.pcAccess) {
            window.location.assign("/pc-not-available");
            return;
          }
          const formalSession: Session = {
            identity,
            token: "http-only-session",
            expiresAt: payload.expiresAt,
            formal: {
              accountId: payload.account.id,
              role: payload.account.role,
              delegatedPermissions: payload.account.delegatedPermissions,
            },
          };
          document.documentElement.dataset.formalRole = payload.account.role;
          document.documentElement.dataset.formalReadOnly = policy.readOnly ? "true" : "false";
          persistSession(formalSession);
          setIdentities([identity]);
          setSession(formalSession);
        })
        .catch(console.error);
      return () => { active = false; };
    }

    const load = () => api.identities().then(async (list) => {
      if (!active) return;
      setIdentities(list);

      // Mock mode has one canonical owner identity. Any previously stored demo
      // employee is replaced instead of remaining visible as a stale account.
      const stored = typeof window !== "undefined" ? localStorage.getItem("wh_session") : null;
      let storedSession: Session | null = null;
      if (stored) {
        try {
          storedSession = JSON.parse(stored) as Session;
        } catch {
          storedSession = null;
        }
      }
      const canonical = storedSession
        ? list.find((identity) => identity.id === storedSession?.identity?.id)
        : undefined;
      if (storedSession && canonical && sameIdentity(storedSession.identity, canonical)) {
        setSession(storedSession);
      } else if (storedSession && canonical) {
        const normalizedSession: Session = {
          ...storedSession,
          identity: { ...canonical },
        };
        persistSession(normalizedSession);
        setSession(normalizedSession);
      } else if (isMockApiEnabled && list.length > 0) {
        const defaultSession = await api.previewSession(list[0].id);
        if (!active) return;
        persistSession(defaultSession);
        setSession(defaultSession);
        window.location.reload();
      }
    }).catch(console.error);
    void load();
    window.addEventListener("wh:employees-changed", load);
    return () => {
      active = false;
      window.removeEventListener("wh:employees-changed", load);
    };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSwitch = async (id: string) => {
    const s = await api.previewSession(id);
    persistSession(s);
    setSession(s);
    setOpen(false);
    window.location.reload();
  };

  const current = session?.identity;

  if (!current) return null;

  const isCompact = variant === "compact";

  if (FORMAL_AUTH_ENABLED) {
    return (
      <div className={cn("flex w-full items-center gap-2.5 rounded-lg", isCompact ? "px-2 py-2" : "px-2 py-1.5")}>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">
          {current.initials}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium leading-tight text-ink">{current.name}</div>
          <div className="truncate text-[10px] leading-tight text-ink-soft">{current.roleLabel}</div>
        </div>
        <form action="/api/formal/auth/logout" method="post">
          <button className="rounded-md px-1.5 py-1 text-[10px] font-semibold text-ink-faint hover:bg-layer-2 hover:text-ink" type="submit">退出</button>
        </form>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg transition-colors hover:bg-layer-2",
          isCompact ? "px-2 py-2" : "px-2 py-1.5"
        )}
      >
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: current.avatarColor }}
        >
          {current.initials}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium leading-tight text-ink">
            {current.name}
          </div>
          <div className="truncate text-[10px] leading-tight text-ink-soft">
            {current.roleLabel}
          </div>
        </div>
        <ChevronDown className="flex-shrink-0 text-ink-faint" size={16} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={cn(
            "absolute z-50 w-72 rounded-xl border border-line bg-card shadow-lg",
            isCompact ? "bottom-full left-0 mb-2" : "right-0 top-12"
          )}
        >
          <div className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            切换身份（预览模式）
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {identities.map((id) => (
              <button
                key={id.id}
                onClick={() => handleSwitch(id.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-layer-2",
                  current.id === id.id && "bg-[var(--wh-background-selected)]"
                )}
              >
                <div
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: id.avatarColor }}
                >
                  {id.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{id.name}</div>
                  <div className="truncate text-[10px] text-ink-soft">{id.roleLabel}</div>
                </div>
                {current.id === id.id && <Check className="flex-shrink-0 text-primary" size={16} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
