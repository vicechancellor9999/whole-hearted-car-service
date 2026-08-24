import { describe, expect, it } from "vitest";
import { createRequestId } from "@/lib/request-id";

describe("createRequestId", () => {
  it("creates distinct request identifiers safe for audit correlation", () => {
    const first = createRequestId();
    const second = createRequestId();

    expect(first).toMatch(
      /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second).not.toBe(first);
  });
});
