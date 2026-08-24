import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="home-card" aria-labelledby="system-title">
        <div className="brand-mark" aria-hidden="true">
          WH
        </div>
        <p className="eyebrow">Whole Hearted Car Service Limited</p>
        <h1 id="system-title">Whole Hearted 正式管理系统</h1>
        <p className="home-description">
          当前门店的正式业务、收付款、维修轮次与经营数据统一入口
        </p>
        <Link className="primary-action" href="/login">
          登录
        </Link>
        <p className="system-note">正式数据模式 · America/Jamaica</p>
      </section>
    </main>
  );
}
