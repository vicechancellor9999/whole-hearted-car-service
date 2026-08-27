import {
  validateCustomerLicenseRecognition,
  type CustomerLicenseRecognition,
} from "@/lib/customers/customer-driver-license-recognition";
import type { LicenseImageTransform } from "@/lib/customers/license-extraction/image-input";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function recognizeFormalCustomerLicense(
  input: { file: File; transform: LicenseImageTransform; signal: AbortSignal },
  fetcher: Fetcher = fetch,
): Promise<CustomerLicenseRecognition> {
  const form = new FormData();
  form.set("image", input.file);
  form.set("rotation", String(input.transform.rotation));
  form.set("crop", JSON.stringify(input.transform.crop));
  const response = await fetcher("/api/formal/customer-driver-license/recognize", {
    method: "POST",
    credentials: "same-origin",
    body: form,
    signal: input.signal,
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    if (response.status === 401) throw new Error("登录状态已失效，请重新登录");
    if (response.status === 403) throw new Error("当前账号没有客户证件写入权限");
    if (response.status === 503) throw new Error("证件识别尚未配置，可以改为人工填写");
    if (response.status >= 500) throw new Error("证件识别暂时不可用，已保留当前图片和输入");
    const safeError = payload && typeof payload === "object" && "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "驾驶证图片无法识别，请检查后重试";
    throw new Error(safeError);
  }
  return validateCustomerLicenseRecognition(payload);
}
