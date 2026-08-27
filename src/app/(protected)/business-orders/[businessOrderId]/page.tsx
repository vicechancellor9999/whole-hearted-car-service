import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { currentSession } from "@/modules/auth/current-session";
import { createBusinessOrderRuntime } from "@/modules/business-order/business-order-runtime";
import type {
  BusinessOrderChargeSnapshot,
  BusinessOrderRecord,
} from "@/modules/business-order/business-order-service";
import { BusinessOrderNotFoundError } from "@/modules/business-order/business-order-service";
import type {
  CurrentRepairRound,
  RepairRoundHistoryRecord,
} from "@/modules/business-order/repair-round-service";
import type {
  FormalHandoffRecord,
} from "@/modules/business-order/formal-handoff-service";
import { createMasterDataRuntime } from "@/modules/master-data/master-data-runtime";
import { hasPermission } from "@/modules/permissions/permissions";
import { requirePermission } from "@/modules/permissions/require-permission";
import { businessOrderAction } from "@/app/(protected)/business-orders/actions";
import { ChargeEditor } from "@/app/(protected)/business-orders/charge-editor";
import { businessOrderFinanceAction } from "@/app/(protected)/business-orders/[businessOrderId]/finance-actions";
import { FinancePanel } from "@/app/(protected)/business-orders/[businessOrderId]/finance-panel";
import type { BusinessOrderLedger } from "@/modules/payment/payment-service";
import type { BusinessOrderDocumentRecord } from "@/modules/business-order/business-order-document-service";
import { businessOrderDocumentAction } from "@/app/(protected)/business-orders/[businessOrderId]/document-actions";
import { DocumentHistory } from "@/app/(protected)/business-orders/[businessOrderId]/document-history";

type FormAction = (formData: FormData) => void | Promise<void>;
type TeamOption = { id: number; name: string };
type MechanicOption = { id: number; fullName: string; currentTeamId: number };
type ChargeUnitOption = { id: number; labelZh: string; labelEn: string | null };
type PaymentMethodOption = { id: number; code: string; labelZh: string; labelEn: string | null };

const progress = [
  ["waiting_assignment", "待派单"],
  ["assigned", "已派单"],
  ["in_repair", "维修中"],
  ["return_pending_review", "回单待审核"],
  ["formally_handed_off", "已交单"],
] as const;

function money(value: number) {
  return `JMD ${(value / 100).toLocaleString("en-JM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function WorkflowActions({
  action,
  isSuperAdmin,
  mechanics,
  order,
  repairRound,
  teams,
  formalHandoffs,
}: {
  action: FormAction;
  isSuperAdmin: boolean;
  mechanics: MechanicOption[];
  order: BusinessOrderRecord;
  repairRound: CurrentRepairRound;
  teams: TeamOption[];
  formalHandoffs: FormalHandoffRecord[];
}) {
  if (order.voided) return <p className="bo-current-action">本单已作废，不再执行维修流程。</p>;
  if (repairRound.status === "waiting_assignment") {
    return (
      <div className="bo-action-strip">
        <form action={action} className="bo-inline-action">
          <input name="operation" type="hidden" value="assign_round" />
          <input name="businessOrderId" type="hidden" value={order.id} />
          <input name="expectedBusinessOrderVersion" type="hidden" value={order.version} />
          <label>维修班组<select name="teamId" required><option value="">选择班组</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label className="bo-confirm-check"><input name="customerConfirmedWithoutPayment" required type="checkbox" value="true" />如尚无付款记录，已与客户确认本单内容</label>
          <button type="submit">确认派单</button>
        </form>
        <form action={action} className="bo-inline-action danger-action">
          <input name="operation" type="hidden" value="void_business_order" />
          <input name="businessOrderId" type="hidden" value={order.id} />
          <input name="expectedBusinessOrderVersion" type="hidden" value={order.version} />
          <label>作废原因<input name="reason" required /></label><button type="submit">作废本单</button>
        </form>
      </div>
    );
  }
  if (repairRound.status === "assigned") {
    return <p className="bo-current-action">已派给维修班组，等待该组任一维修工在手机端接单。</p>;
  }
  if (repairRound.status === "in_repair") {
    return (
      <div className="bo-action-strip">
        {isSuperAdmin && repairRound.intakeMileageKm === null ? (
          <form action={action} className="bo-inline-action">
            <input name="operation" type="hidden" value="record_intake_mileage" />
            <input name="businessOrderId" type="hidden" value={order.id} />
            <input name="expectedRepairRoundVersion" type="hidden" value={repairRound.version} />
            <label>接车里程（km）<input min="0" name="odometerKm" required type="number" /></label><button type="submit">记录接车里程</button>
          </form>
        ) : null}
        <form action={action} className="bo-inline-action bo-return-action">
          <input name="operation" type="hidden" value="submit_work_return" />
          <input name="businessOrderId" type="hidden" value={order.id} />
          <input name="expectedRepairRoundVersion" type="hidden" value={repairRound.version} />
          <label>实际维修工<select name="actualStaffMemberId" required><option value="">选择维修工</option>{mechanics.filter((member) => member.currentTeamId === repairRound.assignedTeamId).map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
          <label>回单工作内容<textarea name="workSummary" required /></label><button type="submit">代录并提交回单</button>
        </form>
      </div>
    );
  }
  if (repairRound.status === "return_pending_review") {
    if (repairRound.approvedWorkReturnId === null && repairRound.latestWorkReturnId !== null) {
      return (
        <div className="bo-action-strip">
          <form action={action} className="bo-inline-action">
            <input name="operation" type="hidden" value="approve_work_return" />
            <input name="businessOrderId" type="hidden" value={order.id} />
            <input name="expectedRepairRoundVersion" type="hidden" value={repairRound.version} />
            <input name="workReturnId" type="hidden" value={repairRound.latestWorkReturnId} />
            <button type="submit">审核通过回单</button>
          </form>
          <form action={action} className="bo-inline-action danger-action">
            <input name="operation" type="hidden" value="return_work_return" />
            <input name="businessOrderId" type="hidden" value={order.id} />
            <input name="expectedRepairRoundVersion" type="hidden" value={repairRound.version} />
            <input name="workReturnId" type="hidden" value={repairRound.latestWorkReturnId} />
            <label>退回原因<input name="reason" required /></label><button type="submit">退回回单</button>
          </form>
        </div>
      );
    }
    return (
      <form action={action} className="bo-inline-action">
        <input name="operation" type="hidden" value="formal_handoff" />
        <input name="businessOrderId" type="hidden" value={order.id} />
        <input name="expectedRepairRoundVersion" type="hidden" value={repairRound.version} />
        <label>本次绩效值（JMD，可正、零或负）<input defaultValue="0" name="performanceValue" required /></label>
        <button type="submit">正式交单</button>
      </form>
    );
  }
  const activeHandoff = [...formalHandoffs].reverse().find(
    (handoff) => handoff.repairRoundId === repairRound.id && handoff.cancellation === null,
  );
  return activeHandoff ? (
    <div className="bo-action-strip">
      <form action={action} className="bo-inline-action">
        <input name="operation" type="hidden" value="start_after_sales_round" />
        <input name="businessOrderId" type="hidden" value={order.id} />
        <input name="expectedBusinessOrderVersion" type="hidden" value={order.version} />
        <label>售后问题<textarea name="issue" required /></label>
        <button type="submit">开始售后维修</button>
      </form>
      <form action={action} className="bo-inline-action danger-action">
        <input name="operation" type="hidden" value="cancel_formal_handoff" />
        <input name="businessOrderId" type="hidden" value={order.id} />
        <input name="formalHandoffId" type="hidden" value={activeHandoff.id} />
        <label>同月取消交单原因<input name="reason" required /></label><button type="submit">取消本次正式交单</button>
      </form>
    </div>
  ) : <p className="bo-current-action">当前没有可取消的正式交单事实。</p>;
}

export function BusinessOrderDetailView({
  action = businessOrderAction,
  canWrite,
  canRecordPayment = canWrite,
  canRefund = false,
  chargeUnits,
  charges,
  documents = [],
  error,
  formalHandoffs,
  isSuperAdmin,
  mechanics,
  order,
  ledger,
  paymentAction = businessOrderFinanceAction,
  paymentMethods = [],
  repairRound,
  repairRounds = [],
  success,
  teams,
}: {
  action?: FormAction;
  canWrite: boolean;
  canRecordPayment?: boolean;
  canRefund?: boolean;
  chargeUnits: ChargeUnitOption[];
  charges: BusinessOrderChargeSnapshot;
  documents?: BusinessOrderDocumentRecord[];
  error?: string;
  formalHandoffs: FormalHandoffRecord[];
  isSuperAdmin: boolean;
  mechanics: MechanicOption[];
  order: BusinessOrderRecord;
  ledger?: BusinessOrderLedger;
  paymentAction?: FormAction;
  paymentMethods?: PaymentMethodOption[];
  repairRound: CurrentRepairRound;
  repairRounds?: RepairRoundHistoryRecord[];
  success?: string;
  teams: TeamOption[];
}) {
  const currentIndex = progress.findIndex(([status]) => status === repairRound.status);
  return (
    <section className="records-workspace bo-workspace" aria-labelledby="business-order-title">
      <header className="section-heading bo-detail-heading">
        <div><p className="eyebrow">Business Order · 正式数据</p><h1 id="business-order-title">{order.orderNo}</h1><p>{order.vehicle.plate} · {order.vehicle.description} · VIN {order.vehicle.vin ?? "未填写"}</p></div>
        <div className="bo-heading-links"><Link href="/business-orders">返回列表</Link><Link href={`/inspection-reports?vehicleId=${order.vehicleId}&businessOrderId=${order.id}&repairRoundId=${repairRound.id}`}>新建 / 查看 Inspection Report</Link></div>
      </header>
      {success ? <p className="form-alert success-alert">{success}</p> : null}
      {error ? <p className="form-alert">{error}</p> : null}
      {!canWrite ? <p className="readonly-notice">老板只读：可查看全部事实，不能修改或执行流程操作。</p> : null}
      <section aria-label="Business Order 进度与操作" className="bo-panel bo-workflow-panel">
        <header className="bo-panel-heading"><div><h2>Business Order 进度</h2><p>第 {repairRound.roundNo} 轮维修 · 当前所有可执行操作都在这里。</p></div></header>
        <div className="bo-progress-bar">
          {progress.map(([status, label], index) => <div className={`bo-progress-square${index < currentIndex ? " completed" : ""}${index === currentIndex ? " current" : ""}`} data-testid="progress-square" key={status}><strong>{index + 1}</strong><span>{label}</span></div>)}
        </div>
        {canWrite ? <WorkflowActions action={action} formalHandoffs={formalHandoffs} isSuperAdmin={isSuperAdmin} mechanics={mechanics} order={order} repairRound={repairRound} teams={teams} /> : null}
      </section>
      <section className="bo-panel bo-identity-panel"><div><small>费用承担方</small><strong>{order.payer.displayName}</strong><span>{order.payer.contactName ?? order.payer.phone ?? "联系方式未填"}</span></div><div><small>接车里程</small><strong>{repairRound.intakeMileageKm === null ? "尚未记录" : `${repairRound.intakeMileageKm.toLocaleString()} km`}</strong><span>{isSuperAdmin && canWrite ? "超级管理员可在维修中记录" : "由维修班组或超级管理员记录"}</span></div><div><small>当前维修班组</small><strong>{teams.find((team) => team.id === repairRound.assignedTeamId)?.name ?? "尚未派单"}</strong><span>轮次记录和时间戳独立保存</span></div></section>
      <ChargeEditor action={action} businessOrderId={order.id} businessOrderVersion={order.version} canWrite={canWrite && !order.voided} chargeUnits={chargeUnits} charges={charges} />
      <section className="bo-panel bo-finance-summary"><header className="bo-panel-heading"><div><h2>收费汇总</h2><p>单价和小计均为含税金额；所含 GCT 仅单独列示。</p></div></header><div><span>收费原价<strong>{money(charges.totals.grossMinor)}</strong></span><span>本项折扣<strong>{money(charges.totals.lineDiscountMinor)}</strong></span><span>分类折扣<strong>{money(charges.totals.categoryDiscountMinor)}</strong></span><span>折后应收<strong>{money(charges.totals.totalDueMinor)}</strong></span><span>其中含 15% GCT<strong>{money(charges.totals.includedGctMinor)}</strong></span></div></section>
      {ledger ? <FinancePanel action={paymentAction} businessOrderId={order.id} canRecordPayment={canRecordPayment && !order.voided} canRefund={canRefund} ledger={ledger} paymentMethods={paymentMethods} /> : null}
      <DocumentHistory action={businessOrderDocumentAction} businessOrderId={order.id} canGenerate={canWrite} documents={documents} />
      <section aria-label="维修轮次历史" className="bo-panel">
        <header className="bo-panel-heading"><div><h2>维修轮次历史</h2><p>每轮派单、维修和交单事实按发生顺序独立保存。</p></div></header>
        {repairRounds.length === 0 ? <p className="record-empty">尚无维修轮次记录。</p> : <div className="bo-handoff-list">{repairRounds.map((history) => <article key={history.id}><strong>第 {history.roundNo} 轮维修</strong><span>{history.source === "after_sales" ? `售后问题：${history.afterSalesIssue}` : "首次维修"} · {teams.find((team) => team.id === history.assignedTeamId)?.name ?? "尚未派单"}</span><em>{history.formalHandoffs.length === 0 ? "尚未正式交单" : history.formalHandoffs.map((handoff) => `${handoff.jamaicaMonth} · 绩效 ${money(handoff.performanceMinor)}${handoff.cancelledAt ? " · 已取消" : ""}`).join("；")}</em></article>)}</div>}
      </section>
      <section className="bo-panel"><header className="bo-panel-heading"><div><h2>正式交单历史</h2><p>取消不删除原交单；再次交单生成新的独立事实。</p></div></header>{formalHandoffs.length === 0 ? <p className="record-empty">尚无正式交单事实。</p> : <div className="bo-handoff-list">{formalHandoffs.map((handoff) => <article key={handoff.id}><strong>第 {handoff.handoffNo} 次交单 · 第 {handoff.repairRoundNo} 轮</strong><span>{handoff.jamaicaMonth} · 绩效 {money(handoff.performanceMinor)} · 收费版本 {handoff.chargeVersionNo}</span><em>{handoff.cancellation ? `已取消：${handoff.cancellation.reason}` : "当前有效"}</em></article>)}</div>}</section>
    </section>
  );
}

export default async function BusinessOrderDetailPage({ params, searchParams }: {
  params: Promise<{ businessOrderId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  await connection();
  const [session, route, query] = await Promise.all([currentSession(), params, searchParams]);
  const viewer = requirePermission(session, "business.read.all");
  const businessOrderId = Number(route.businessOrderId);
  if (!Number.isSafeInteger(businessOrderId) || businessOrderId < 1) notFound();
  const [businessRuntime, masterRuntime] = [createBusinessOrderRuntime(), createMasterDataRuntime()];
  try {
    let order: BusinessOrderRecord;
    try {
      order = await businessRuntime.service.getBusinessOrder({
        businessOrderId,
        viewerAccountId: viewer.id,
      });
    } catch (error) {
      if (error instanceof BusinessOrderNotFoundError) notFound();
      throw error;
    }
    const [charges, repairRound, repairRounds, formalHandoffs, chargeUnits, paymentMethods, teams, staff, ledger, documents] = await Promise.all([
      businessRuntime.service.getCurrentCharges({ businessOrderId, viewerAccountId: viewer.id }),
      businessRuntime.repairRounds.getCurrentRound({ businessOrderId, viewerAccountId: viewer.id }),
      businessRuntime.repairRounds.listRepairRounds({ businessOrderId, viewerAccountId: viewer.id }),
      businessRuntime.formalHandoffs.listFormalHandoffs({ businessOrderId, viewerAccountId: viewer.id }),
      masterRuntime.service.listDictionaryItems({ viewerAccountId: viewer.id, category: "charge_unit", activeOnly: true }),
      masterRuntime.service.listDictionaryItems({ viewerAccountId: viewer.id, category: "payment_method", activeOnly: true }),
      masterRuntime.service.listRepairTeams({ viewerAccountId: viewer.id, activeOnly: true }),
      masterRuntime.service.listStaffMembers({ viewerAccountId: viewer.id }),
      businessRuntime.payments.getBusinessOrderLedger({ businessOrderId, viewerAccountId: viewer.id }),
      businessRuntime.documents.listForBusinessOrder({ businessOrderId, viewerAccountId: viewer.id }),
    ]);
    const canWrite = hasPermission(viewer.role, "business_order.write", viewer.delegatedPermissions);
    return <BusinessOrderDetailView canRecordPayment={canWrite} canRefund={hasPermission(viewer.role, "sensitive_operations.execute", viewer.delegatedPermissions)} canWrite={canWrite} chargeUnits={chargeUnits.map((unit) => ({ id: unit.id, labelZh: unit.labelZh, labelEn: unit.labelEn }))} charges={charges} documents={documents} error={query.error} formalHandoffs={formalHandoffs} isSuperAdmin={viewer.role === "super_admin"} ledger={ledger} mechanics={staff.filter((member) => member.status === "active").map((member) => ({ id: member.id, fullName: member.fullName, currentTeamId: member.currentTeamId }))} order={order} paymentMethods={paymentMethods.map((method) => ({ id: method.id, code: method.code, labelZh: method.labelZh, labelEn: method.labelEn }))} repairRound={repairRound} repairRounds={repairRounds} success={query.success} teams={teams.map((team) => ({ id: team.id, name: team.name }))} />;
  } finally {
    await Promise.all([businessRuntime.close(), masterRuntime.close()]);
  }
}
