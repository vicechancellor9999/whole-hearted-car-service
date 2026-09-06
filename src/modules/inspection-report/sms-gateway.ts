export class InspectionSmsNotConfiguredError extends Error {
  readonly status = 503;
  readonly code = "inspection_sms_not_configured";

  constructor() {
    super("正式短信接口尚未配置，请先填写接口地址和鉴权信息");
    this.name = "InspectionSmsNotConfiguredError";
  }
}

export class InspectionSmsProviderError extends Error {
  readonly status = 502;
  readonly code = "inspection_sms_provider_error";

  constructor(message: string) {
    super(message);
    this.name = "InspectionSmsProviderError";
  }
}

type SmsGatewayConfig = {
  endpoint: string | null;
  bearerToken: string | null;
  sender: string | null;
  fetchImpl?: typeof fetch;
};

export type InspectionSmsGateway = {
  send(input: { to: string; message: string }): Promise<{ providerReference: string | null }>;
};

function optional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function providerReference(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["messageId", "message_id", "id", "reference"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return null;
}

export function createInspectionSmsGateway(config: SmsGatewayConfig): InspectionSmsGateway {
  const endpoint = optional(config.endpoint);
  const bearerToken = optional(config.bearerToken);
  const sender = optional(config.sender);
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async send(input) {
      if (!endpoint) throw new InspectionSmsNotConfiguredError();
      const to = input.to.trim();
      const message = input.message.trim();
      if (!to || !message) throw new InspectionSmsProviderError("短信号码和内容不能为空");

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
          },
          body: JSON.stringify({ to, message, sender }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new InspectionSmsProviderError("短信接口连接失败，请检查接口设置后重试");
      }

      if (!response.ok) {
        throw new InspectionSmsProviderError(`短信接口拒绝发送（HTTP ${response.status}）`);
      }
      const payload = await response.json().catch(() => null);
      return { providerReference: providerReference(payload) };
    },
  };
}

export function createInspectionSmsGatewayFromEnv(): InspectionSmsGateway {
  return createInspectionSmsGateway({
    endpoint: process.env.FORMAL_SMS_ENDPOINT ?? null,
    bearerToken: process.env.FORMAL_SMS_BEARER_TOKEN ?? null,
    sender: process.env.FORMAL_SMS_SENDER ?? null,
  });
}
