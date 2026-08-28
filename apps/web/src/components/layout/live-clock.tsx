"use client";

import { useEffect, useState } from "react";

/** Shared live clock used by the overview and every module-owned page header. */
export function LiveClock() {
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

  const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return (
    <div data-testid="live-clock">
      <div className="text-xl font-bold text-ink tabular-nums">
        {year}年{month}月{day}日
      </div>
      <div className="text-xs text-ink-soft tabular-nums">
        {weekdays[now.getDay()]} {hours}:{minutes}:{seconds}
      </div>
    </div>
  );
}
