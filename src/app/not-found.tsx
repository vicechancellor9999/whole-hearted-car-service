import Link from "next/link";

export default function NotFound() {
  return (
    <main className="home-shell">
      <section className="home-card">
        <p className="eyebrow">页面不存在</p>
        <h1>没有找到这个页面</h1>
        <p className="home-description">请返回正式系统入口重新进入。</p>
        <Link className="primary-action" href="/">
          返回首页
        </Link>
      </section>
    </main>
  );
}
