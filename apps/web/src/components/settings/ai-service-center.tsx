"use client";

import { ArrowDown, ArrowUp, Bot, CheckCircle2, KeyRound, Loader2, RefreshCw, Save, TestTube2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AI_SETTINGS_STORAGE_KEY, loadAiSettings } from "@/lib/ai/settings";
import { cn } from "@/lib/utils";

type ProviderId = "deepseek" | "openai" | "google" | "compatible";
type TaskId = "text" | "customer_license" | "vehicle_document";
type Step = { provider: ProviderId; model: string };
type Settings = {
  version: 2;
  providers: Record<ProviderId, { enabled: boolean; hasKey: boolean; keyMask: string | null; baseUrl: string | null }>;
  routes: Record<TaskId, { enabled: boolean; autoFallback: boolean; steps: Step[] }>;
  updatedAt: string | null;
  recentEvents?: Array<{ timestamp: string; task: TaskId; provider: ProviderId; model: string; outcome: string; reason: string | null }>;
};

const PROVIDERS: Array<{ id: ProviderId; name: string; description: string; capability: string }> = [
  { id: "deepseek", name: "DeepSeek", description: "汽修拆单、整理和翻译", capability: "文本" },
  { id: "openai", name: "OpenAI", description: "文本与高精度证件视觉识别", capability: "文本 · 图片" },
  { id: "google", name: "Google Vision", description: "证件和车辆资料 OCR", capability: "图片" },
  { id: "compatible", name: "兼容服务", description: "备用 OpenAI-compatible 服务", capability: "按模型能力" },
];

const TASKS: Array<{ id: TaskId; name: string; description: string }> = [
  { id: "text", name: "文本拆单与翻译", description: "工单、检查结果、收费项目和客户英文" },
  { id: "customer_license", name: "客户驾驶证", description: "驾驶证正面姓名、生日、性别和地址" },
  { id: "vehicle_document", name: "车辆证件", description: "车辆登记证与 Fitness 资料" },
];

const TASK_LABEL: Record<TaskId, string> = Object.fromEntries(TASKS.map((task) => [task.id, task.name])) as Record<TaskId, string>;
const PROVIDER_LABEL: Record<ProviderId, string> = Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider.name])) as Record<ProviderId, string>;
const inputClass = "min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export function AiServiceCenter() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>("load");

  const load = useCallback(async () => {
    setBusy("load");
    setNotice(null);
    try {
      const response = await fetch("/api/ai/settings", { cache: "no-store" });
      const payload = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(payload.error || "读取 AI 设置失败");
      const legacy = loadAiSettings();
      const hasLegacyRecord = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY) !== null;
      if (!payload.providers.deepseek.hasKey && legacy.apiKey.trim()) {
        const migrated = await fetch("/api/ai/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providers: { deepseek: { enabled: legacy.provider === "deepseek", apiKey: legacy.apiKey.trim() } },
            ...(legacy.provider === "deepseek" ? { routes: { text: { steps: [{ provider: "deepseek", model: legacy.model || "deepseek-chat" }, ...payload.routes.text.steps.filter((step) => step.provider !== "deepseek")] } } } : {}),
          }),
        });
        if (!migrated.ok) throw new Error("旧 DeepSeek 密钥迁移失败，浏览器原设置仍已保留");
        window.localStorage.removeItem(AI_SETTINGS_STORAGE_KEY);
        const refreshed = await fetch("/api/ai/settings", { cache: "no-store" });
        setSettings(await refreshed.json() as Settings);
        setNotice("旧 DeepSeek 密钥已安全迁移到服务器");
      } else {
        if (hasLegacyRecord && payload.providers.deepseek.hasKey) window.localStorage.removeItem(AI_SETTINGS_STORAGE_KEY);
        setSettings(payload);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "读取 AI 设置失败");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const available = useMemo(() => settings ? PROVIDERS.filter(({ id }) => settings.providers[id].enabled && settings.providers[id].hasKey).length : 0, [settings]);

  const updateProvider = (id: ProviderId, patch: Partial<Settings["providers"][ProviderId]>) => {
    setSettings((current) => current ? { ...current, providers: { ...current.providers, [id]: { ...current.providers[id], ...patch } } } : current);
    setNotice(null);
  };

  const updateRoute = (id: TaskId, patch: Partial<Settings["routes"][TaskId]>) => {
    setSettings((current) => current ? { ...current, routes: { ...current.routes, [id]: { ...current.routes[id], ...patch } } } : current);
    setNotice(null);
  };

  const save = async (message = "AI 服务与任务顺序已保存") => {
    if (!settings) return false;
    setBusy("save");
    setNotice(null);
    try {
      const providers = Object.fromEntries(PROVIDERS.map(({ id }) => [id, {
        enabled: settings.providers[id].enabled,
        ...(keys[id]?.trim() ? { apiKey: keys[id]!.trim() } : {}),
        ...(id === "compatible" ? { baseUrl: settings.providers.compatible.baseUrl ?? "" } : {}),
      }]));
      const response = await fetch("/api/ai/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers, routes: settings.routes }),
      });
      const payload = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(payload.error || "保存 AI 设置失败");
      setKeys({});
      setSettings((current) => current ? { ...payload, recentEvents: current.recentEvents } : payload);
      setNotice(message);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存 AI 设置失败");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const testProvider = async (id: ProviderId) => {
    if (!await save("设置已保存，正在测试连接")) return;
    setBusy(`test:${id}`);
    try {
      const model = settings?.routes.text.steps.find((step) => step.provider === id)?.model
        ?? settings?.routes.customer_license.steps.find((step) => step.provider === id)?.model;
      const response = await fetch("/api/ai/settings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id, model }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "连接测试失败");
      setNotice(`${PROVIDER_LABEL[id]} 连接正常`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setBusy(null);
    }
  };

  const moveStep = (taskId: TaskId, index: number, delta: -1 | 1) => {
    if (!settings) return;
    const steps = [...settings.routes[taskId].steps];
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [steps[target], steps[index]];
    updateRoute(taskId, { steps });
  };

  if (!settings) {
    return <section className="mt-3 grid min-h-48 place-items-center rounded-[22px] border border-line bg-white/80"><div className="flex items-center gap-2 text-sm font-semibold text-ink-soft"><Loader2 className="animate-spin" size={18} />正在读取 AI 服务设置</div></section>;
  }

  return (
    <section data-testid="ai-service-center" className="mt-3 overflow-hidden rounded-[22px] border border-line bg-white/80 shadow-card dark:border-slate-700 dark:bg-slate-900/40">
      <header className="border-b border-line bg-gradient-to-r from-primary-50/80 to-white px-4 py-5 dark:from-primary/10 dark:to-slate-900 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-white"><Bot size={21} aria-hidden /></span>
            <div><h2 className="text-base font-bold text-ink dark:text-slate-100">AI 服务中心</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-ink-soft dark:text-slate-400">统一管理文本、驾驶证和车辆资料识别。首选服务不可用时，系统会按任务顺序自动切换。</p></div>
          </div>
          <button type="button" onClick={() => void save()} disabled={Boolean(busy)} data-testid="ai-center-save" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white hover:bg-primary-600 disabled:opacity-50"><Save size={16} />{busy === "save" ? "保存中…" : "保存全部"}</button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Summary label="可用服务" value={`${available} / ${PROVIDERS.length}`} healthy={available > 0} />
          <Summary label="任务路线" value={`${TASKS.filter(({ id }) => settings.routes[id].enabled).length} 项启用`} healthy />
          <Summary label="密钥位置" value="服务器保管" healthy />
        </div>
      </header>

      {notice ? <div role="status" data-testid="ai-center-notice" className={cn("mx-4 mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold sm:mx-6", notice.includes("失败") || notice.includes("不可用") ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>{notice.includes("失败") ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}{notice}</div> : null}

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1.05fr_.95fr]">
        <div>
          <div className="mb-3"><h3 className="text-sm font-bold text-ink dark:text-slate-100">服务商</h3><p className="mt-1 text-[11px] text-ink-soft">新密钥保存后不会再次显示明文；留空表示保留现有密钥。</p></div>
          <div className="space-y-3">
            {PROVIDERS.map((provider) => {
              const state = settings.providers[provider.id];
              const testing = busy === `test:${provider.id}`;
              return <article key={provider.id} data-testid={`ai-provider-${provider.id}`} className="rounded-2xl border border-line bg-surface/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-bold text-ink dark:text-slate-100">{provider.name}</h4><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-ink-soft dark:bg-slate-900">{provider.capability}</span></div><p className="mt-1 text-[11px] text-ink-soft">{provider.description}</p></div><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={state.enabled} onChange={(event) => updateProvider(provider.id, { enabled: event.target.checked })} className="h-4 w-4 accent-primary" />启用</label></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="text-[11px] font-semibold text-ink-soft"><span className="inline-flex items-center gap-1"><KeyRound size={13} />API Key · {state.hasKey ? `已配置 ${state.keyMask}` : "未配置"}</span><input type="password" autoComplete="new-password" value={keys[provider.id] ?? ""} onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))} className={cn(inputClass, "mt-1 font-mono")} placeholder={state.hasKey ? "留空保留；粘贴可更换" : "粘贴 API Key"} /></label>
                  <button type="button" onClick={() => void testProvider(provider.id)} disabled={Boolean(busy) || !state.enabled} className="mt-auto inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-3 text-xs font-bold text-primary disabled:opacity-40 dark:bg-slate-900"><TestTube2 size={15} />{testing ? "测试中" : "测试"}</button>
                </div>
                {provider.id === "compatible" ? <label className="mt-2 block text-[11px] font-semibold text-ink-soft">HTTPS API 地址<input value={state.baseUrl ?? ""} onChange={(event) => updateProvider("compatible", { baseUrl: event.target.value })} className={cn(inputClass, "mt-1")} placeholder="https://ai.example.com/v1" /></label> : null}
              </article>;
            })}
          </div>
        </div>

        <div>
          <div className="mb-3"><h3 className="text-sm font-bold text-ink dark:text-slate-100">任务路线</h3><p className="mt-1 text-[11px] text-ink-soft">从上到下尝试。可直接修改服务和模型，箭头调整优先级。</p></div>
          <div className="space-y-3">
            {TASKS.map((task) => <article key={task.id} data-testid={`ai-route-${task.id}`} className="rounded-2xl border border-line bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
              <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-bold text-ink dark:text-slate-100">{task.name}</h4><p className="mt-1 text-[11px] text-ink-soft">{task.description}</p></div><label className="inline-flex min-h-11 items-center gap-2 text-[11px] font-semibold"><input type="checkbox" checked={settings.routes[task.id].autoFallback} onChange={(event) => updateRoute(task.id, { autoFallback: event.target.checked })} className="h-4 w-4 accent-primary" />自动切换</label></div>
              <ol className="mt-3 space-y-2">{settings.routes[task.id].steps.map((step, index) => <li key={`${step.provider}-${index}`} className="grid grid-cols-[24px_1fr_1fr_auto] items-center gap-2 rounded-xl bg-surface px-2 py-2 dark:bg-slate-800">
                <span className="text-center text-[11px] font-bold text-ink-soft">{index + 1}</span>
                <select aria-label={`${task.name}第${index + 1}服务`} value={step.provider} onChange={(event) => { const steps = [...settings.routes[task.id].steps]; steps[index] = { ...step, provider: event.target.value as ProviderId }; updateRoute(task.id, { steps }); }} className={cn(inputClass, "min-h-10 px-2 text-xs")}>{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <input aria-label={`${task.name}第${index + 1}模型`} value={step.model} onChange={(event) => { const steps = [...settings.routes[task.id].steps]; steps[index] = { ...step, model: event.target.value }; updateRoute(task.id, { steps }); }} className={cn(inputClass, "min-h-10 px-2 text-xs")} />
                <div className="flex"><button type="button" aria-label="上移" onClick={() => moveStep(task.id, index, -1)} disabled={index === 0} className="grid h-10 w-8 place-items-center text-ink-soft disabled:opacity-20"><ArrowUp size={15} /></button><button type="button" aria-label="下移" onClick={() => moveStep(task.id, index, 1)} disabled={index === settings.routes[task.id].steps.length - 1} className="grid h-10 w-8 place-items-center text-ink-soft disabled:opacity-20"><ArrowDown size={15} /></button></div>
              </li>)}</ol>
            </article>)}
          </div>

          <article className="mt-3 rounded-2xl border border-line bg-surface/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="flex items-center justify-between"><div><h4 className="text-sm font-bold text-ink dark:text-slate-100">最近切换记录</h4><p className="mt-1 text-[11px] text-ink-soft">只记录服务状态，不保存证件、客户内容或密钥。</p></div><button type="button" aria-label="刷新" onClick={() => void load()} className="grid h-11 w-11 place-items-center rounded-xl border border-line text-primary"><RefreshCw size={16} /></button></div>
            <div className="mt-3 space-y-2">{settings.recentEvents?.length ? settings.recentEvents.slice(0, 5).map((event, index) => <div key={`${event.timestamp}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-[11px] dark:bg-slate-900"><span className="min-w-0 truncate"><strong>{TASK_LABEL[event.task]}</strong> · {PROVIDER_LABEL[event.provider]} · {event.model}</span><span className={event.outcome === "success" ? "text-emerald-700" : "text-amber-700"}>{event.outcome === "success" ? "成功" : "已切换"}</span></div>) : <p className="rounded-xl bg-white px-3 py-3 text-[11px] text-ink-soft dark:bg-slate-900">暂无切换记录</p>}</div>
          </article>
        </div>
      </div>
    </section>
  );
}

function Summary({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/60"><span className="text-[10px] font-semibold text-ink-soft">{label}</span><div className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-ink dark:text-slate-100">{healthy ? <CheckCircle2 size={14} className="text-emerald-600" /> : <TriangleAlert size={14} className="text-amber-600" />}{value}</div></div>;
}
