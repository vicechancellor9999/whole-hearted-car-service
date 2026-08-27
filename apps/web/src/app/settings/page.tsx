"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Save, TestTube } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import {
  AI_MODEL_PRESETS,
  DEFAULT_DEEPSEEK_MODEL,
  loadAiSettings,
  saveAiSettings,
} from "@/lib/ai/settings";
import { testDeepseekConnection } from "@/lib/ai/deepseek";
import type { OpenAiVehicleVisionModel, VehicleDocumentAiProvider } from "@/lib/customers/vehicle-document-ai";

type VehicleDocumentAiSettings = {
  provider: VehicleDocumentAiProvider;
  openAiModel: OpenAiVehicleVisionModel;
  hasOpenAiKey: boolean;
  hasGoogleKey: boolean;
  openAiKeyMask: string | null;
  googleKeyMask: string | null;
  updatedAt: string | null;
};

/** 系统设置：AI 服务（DeepSeek 密钥可换、开关、连接测试）；Twilio 等后续接入。 */
export default function SettingsPage() {
  const [provider, setProvider] = useState<"off" | "deepseek">("off");
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState<string>(DEFAULT_DEEPSEEK_MODEL);
  const [customModel, setCustomModel] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const [vehicleAiProvider, setVehicleAiProvider] = useState<VehicleDocumentAiProvider>("openai");
  const [openAiModel, setOpenAiModel] = useState<OpenAiVehicleVisionModel>("gpt-4.1-nano");
  const [openAiKey, setOpenAiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [vehicleAiSettings, setVehicleAiSettings] = useState<VehicleDocumentAiSettings | null>(null);
  const [vehicleAiBusy, setVehicleAiBusy] = useState(false);
  const [vehicleAiNotice, setVehicleAiNotice] = useState<string | null>(null);

  useEffect(() => {
    const settings = loadAiSettings();
    setProvider(settings.provider);
    setApiKey(settings.apiKey);
    const preset = AI_MODEL_PRESETS.find((item) => item.value === settings.model);
    if (preset && preset.value !== "custom") {
      setModelChoice(settings.model);
    } else {
      setModelChoice("custom");
      setCustomModel(settings.model);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ai/vehicle-document/settings", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as VehicleDocumentAiSettings & { error?: string };
        if (!response.ok) throw new Error(payload.error || "读取车辆识别设置失败");
        if (cancelled) return;
        setVehicleAiSettings(payload);
        setVehicleAiProvider(payload.provider);
        setOpenAiModel(payload.openAiModel);
      })
      .catch((error) => {
        if (!cancelled) setVehicleAiNotice(error instanceof Error ? error.message : "读取车辆识别设置失败");
      });
    return () => { cancelled = true; };
  }, []);

  const effectiveModel =
    modelChoice === "custom" ? customModel.trim() || DEFAULT_DEEPSEEK_MODEL : modelChoice;

  const save = () => {
    saveAiSettings({ provider, apiKey: apiKey.trim(), model: effectiveModel });
    setSaved("已保存 · " + new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    setTestResult(null);
  };

  const test = async () => {
    saveAiSettings({ provider, apiKey: apiKey.trim(), model: effectiveModel });
    setTesting(true);
    setTestResult(null);
    try {
      const answer = await testDeepseekConnection();
      setTestResult("连接正常 · AI 回复：" + answer);
    } catch (caught) {
      setTestResult(caught instanceof Error ? caught.message : "连接失败");
    } finally {
      setTesting(false);
    }
  };

  const persistVehicleAiSettings = async (): Promise<VehicleDocumentAiSettings> => {
    const response = await fetch("/api/ai/vehicle-document/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: vehicleAiProvider,
        openAiModel,
        ...(openAiKey.trim() ? { openAiApiKey: openAiKey.trim() } : {}),
        ...(googleKey.trim() ? { googleApiKey: googleKey.trim() } : {}),
      }),
    });
    const payload = await response.json() as VehicleDocumentAiSettings & { error?: string };
    if (!response.ok) throw new Error(payload.error || "保存车辆识别设置失败");
    setVehicleAiSettings(payload);
    setOpenAiKey("");
    setGoogleKey("");
    return payload;
  };

  const saveVehicleAi = async () => {
    setVehicleAiBusy(true);
    setVehicleAiNotice(null);
    try {
      await persistVehicleAiSettings();
      setVehicleAiNotice("车辆资料识别设置已保存；车辆建档会自动使用这项设置。");
    } catch (error) {
      setVehicleAiNotice(error instanceof Error ? error.message : "保存车辆识别设置失败");
    } finally {
      setVehicleAiBusy(false);
    }
  };

  const testVehicleAi = async () => {
    setVehicleAiBusy(true);
    setVehicleAiNotice(null);
    try {
      await persistVehicleAiSettings();
      const response = await fetch("/api/ai/vehicle-document/settings", { method: "POST" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "连接测试失败");
      setVehicleAiNotice("连接正常，车辆资料图片识别可以使用。");
    } catch (error) {
      setVehicleAiNotice(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setVehicleAiBusy(false);
    }
  };

  const inputClass = "min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
  const badgeClass = provider === "deepseek"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
    : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300";

  return (
    <div className="min-h-full bg-[var(--wh-page-bg)] px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-4xl">
        <PageHeader breadcrumb="系统" title="系统设置" description="AI 服务连接与密钥管理；换密钥即时生效，失效随时替换。" />

        <section data-testid="settings-ai-card" className="mt-3 rounded-[22px] border border-line bg-white/75 p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-ink dark:text-slate-100">AI 服务（DeepSeek）</h2>
              <p className="mt-0.5 text-[11px] text-ink-soft dark:text-slate-400">
                驱动 AI 拆单（工单/检查结果）与牙买加汽修场景翻译；密钥失效时在这里换新的即可。
                原型阶段密钥存本机浏览器，正式系统将移到服务器端。
              </p>
            </div>
            <span className={"rounded-full px-2.5 py-1 text-[10px] font-bold " + badgeClass}>
              {provider === "deepseek" ? "已启用" : "已关闭"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">AI 开关
              <select value={provider} onChange={(e) => setProvider(e.target.value as "off" | "deepseek")} data-testid="settings-ai-provider"
                className={"mt-1 " + inputClass}>
                <option value="deepseek">启用 DeepSeek（拆单/翻译走真模型）</option>
                <option value="off">关闭 AI（拆单/翻译用本地规则）</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">模型
              <select value={modelChoice} onChange={(e) => setModelChoice(e.target.value)} data-testid="settings-ai-model"
                className={"mt-1 " + inputClass}>
                {AI_MODEL_PRESETS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              {modelChoice === "custom" ? (
                <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} data-testid="settings-ai-model-custom"
                  className={"mt-1 " + inputClass} placeholder="例如 deepseek-chat / deepseek-reasoner（代理原样转发）" />
              ) : null}
              <span className="mt-1 block text-[10px] font-normal text-ink-soft dark:text-slate-400">
                翻译/拆单默认快速模型即可；要试最强推理模型就切 deepseek-reasoner（更慢更贵，代理自动适配参数与超时）。
              </span>
            </label>
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-ink dark:text-slate-200">
            <KeyRound size={14} /> API 密钥（失效了就换）
          </label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} data-testid="settings-ai-key"
            className={"mt-1 font-mono " + inputClass} placeholder="sk-…" />

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" data-testid="settings-ai-save" onClick={save}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600">
              <Save size={14} /> 保存
            </button>
            <button type="button" data-testid="settings-ai-test" disabled={testing || provider === "off" || !apiKey.trim()} onClick={() => void test()}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-4 text-xs font-semibold text-ink-soft hover:text-primary disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
              <TestTube size={14} /> {testing ? "测试中…" : "测试连接"}
            </button>
            {saved ? <span data-testid="settings-ai-saved" className="text-[11px] font-semibold text-emerald-600">{saved}</span> : null}
            {testResult ? <span data-testid="settings-ai-test-result" role="status" className="text-[11px] font-semibold text-primary">{testResult}</span> : null}
          </div>
        </section>

        <section data-testid="settings-vehicle-ai-card" className="mt-3 rounded-[22px] border border-line bg-white/75 p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-ink dark:text-slate-100">车辆资料图片识别</h2>
              <p className="mt-0.5 text-[11px] leading-5 text-ink-soft dark:text-slate-400">
                超级管理员在这里统一选择识别服务并填写 Key。车辆建档只显示一个 AI 识别按钮，不会显示服务选择或 Key。
              </p>
            </div>
            <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary dark:bg-primary/15 dark:text-primary-300">
              服务器配置
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">当前识别服务
              <select value={vehicleAiProvider} onChange={(event) => { setVehicleAiProvider(event.target.value as VehicleDocumentAiProvider); setVehicleAiNotice(null); }} data-testid="settings-vehicle-ai-provider" className={"mt-1 " + inputClass}>
                <option value="openai">OpenAI 图片识别</option>
                <option value="google">Google Cloud Vision 文档识别</option>
              </select>
            </label>
            {vehicleAiProvider === "openai" ? (
              <label className="block text-xs font-semibold text-ink dark:text-slate-200">OpenAI 识别模型
                <select value={openAiModel} onChange={(event) => { setOpenAiModel(event.target.value as OpenAiVehicleVisionModel); setVehicleAiNotice(null); }} data-testid="settings-vehicle-ai-model" className={"mt-1 " + inputClass}>
                  <option value="gpt-4.1-nano">GPT-4.1 nano（推荐 · 速度最快）</option>
                  <option value="gpt-4.1-mini">GPT-4.1 mini（速度与准确度平衡）</option>
                  <option value="gpt-4.1">GPT-4.1（识别更强 · 费用较高）</option>
                </select>
              </label>
            ) : (
              <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] leading-5 text-ink-soft dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                Google 使用 Cloud Vision 文档文字识别，不需要另选模型。
              </div>
            )}
            <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] leading-5 text-ink-soft dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 sm:col-span-2">
              <div>OpenAI：{vehicleAiSettings?.hasOpenAiKey ? `已配置 ${vehicleAiSettings.openAiKeyMask ?? ""}` : "未配置"}</div>
              <div>Google：{vehicleAiSettings?.hasGoogleKey ? `已配置 ${vehicleAiSettings.googleKeyMask ?? ""}` : "未配置"}</div>
            </div>
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">OpenAI API Key
              <input type="password" autoComplete="new-password" value={openAiKey} onChange={(event) => { setOpenAiKey(event.target.value); setVehicleAiNotice(null); }} data-testid="settings-vehicle-ai-openai-key" className={"mt-1 font-mono " + inputClass} placeholder={vehicleAiSettings?.hasOpenAiKey ? "已配置；留空表示不更换" : "粘贴 OpenAI API Key"} />
            </label>
            <label className="block text-xs font-semibold text-ink dark:text-slate-200">Google Cloud Vision API Key
              <input type="password" autoComplete="new-password" value={googleKey} onChange={(event) => { setGoogleKey(event.target.value); setVehicleAiNotice(null); }} data-testid="settings-vehicle-ai-google-key" className={"mt-1 font-mono " + inputClass} placeholder={vehicleAiSettings?.hasGoogleKey ? "已配置；留空表示不更换" : "粘贴 Google API Key"} />
            </label>
          </div>

          <p className="mt-3 text-[10px] leading-5 text-ink-soft dark:text-slate-400">
            保存后 Key 只留在服务器，页面不会再次读取或显示明文。留空表示保留已经保存的 Key。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" data-testid="settings-vehicle-ai-save" disabled={vehicleAiBusy} onClick={() => void saveVehicleAi()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-600 disabled:opacity-50">
              <Save size={14} /> {vehicleAiBusy ? "处理中…" : "保存设置"}
            </button>
            <button type="button" data-testid="settings-vehicle-ai-test" disabled={vehicleAiBusy} onClick={() => void testVehicleAi()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-4 text-xs font-semibold text-ink-soft hover:text-primary disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
              <TestTube size={14} /> 保存并测试连接
            </button>
            {vehicleAiNotice ? <span data-testid="settings-vehicle-ai-notice" role="status" className="text-[11px] font-semibold text-primary">{vehicleAiNotice}</span> : null}
          </div>
        </section>

        <section className="mt-3 rounded-[22px] border border-line bg-white/75 p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-5">
          <h2 className="text-sm font-bold text-ink dark:text-slate-100">基础字典</h2>
          <p className="mt-1 text-[11px] leading-5 text-ink-soft dark:text-slate-400">维修班组、支付方式和收费单位已集中到唯一的基础字典入口。</p>
          <Link href="/dictionaries" className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-white">打开基础字典</Link>
        </section>

<section data-testid="settings-demo-card" className="mt-3 rounded-[22px] border border-line bg-white/75 p-4 shadow-card dark:border-slate-700 dark:bg-slate-900/35 sm:p-5">
          <h2 className="text-sm font-bold text-ink dark:text-slate-100">演示偏好</h2>
          <p className="mt-1 text-[11px] leading-5 text-ink-soft dark:text-slate-400">
            仅重置一键轮换的本机演示偏好。工单、客户、收付款、停车费主账本与迁移保护档案均不会被删除或重写，页面也不会刷新。
          </p>
          <button type="button" data-testid="settings-reset-demo"
            onClick={() => {
              if (!window.confirm("确认重置一键轮换演示偏好？受保护的业务账本不会受影响。")) return;
              ["wh_quick_rotation_v1", "wh_quick_rotation_used_v1"].forEach((key) => window.localStorage.removeItem(key));
              setDemoNotice("已重置一键轮换演示偏好；业务账本与保护档案保持不变。");
            }}
            className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700">
            重置轮换偏好
          </button>
          {demoNotice ? <p data-testid="settings-demo-notice" role="status" className="mt-2 text-[11px] font-semibold text-emerald-600">{demoNotice}</p> : null}
        </section>

        <section className="mt-3 rounded-[22px] border border-dashed border-line p-4 text-[11px] text-ink-soft dark:border-slate-700 dark:text-slate-400">
          Twilio 短信 / WhatsApp 对接：等老板提供 Account SID、Auth Token 与发信号码后，在这里接入并留调用日志。当前取车通知按「前台人工执行 + 系统记录」运行。
        </section>
      </div>
    </div>
  );
}
