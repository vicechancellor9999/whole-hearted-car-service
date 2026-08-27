"use client";

import type { FirstInspectionBalance, TeamWorkload } from "./types";
import { FirstInspectionBalancePanel } from "./first-inspection-balance";
import { TeamWorkloadPanel } from "./team-workload-panel";

interface OperationsJudgmentProps {
  balance: FirstInspectionBalance;
  workloads: TeamWorkload[];
}

export function OperationsJudgment({ balance, workloads }: OperationsJudgmentProps) {
  return (
    <div
      data-testid="orders-operations-judgment"
      className="space-y-3"
    >
      <FirstInspectionBalancePanel balance={balance} />
      <TeamWorkloadPanel workloads={workloads} />
    </div>
  );
}
