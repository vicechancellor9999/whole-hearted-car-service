import Link from "next/link";

export function RecordPagination({
  page,
  pageCount,
  total,
  basePath,
  search,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  search?: string;
}) {
  const href = (nextPage: number) => {
    const query = new URLSearchParams({ page: String(nextPage) });
    if (search) query.set("search", search);
    return `${basePath}?${query.toString()}`;
  };
  return (
    <footer className="record-pagination">
      <span>第 {page} / {pageCount} 页 · 共 {total} 条</span>
      <nav aria-label="分页">
        {page > 1 ? <Link href={href(page - 1)}>上一页</Link> : <span>上一页</span>}
        {page < pageCount ? <Link href={href(page + 1)}>下一页</Link> : <span>下一页</span>}
      </nav>
    </footer>
  );
}
