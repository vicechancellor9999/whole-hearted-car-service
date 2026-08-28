import { Logo } from "@/components/ui/logo";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const errorMessages: Record<string, string> = {
  invalid_credentials: "登录名或密码不正确",
  rate_limited: "登录尝试过多，请稍后再试",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const message = resolvedSearchParams.error ? errorMessages[resolvedSearchParams.error] : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <section className="w-full max-w-[420px] rounded-[28px] border border-line-strong bg-card p-7 shadow-card-hover sm:p-9" aria-labelledby="login-title">
        <Logo className="mx-auto max-w-[250px]" />
        <div className="mt-7 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">综合管理系统</p>
          <h1 id="login-title" className="mt-2 text-2xl font-bold text-ink">登录</h1>
          <p className="mt-2 text-sm text-ink-soft">使用超级管理员创建的工作账号</p>
        </div>

        {message ? <p role="alert" className="mt-5 rounded-xl border border-state-danger-border bg-state-danger-subtle px-4 py-3 text-sm font-semibold text-state-danger-text">{message}</p> : null}

        <form action="/api/formal/auth/login" method="post" className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-ink" htmlFor="username">
            登录名
            <input autoComplete="username" autoFocus className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-layer-2 px-3.5 text-sm text-ink outline-none transition focus:border-accent" id="username" maxLength={200} name="username" required />
          </label>
          <label className="block text-sm font-semibold text-ink" htmlFor="password">
            密码
            <input autoComplete="current-password" className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-layer-2 px-3.5 text-sm text-ink outline-none transition focus:border-accent" id="password" maxLength={1024} name="password" required type="password" />
          </label>
          <button className="min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-bold text-white transition hover:bg-primary-600" type="submit">登录系统</button>
        </form>
      </section>
    </main>
  );
}
