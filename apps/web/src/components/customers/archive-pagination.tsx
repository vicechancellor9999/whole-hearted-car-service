"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/language";

export const ARCHIVE_PAGE_SIZE = 8;

function pageSizeForHeight(height: number): number {
  if (height >= 1_200) return 16;
  if (height >= 1_000) return 12;
  return ARCHIVE_PAGE_SIZE;
}

/** Keep rows compact while using more of a tall single-screen workspace. */
export function useArchivePageSize(): number {
  const [pageSize, setPageSize] = useState(ARCHIVE_PAGE_SIZE);

  useEffect(() => {
    const update = () => setPageSize(pageSizeForHeight(window.innerHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return pageSize;
}

function pageNumbers(currentPage: number, pageCount: number): number[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const start = Math.min(Math.max(currentPage - 2, 1), pageCount - 4);
  return Array.from({ length: 5 }, (_, index) => start + index);
}

export function ArchivePagination({
  page,
  total,
  onPageChange,
  testIdPrefix,
  pageSize = ARCHIVE_PAGE_SIZE,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
  testIdPrefix: "customer" | "vehicle";
  pageSize?: number;
}) {
  const { language } = useI18n();
  const tr = (zh: string, en: string) => language === "en" ? en : zh;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);

  return (
    <nav
      data-testid={`${testIdPrefix}-pagination`}
      aria-label={tr(`${testIdPrefix === "customer" ? "客户" : "车辆"}档案分页`, `${testIdPrefix === "customer" ? "Customer" : "Vehicle"} record pages`)}
      className="flex flex-col gap-2 border-t border-line bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-xs text-ink-soft dark:text-slate-400">
        {tr("显示", "Showing")} <span className="font-semibold tabular-nums text-ink dark:text-slate-200">{start}–{end}</span>
        {" "}{tr("条，共", "of")} <span className="font-semibold tabular-nums text-ink dark:text-slate-200">{total}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-testid={`${testIdPrefix}-page-prev`}
          aria-label={tr("上一页", "Previous page")}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-soft disabled:cursor-not-allowed disabled:opacity-35 dark:border-slate-600 dark:bg-slate-900"
        >
          <ChevronLeft size={15} aria-hidden />
        </button>
        {pageNumbers(safePage, pageCount).map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            data-testid={`${testIdPrefix}-page-${pageNumber}`}
            aria-label={tr(`第 ${pageNumber} 页`, `Page ${pageNumber}`)}
            aria-current={pageNumber === safePage ? "page" : undefined}
            onClick={() => onPageChange(pageNumber)}
            className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-semibold transition ${pageNumber === safePage ? "border-primary bg-primary text-white" : "border-line bg-white text-ink-soft hover:border-primary-200 hover:text-primary dark:border-slate-600 dark:bg-slate-900"}`}
          >
            {pageNumber}
          </button>
        ))}
        <span className="px-1 text-[11px] text-ink-faint">/ {pageCount} {tr("页", "pages")}</span>
        <button
          type="button"
          data-testid={`${testIdPrefix}-page-next`}
          aria-label={tr("下一页", "Next page")}
          disabled={safePage >= pageCount}
          onClick={() => onPageChange(safePage + 1)}
          className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-soft disabled:cursor-not-allowed disabled:opacity-35 dark:border-slate-600 dark:bg-slate-900"
        >
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
