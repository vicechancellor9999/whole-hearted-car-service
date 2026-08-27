import { Logo } from "@/components/ui/logo";

export default function PcNotAvailablePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <section className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-8 shadow-card-hover">
        <Logo className="mb-8" />
        <h1 className="text-xl font-semibold text-ink">此账号不提供 PC 网页端</h1>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          维修工账号只进入维修工手机端。PC 网页端仅供超级管理员、前台和老板视角使用。
        </p>
        <form action="/api/formal/auth/logout" className="mt-6" method="post">
          <button className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white" type="submit">
            退出登录
          </button>
        </form>
      </section>
    </main>
  );
}
