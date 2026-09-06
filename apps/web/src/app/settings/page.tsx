"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { AiServiceCenter } from "@/components/settings/ai-service-center";
import { PerformanceParametersCard } from "@/components/settings/performance-parameters-card";

export default function SettingsPage() {
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  return (
    <div className="min-h-full bg-page px-3 py-3 sm:px-5">
      <div className="mx-auto w-full max-w-6xl">
        <PageHeader breadcrumb="系统" title="系统设置" description="经营参数、AI 服务、基础字典与本机偏好。" />
        <PerformanceParametersCard />
        <AiServiceCenter />

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <section className="rounded-[22px] border border-line bg-card p-4 shadow-card sm:p-5">
            <h2 className="text-sm font-bold text-ink">基础字典</h2>
            <p className="mt-1 text-[11px] leading-5 text-ink-soft">维修班组、支付方式和收费单位集中在唯一的基础字典入口。</p>
            <Link href="/dictionaries" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-white">打开基础字典</Link>
          </section>

          <section data-testid="settings-demo-card" className="rounded-[22px] border border-line bg-card p-4 shadow-card sm:p-5">
            <h2 className="text-sm font-bold text-ink">演示偏好</h2>
            <p className="mt-1 text-[11px] leading-5 text-ink-soft">仅重置本机一键轮换偏好；业务账本和保护档案保持不变。</p>
            <button type="button" data-testid="settings-reset-demo" onClick={() => {
              if (!window.confirm("确认重置一键轮换演示偏好？受保护的业务账本不会受影响。")) return;
              ["wh_quick_rotation_v1", "wh_quick_rotation_used_v1"].forEach((key) => window.localStorage.removeItem(key));
              setDemoNotice("已重置一键轮换演示偏好；业务账本与保护档案保持不变。");
            }} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700">重置轮换偏好</button>
            {demoNotice ? <p data-testid="settings-demo-notice" role="status" className="mt-2 text-[11px] font-semibold text-emerald-600">{demoNotice}</p> : null}
          </section>
        </div>

        <section className="mt-3 rounded-[22px] border border-dashed border-line p-4 text-[11px] leading-5 text-ink-soft">
          <strong className="text-ink">客户通信服务：</strong>检查报告短信通过服务器端接口发送，供应商接受后才写入发送记录；WhatsApp 继续由前台打开会话并发送。短信服务接入需要接口地址、鉴权信息和发信号码。
        </section>
      </div>
    </div>
  );
}
