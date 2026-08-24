import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuditLogView } from "@/app/(protected)/settings/audit/page";
import type {
  AuditActorOption,
  AuditEventPage,
} from "@/modules/audit/audit-service";

const actors: AuditActorOption[] = [
  { id: 1, displayName: "超级管理员", username: "admin" },
];

const events: AuditEventPage = {
  total: 1,
  page: 1,
  pageSize: 25,
  pageCount: 1,
  items: [
    {
      id: 1,
      occurredAt: new Date("2026-08-24T10:15:00Z"),
      actorAccountId: 1,
      actorDisplayName: "超级管理员",
      actorUsername: "admin",
      eventType: "account.password_reset",
      objectType: "staff_account",
      objectId: "2",
      reason: "管理员重置密码",
      before: { sessionEpoch: 1 },
      after: { sessionEpoch: 2 },
      requestId: "req-audit-view",
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
    },
  ],
};

describe("AuditLogView", () => {
  it("shows read-only filters, facts, state changes and bounded pagination", () => {
    render(
      <AuditLogView
        actors={actors}
        events={events}
        filters={{ from: "2026-08-24", eventType: "account.password_reset" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "审计记录" })).toBeInTheDocument();
    expect(screen.getByLabelText("操作人")).toHaveTextContent("超级管理员");
    expect(screen.getByLabelText("开始日期")).toHaveValue("2026-08-24");
    expect(screen.getByLabelText("事件类型")).toHaveValue(
      "account.password_reset",
    );
    expect(screen.getByText("重置账号密码")).toBeInTheDocument();
    expect(screen.getByText("管理员重置密码")).toBeInTheDocument();
    expect(screen.getByText("staff_account · 2")).toBeInTheDocument();
    expect(screen.getByText("第 1 / 1 页 · 共 1 条")).toBeInTheDocument();
    expect(screen.getByText(/sessionEpoch/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /修改|删除|撤销/ })).not.toBeInTheDocument();
  });
});
