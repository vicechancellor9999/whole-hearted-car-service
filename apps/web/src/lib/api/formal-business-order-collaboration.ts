import { notifyFormalDataChanged } from "../formal-data-changes";

export type FormalMentionableAccount = { id: number; displayName: string; role: string };
export type FormalBusinessOrderMessage = {
  id: number; businessOrderId: number; authorAccountId: number; authorDisplayName: string;
  authorRole: string; body: string; version: number; createdAt: string; editedAt: string | null;
  mentions: Array<{ accountId: number; displayName: string }>;
  attachments: Array<{
    id: number; originalName: string; mediaType: string; sizeBytes: number; caption: string | null;
  }>;
};
export type FormalMention = {
  id: number; messageId: number; readAt: string | null; mentionedAt: string;
  businessOrderId: number; orderNo: string; body: string; authorDisplayName: string; createdAt: string;
};

async function json<ResponseBody>(input: RequestInfo | URL, init?: RequestInit): Promise<ResponseBody> {
  const response = await fetch(input, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as ResponseBody & { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "沟通数据读取失败");
  if (init?.method && init.method !== "GET") notifyFormalDataChanged();
  return payload;
}

export function fetchFormalBusinessOrderMessages(businessOrderId: number) {
  return json<{ items: FormalBusinessOrderMessage[] }>(`/api/formal/business-orders/${businessOrderId}/messages`);
}
export function createFormalBusinessOrderMessage(businessOrderId: number, input: { body: string; mentionedAccountIds: number[]; attachmentIds?: number[] }) {
  return json<FormalBusinessOrderMessage>(`/api/formal/business-orders/${businessOrderId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}
export function editFormalBusinessOrderMessage(businessOrderId: number, messageId: number, input: { body: string; mentionedAccountIds: number[]; expectedVersion: number }) {
  return json<FormalBusinessOrderMessage>(`/api/formal/business-orders/${businessOrderId}/messages/${messageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}
export function markFormalBusinessOrderMentionsRead(businessOrderId: number) {
  return json<{ updated: number }>(`/api/formal/business-orders/${businessOrderId}/messages/read`, { method: "POST" });
}
export function fetchFormalMentionableAccounts() {
  return json<FormalMentionableAccount[]>("/api/formal/me/mentionable-accounts");
}
export function fetchFormalMentions() {
  return json<{ items: FormalMention[]; unreadCount: number }>("/api/formal/me/mentions");
}
