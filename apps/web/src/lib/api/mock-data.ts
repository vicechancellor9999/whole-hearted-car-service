// ============================================================
// Mock 数据层 — 按截图精确还原
// ============================================================

import type {
  Identity,
  Session,
} from "../types";
import { loadCustomEmployeeIdentities } from "../employees/employee-directory";

// ----------------------------------------------------------
// 员工身份
// ----------------------------------------------------------

const IDENTITY_CATALOG: ReadonlyArray<Readonly<Identity>> = Object.freeze(([
  {
    id: "emp-001",
    name: "超级管理员",
    nameEn: "Super Admin",
    role: "superadmin",
    roleLabel: "超级管理员",
    roleLabelEn: "Super Admin",
    scope: "all",
    avatarColor: "#465fff",
    initials: "SA",
  },
] satisfies Identity[]).map((identity) => Object.freeze(identity)));

function cloneIdentity(identity: Readonly<Identity>): Identity {
  return { ...identity };
}

export function mockIdentities(): Identity[] {
  return [...IDENTITY_CATALOG.map(cloneIdentity), ...loadCustomEmployeeIdentities()];
}

/** Reads the private immutable catalog without trusting the public UI list getter. */
export function canonicalMockIdentitySnapshot(employeeId: string): Identity | null {
  const identity = mockIdentities().find((candidate) => candidate.id === employeeId);
  return identity ? cloneIdentity(identity) : null;
}

export function mockSessionPreview(employeeId: string): Session {
  const identities = mockIdentities();
  const catalogIdentity = identities.find((candidate) => candidate.id === employeeId)
    ?? identities[0];
  if (!catalogIdentity) throw new Error("mock identity catalog is empty");
  const who = cloneIdentity(catalogIdentity);
  const session: Session = {
    identity: who,
    token: `offline-${who.id}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  if (typeof window !== "undefined") {
    localStorage.setItem("wh_session", JSON.stringify(session));
  }
  return session;
}
