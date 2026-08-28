"use client";

import { Languages } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { useI18n } from "@/lib/i18n/language";

type LoginErrorCode = "invalid_credentials" | "rate_limited";

const errorMessageKeys = {
  invalid_credentials: "login.error.invalidCredentials",
  rate_limited: "login.error.rateLimited",
} as const;

export function LoginPanel({ errorCode }: { errorCode: LoginErrorCode | null }) {
  const { language, setLanguage, t } = useI18n();
  const message = errorCode ? t(errorMessageKeys[errorCode]) : null;

  return (
    <section
      className="w-full max-w-[420px] rounded-[28px] border border-line-strong bg-card p-7 shadow-card-hover sm:p-9"
      aria-labelledby="login-title"
      aria-label={t("login.title")}
    >
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="login-language-toggle"
          aria-label={t("login.switchLanguage")}
          onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-layer-2 px-3 text-xs font-semibold text-ink-soft transition hover:border-line-strong hover:text-accent"
        >
          <Languages size={14} aria-hidden="true" />
          {language === "zh" ? "EN" : "ZH"}
        </button>
      </div>
      <Logo className="mx-auto mt-2 max-w-[250px]" />
      <div className="mt-7 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{t("brand.systemName")}</p>
        <h1 id="login-title" className="mt-2 text-2xl font-bold text-ink">{t("login.title")}</h1>
        <p className="mt-2 text-sm text-ink-soft">{t("login.description")}</p>
      </div>

      {message ? <p role="alert" className="mt-5 rounded-xl border border-state-danger-border bg-state-danger-subtle px-4 py-3 text-sm font-semibold text-state-danger-text">{message}</p> : null}

      <form action="/api/formal/auth/login" method="post" className="mt-6 space-y-4">
        <label className="block text-sm font-semibold text-ink" htmlFor="username">
          {t("login.username")}
          <input autoComplete="username" autoFocus className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-layer-2 px-3.5 text-sm text-ink outline-none transition focus:border-accent" id="username" maxLength={200} name="username" required />
        </label>
        <label className="block text-sm font-semibold text-ink" htmlFor="password">
          {t("login.password")}
          <input autoComplete="current-password" className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-layer-2 px-3.5 text-sm text-ink outline-none transition focus:border-accent" id="password" maxLength={1024} name="password" required type="password" />
        </label>
        <button className="min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-bold text-white transition hover:bg-primary-600" type="submit">{t("login.submit")}</button>
      </form>
    </section>
  );
}
