"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="home-shell">
      <section className="home-card">
        <p className="eyebrow">系统暂时无法完成请求</p>
        <h1>请重新尝试</h1>
        <p className="home-description">
          如果重复出现，请把发生时间和正在操作的页面告诉超级管理员。
        </p>
        <button className="primary-action" type="button" onClick={reset}>
          重新尝试
        </button>
      </section>
    </main>
  );
}
