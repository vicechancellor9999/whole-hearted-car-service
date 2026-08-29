"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Identity, Session } from "@/lib/types";
import { api, isMockApiEnabled } from "@/lib/api/client";
import { getFormalPcPolicy } from "@/lib/auth/formal-pc-access";
import { useI18n } from "@/lib/i18n/language";
import { AccountSettingsPopover } from "./account-settings-popover";

interface IdentitySwitcherProps {
  /** Compact mode for sidebar bottom, full mode for topbar */
  variant?: "compact" | "full";
  surface?: "desktop" | "drawer";
  collapsed?: boolean;
}

const FORMAL_AUTH_ENABLED = process.env.NEXT_PUBLIC_FORMAL_AUTH !== "false";

type FormalAccount = {
  id: number;
  displayName: string;
  role: "super_admin" | "front_desk" | "owner" | "mechanic";
  delegatedPermissions: "sensitive_operations.execute"[];
  uiLanguage?: "zh" | "en";
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

export function IdentitySwitcher({
  variant = "full",
  surface = "desktop",
  collapsed = false,
}: IdentitySwitcherProps) {
  const { setLanguage } = useI18n();
  const router = useRouter();
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let active = true;
    if (FORMAL_AUTH_ENABLED) {
      void fetch("/api/formal/auth/session", { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
          if (response.status === 401) {
            router.replace("/login");
            return null;
          }
          if (!response.ok) throw new Error("正式会话读取失败");
          return response.json() as Promise<{ account: FormalAccount; expiresAt: string }>;
        })
        .then((payload) => {
          if (!active || !payload) return;
          setLanguage(payload.account.uiLanguage ?? "zh");
          const identity = formalIdentity(payload.account);
          const policy = getFormalPcPolicy(
            payload.account.role,
            payload.account.delegatedPermissions,
          );
          if (!policy.pcAccess) {
            router.replace(payload.account.role === "mechanic" ? "/mechanic" : "/pc-not-available");
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
  }, [router, setLanguage]);

  const handleSwitch = async (id: string) => {
    const s = await api.previewSession(id);
    persistSession(s);
    setSession(s);
    window.location.reload();
  };

  const current = session?.identity;

  if (!current) return null;

  const isCompact = variant === "compact";

  return (
    <AccountSettingsPopover
      current={current}
      identities={identities}
      formalAuthEnabled={FORMAL_AUTH_ENABLED}
      collapsed={isCompact && collapsed}
      surface={surface}
      onSwitchIdentity={(id) => void handleSwitch(id)}
    />
  );
}
