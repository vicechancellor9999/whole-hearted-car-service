import Image from "next/image";
import Link from "next/link";
import { loginAction } from "@/app/login/actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

const errorMessages: Record<string, string> = {
  invalid_credentials: "登录名或密码不正确",
  rate_limited: "登录尝试过多，请 15 分钟后再试",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const errorMessage = error ? errorMessages[error] : undefined;

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <Link className="back-link" href="/">
          返回系统入口
        </Link>
        <Image
          alt="Whole Hearted Car Service Logo"
          className="login-logo"
          height={88}
          priority
          src="/brand-logo-wh-512.png"
          width={88}
        />
        <p className="eyebrow">Whole Hearted Car Service Limited</p>
        <h1 id="login-title">登录正式系统</h1>
        <p className="login-description">使用超级管理员创建的工作账号登录。</p>

        {errorMessage ? <p role="alert" className="form-alert">{errorMessage}</p> : null}

        <form action={loginAction} className="login-form">
          <label htmlFor="username">登录名</label>
          <input
            autoComplete="username"
            autoFocus
            id="username"
            maxLength={200}
            name="username"
            required
            type="text"
          />

          <label htmlFor="password">密码</label>
          <input
            autoComplete="current-password"
            id="password"
            maxLength={1_024}
            name="password"
            required
            type="password"
          />

          <button className="primary-action" type="submit">
            登录
          </button>
        </form>

        <p className="system-note">本地开发与测试阶段 · 尚未部署</p>
      </section>
    </main>
  );
}
