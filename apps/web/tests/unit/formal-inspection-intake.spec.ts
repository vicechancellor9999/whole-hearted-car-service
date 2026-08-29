import { expect, test } from "@playwright/test";
import {
  activeStaffForInspectionTeam,
  normalizeInspectionPlateQuery,
  retainInspectorForTeam,
} from "../../src/lib/orders/formal-inspection-intake";

const staff = [
  { id: 1, fullName: "张真真", currentTeamId: 7, status: "active" as const },
  { id: 2, fullName: "李师傅", currentTeamId: 8, status: "active" as const },
  { id: 3, fullName: "旧员工", currentTeamId: 7, status: "inactive" as const },
];

test("normalizes a typed plate without hiding the user's readable plate", () => {
  expect(normalizeInspectionPlateQuery(" ４３２１ ab ")).toBe("4321 AB");
});

test("offers only active mechanics in the selected submitting team", () => {
  expect(activeStaffForInspectionTeam(staff, 7).map((member) => member.id)).toEqual([1]);
});

test("clears a mechanic when the submitting team changes", () => {
  expect(retainInspectorForTeam("1", staff, 8)).toBe("");
  expect(retainInspectorForTeam("2", staff, 8)).toBe("2");
});
