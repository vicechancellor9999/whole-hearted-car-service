import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <section className="workspace-card" aria-labelledby="forbidden-title">
      <p className="eyebrow">403</p>
      <h1 id="forbidden-title">无权访问</h1>
      <p>当前账号没有读取或修改这项数据的权限。</p>
      <Link className="primary-action" href="/dashboard">返回工作台</Link>
    </section>
  );
}
