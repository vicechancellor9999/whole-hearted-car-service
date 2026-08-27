import { Logo } from "@/components/ui/logo";

type LoginPageProps = {
  searchParams: { error?: string };
};

const errorMessages: Record<string, string> = {
  invalid_credentials: "登录名或密码不正确",
  rate_limited: "登录尝试过多，请稍后再试",
};

export default function LoginPage({ searchParams }: LoginPageProps) {
  const message = searchParams.error ? errorMessages[searchParams.error] : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--wh-page-bg)] px-4 py-10">
      <section className="w-full max-w-[420px] rounded-[28px] border border-white/70 bg-white/90 p-7 shadow-card-hover backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/90 sm:p-9" aria-labelledby="login-title">
        <Logo className="mx-auto max-w-[250px]" />
        <div className="mt-7 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">综合管理系统</p>
          <h1 id="login-title" className="mt-2 text-2xl font-bold text-ink dark:text-white">登录</h1>
          <p className="mt-2 text-sm text-ink-soft dark:text-slate-400">使用超级管理员创建的工作账号</p>
        </div>

        {message ? <p role="alert" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{message}</p> : null}

        <form action="/api/formal/auth/login" method="post" className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-ink dark:text-slate-200" htmlFor="username">
            登录名
            <input autoComplete="username" autoFocus className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm outline-none transition focus:border-primary dark:border-slate-700 dark:bg-slate-950" id="username" maxLength={200} name="username" required />
          </label>
          <label className="block text-sm font-semibold text-ink dark:text-slate-200" htmlFor="password">
            密码
            <input autoComplete="current-password" className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3.5 text-sm outline-none transition focus:border-primary dark:border-slate-700 dark:bg-slate-950" id="password" maxLength={1024} name="password" required type="password" />
          </label>
          <button className="min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-bold text-white transition hover:bg-primary-600" type="submit">登录系统</button>
        </form>
      </section>
    </main>
  );
}
