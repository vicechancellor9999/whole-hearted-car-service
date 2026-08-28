import { notifyFormalDataChanged } from "../formal-data-changes";

export type FormalBusinessOrderAttachmentCategory =
  | "customer_signature"
  | "service_photo"
  | "financial_evidence"
  | "other";

export type FormalBusinessOrderAttachment = {
  id: number;
  businessOrderId: number;
  fileId: number;
  category: FormalBusinessOrderAttachmentCategory;
  caption: string | null;
  messageId: number | null;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  uploaderAccountId: number;
  uploaderDisplayName: string;
  linkedAt: string;
  url: string;
};

async function responseJson<ResponseBody>(response: Response, fallback: string): Promise<ResponseBody> {
  const payload = await response.json().catch(() => ({})) as ResponseBody & { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : fallback);
  return payload;
}

function withUrl(businessOrderId: number, attachment: Omit<FormalBusinessOrderAttachment, "url">): FormalBusinessOrderAttachment {
  return {
    ...attachment,
    url: `/api/formal/business-orders/${businessOrderId}/attachments/${attachment.id}`,
  };
}

export async function fetchFormalBusinessOrderAttachments(businessOrderId: number) {
  const response = await fetch(`/api/formal/business-orders/${businessOrderId}/attachments`, { cache: "no-store" });
  const page = await responseJson<{ items: Array<Omit<FormalBusinessOrderAttachment, "url">> }>(response, "业务附件读取失败");
  return { items: page.items.map((item) => withUrl(businessOrderId, item)) };
}

export async function uploadFormalBusinessOrderAttachment(
  businessOrderId: number,
  input: { file: File; category: FormalBusinessOrderAttachmentCategory; caption?: string | null },
) {
  const formData = new FormData();
  formData.set("file", input.file);
  formData.set("category", input.category);
  if (input.caption?.trim()) formData.set("caption", input.caption.trim());
  const response = await fetch(`/api/formal/business-orders/${businessOrderId}/attachments`, {
    method: "POST",
    body: formData,
  });
  const attachment = await responseJson<Omit<FormalBusinessOrderAttachment, "url">>(response, "业务附件上传失败");
  notifyFormalDataChanged();
  return withUrl(businessOrderId, attachment);
}
