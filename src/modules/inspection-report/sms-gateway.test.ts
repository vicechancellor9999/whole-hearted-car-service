import { describe, expect, it, vi } from "vitest";
import {
  InspectionSmsNotConfiguredError,
  createInspectionSmsGateway,
} from "./sms-gateway";

describe("inspection SMS gateway", () => {
  it("fails closed without recording a fake send when the provider is not configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const gateway = createInspectionSmsGateway({
      endpoint: null,
      bearerToken: null,
      sender: null,
      fetchImpl,
    });

    await expect(gateway.send({ to: "+18765550102", message: "Inspection report ready" }))
      .rejects.toBeInstanceOf(InspectionSmsNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a closed JSON payload to the configured provider and returns its reference", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ messageId: "sms-123" }),
      { status: 202, headers: { "content-type": "application/json" } },
    ));
    const gateway = createInspectionSmsGateway({
      endpoint: "https://sms.example.test/v1/messages",
      bearerToken: "secret-token",
      sender: "Whole Hearted",
      fetchImpl,
    });

    await expect(gateway.send({ to: "+18765550102", message: "Inspection report ready" }))
      .resolves.toEqual({ providerReference: "sms-123" });
    expect(fetchImpl).toHaveBeenCalledWith("https://sms.example.test/v1/messages", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer secret-token" }),
      body: JSON.stringify({
        to: "+18765550102",
        message: "Inspection report ready",
        sender: "Whole Hearted",
      }),
    }));
  });

  it("surfaces provider rejection instead of treating it as sent", async () => {
    const gateway = createInspectionSmsGateway({
      endpoint: "https://sms.example.test/v1/messages",
      bearerToken: null,
      sender: null,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("no credit", { status: 402 })),
    });

    await expect(gateway.send({ to: "+18765550102", message: "Inspection report ready" }))
      .rejects.toThrow("短信接口拒绝发送（HTTP 402）");
  });
});
