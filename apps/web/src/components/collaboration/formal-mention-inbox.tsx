"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchFormalMentions, type FormalMention } from "@/lib/api/formal-business-order-collaboration";
import { formatDateTime } from "@/lib/utils";

export function FormalMentionInbox() {
  const [items, setItems] = useState<FormalMention[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void fetchFormalMentions().then((result) => { setItems(result.items); setUnreadCount(result.unreadCount); }).catch((caught) => setError(caught instanceof Error ? caught.message : "提及读取失败")); }, []);
  return <div className="mx-auto w-full max-w-5xl px-4 py-5"><header className="rounded-2xl border border-line bg-white p-5 shadow-card"><p className="text-xs font-semibold text-primary">内部协作</p><h1 className="mt-1 text-2xl font-bold">我的提及</h1><p className="mt-2 text-sm text-ink-soft">别人于业务单留言中 @ 你的内容。当前未读 {unreadCount} 条。</p></header>{error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}<section className="mt-3 overflow-hidden rounded-2xl border border-line bg-white shadow-card">{items.length === 0 && !error ? <p className="p-8 text-center text-sm text-ink-soft">目前没有提及。</p> : items.map((item) => <Link key={item.id} href={`/orders/business/${item.businessOrderId}?tab=messages&message=${item.messageId}`} className={`block border-b border-line p-4 last:border-0 hover:bg-primary-50 ${item.readAt ? "" : "bg-amber-50/70"}`}><div className="flex flex-wrap items-center justify-between gap-2"><span><strong>{item.orderNo}</strong>{item.readAt ? null : <b className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] text-white">未读</b>}</span><time className="text-xs text-ink-soft">{formatDateTime(item.createdAt)}</time></div><p className="mt-2 line-clamp-2 text-sm">{item.body}</p><small className="mt-2 block text-ink-soft">来自 {item.authorDisplayName} · 点击进入业务单沟通交流</small></Link>)}</section></div>;
}
