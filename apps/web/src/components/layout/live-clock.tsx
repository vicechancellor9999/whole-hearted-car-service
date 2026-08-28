"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/language";

/** Shared live clock used by the overview and every module-owned page header. */
export function LiveClock() {
  const { language, locale } = useI18n();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!now) {
    return (
      <div data-testid="live-clock">
        <div className="text-xl font-bold text-ink">—</div>
        <div className="text-xs text-ink-soft">—</div>
      </div>
    );
  }

  const date = new Intl.DateTimeFormat(locale, {
    timeZone: "America/Jamaica",
    year: "numeric",
    month: language === "zh" ? "2-digit" : "short",
    day: "2-digit",
  }).format(now);
  const weekdayAndTime = new Intl.DateTimeFormat(locale, {
    timeZone: "America/Jamaica",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  return (
    <div data-testid="live-clock">
      <div className="text-xl font-bold text-ink tabular-nums">
        {date}
      </div>
      <div className="text-xs text-ink-soft tabular-nums">
        {weekdayAndTime}
      </div>
    </div>
  );
}
