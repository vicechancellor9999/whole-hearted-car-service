import { expect, test } from "@playwright/test";
import {
  getFormalPcPolicy,
  getVisibleNavigationKeys,
  getMockBusinessActor,
  isFormalIdentityConsistent,
} from "../../src/lib/auth/formal-pc-access";

test("PC 端只允许超级管理员、前台和老板进入", () => {
  expect(getFormalPcPolicy("super_admin").pcAccess).toBe(true);
  expect(getFormalPcPolicy("front_desk").pcAccess).toBe(true);
  expect(getFormalPcPolicy("owner").pcAccess).toBe(true);
  expect(getFormalPcPolicy("mechanic").pcAccess).toBe(false);
});

test("老板视角全局只读，前台敏感操作仅按正式授权开放", () => {
  expect(getFormalPcPolicy("owner").readOnly).toBe(true);
  expect(getFormalPcPolicy("owner").canExecuteSensitiveOperations).toBe(false);
  expect(getFormalPcPolicy("front_desk").readOnly).toBe(false);
  expect(getFormalPcPolicy("front_desk").canExecuteSensitiveOperations).toBe(false);
  expect(
    getFormalPcPolicy("front_desk", ["sensitive_operations.execute"])
      .canExecuteSensitiveOperations,
  ).toBe(true);
});

test("导航按正式身份收口，维修工在 PC 端没有任何入口", () => {
  expect(getVisibleNavigationKeys("super_admin")).toEqual([
    "dashboard",
    "workbench",
    "business_orders",
    "inspection_reports",
    "master_data",
    "employees",
    "performance",
    "payments",
    "parking",
    "customers",
    "vehicles",
    "settings",
  ]);
  expect(getVisibleNavigationKeys("front_desk")).toEqual([
    "dashboard",
    "workbench",
    "business_orders",
    "inspection_reports",
    "master_data",
    "payments",
    "parking",
    "customers",
    "vehicles",
  ]);
  expect(getVisibleNavigationKeys("owner")).toEqual([
    "dashboard",
    "workbench",
    "business_orders",
    "inspection_reports",
    "master_data",
    "employees",
    "performance",
    "payments",
    "parking",
    "customers",
    "vehicles",
  ]);
  expect(getVisibleNavigationKeys("mechanic")).toEqual([]);
});

test("正式超级管理员身份不依赖 Mock 员工目录也能通过内部权限校验", () => {
  expect(isFormalIdentityConsistent(
    {
      id: "account-9",
      name: "超级管理员",
      role: "superadmin",
    },
    {
      accountId: 9,
      role: "super_admin",
      delegatedPermissions: [],
    },
  )).toBe(true);
  expect(isFormalIdentityConsistent(
    { id: "emp-001", name: "超级管理员", role: "superadmin" },
    { accountId: 9, role: "super_admin", delegatedPermissions: [] },
  )).toBe(false);
});

test("正式超级管理员操作尚未迁出的 Mock 业务时使用受信任的兼容坐标", () => {
  expect(getMockBusinessActor(
    { id: "account-9", name: "超级管理员", role: "superadmin" },
    { accountId: 9, role: "super_admin", delegatedPermissions: [] },
  )).toEqual({ id: "emp-001", name: "超级管理员", role: "superadmin" });
});
