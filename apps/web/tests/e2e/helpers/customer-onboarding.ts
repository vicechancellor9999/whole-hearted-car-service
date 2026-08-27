import { expect, type Page } from "@playwright/test";
import type { MockCustomerVehicleE2EScenario } from "../../../src/lib/api/mock-customers";

type OnboardingIdentity = "superadmin";

const identities = {
  superadmin: {
    id: "emp-001", name: "超级管理员", nameEn: "Super Admin", role: "superadmin",
    roleLabel: "超级管理员", roleLabelEn: "Super Admin", scope: "all",
    avatarColor: "#465fff", initials: "SA",
  },
} as const;

export async function useOnboardingIdentity(
  page: Page,
  identity: OnboardingIdentity,
  scenario?: MockCustomerVehicleE2EScenario,
): Promise<void> {
  const selected = identities[identity];
  const marker = `wh_customer_vehicle_e2e_reset_${Date.now()}_${Math.random()}`;
  const session = {
    identity: selected,
    token: `offline-${selected.id}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  await page.addInitScript(
    ({ serializedSession, onboardingScenario, resetMarker }) => {
      localStorage.setItem("wh_session", serializedSession);
      if (sessionStorage.getItem(resetMarker) !== "done") {
        localStorage.removeItem("wh_customer_vehicle_mock_v1");
        sessionStorage.setItem(resetMarker, "done");
      }
      (window as typeof window & { __WH_CUSTOMERS_TEST_SCENARIO__?: unknown })
        .__WH_CUSTOMERS_TEST_SCENARIO__ = onboardingScenario;
    },
    {
      serializedSession: JSON.stringify(session),
      onboardingScenario: scenario,
      resetMarker: marker,
    },
  );
}

export async function findCustomerIdByPhone(page: Page, phone: string): Promise<string> {
  const normalized = `+${phone.replace(/\D/g, "")}`;
  const read = () => page.evaluate(({ storageKey, expectedPhone }) => {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const envelope = JSON.parse(raw) as { state?: { customers?: Array<{ id?: unknown; phone?: unknown }> } };
      const match = envelope.state?.customers?.find((customer) => customer.phone === expectedPhone);
      return typeof match?.id === "string" ? match.id : null;
    }, { storageKey: "wh_customer_vehicle_mock_v1", expectedPhone: normalized });
  await expect.poll(read, { message: `customer with primary phone ${normalized}`, timeout: 8_000 }).not.toBeNull();
  return (await read())!;
}
