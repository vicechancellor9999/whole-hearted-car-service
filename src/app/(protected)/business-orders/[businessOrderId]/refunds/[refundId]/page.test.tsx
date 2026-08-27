import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RefundEvidenceSection } from "@/app/(protected)/business-orders/[businessOrderId]/refunds/[refundId]/page";

const proof = {
  fileId: 91,
  kind: "refund_proof" as const,
  storageKey: "refund-files/2026/08/proof.pdf",
  originalName: "bank-proof.pdf",
  mediaType: "application/pdf",
  sizeBytes: 100,
  sha256Hex: "a".repeat(64),
};

describe("refund evidence section", () => {
  it("shows an upload entry only after a refund exists and its proof is pending", () => {
    render(<RefundEvidenceSection action={vi.fn()} businessOrderId={12} canUpload evidence={[]} refundId={31} requiresProof />);
    expect(screen.getByText("退款凭证待补")).toBeInTheDocument();
    expect(screen.getByLabelText("上传实际退款凭证")).toBeRequired();
    expect(screen.getByRole("button", { name: "上传退款凭证" })).toBeInTheDocument();
  });

  it("shows the immutable proof and removes the upload entry after it is attached", () => {
    render(<RefundEvidenceSection action={vi.fn()} businessOrderId={12} canUpload evidence={[proof]} refundId={31} requiresProof />);
    expect(screen.getByRole("link", { name: /退款凭证.*bank-proof\.pdf/ })).toHaveAttribute(
      "href",
      "/api/refund-evidence/91",
    );
    expect(screen.queryByLabelText("上传实际退款凭证")).not.toBeInTheDocument();
    expect(screen.getByText("退款凭证已归档，不允许替换。")) .toBeInTheDocument();
  });

  it("keeps the owner view read-only while still showing the pending state", () => {
    render(<RefundEvidenceSection action={vi.fn()} businessOrderId={12} canUpload={false} evidence={[]} refundId={31} requiresProof />);
    expect(screen.getByText("退款凭证待补")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传退款凭证" })).not.toBeInTheDocument();
  });

  it("offers a post-refund signed acknowledgement upload even for a cash refund", () => {
    render(<RefundEvidenceSection action={vi.fn()} businessOrderId={12} canUpload evidence={[]} refundId={31} requiresProof={false} />);
    expect(screen.getByText("签字后的退款签收单待回传（可选）")).toBeInTheDocument();
    expect(screen.getByLabelText("上传签字后的退款签收单")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传签收单" })).toBeInTheDocument();
  });

  it("shows the uploaded signed paper acknowledgement without treating it as a refund prerequisite", () => {
    const signature = { ...proof, kind: "customer_signature" as const, originalName: "cash-signed.png" };
    render(<RefundEvidenceSection action={vi.fn()} businessOrderId={12} canUpload evidence={[signature]} refundId={31} requiresProof={false} />);
    expect(screen.getByRole("link", { name: /已签字退款签收单.*cash-signed\.png/ })).toHaveAttribute(
      "href",
      "/api/refund-evidence/91",
    );
    expect(screen.queryByText("退款凭证待补")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传签收单" })).not.toBeInTheDocument();
  });
});
