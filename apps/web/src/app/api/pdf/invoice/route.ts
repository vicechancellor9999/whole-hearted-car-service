import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired before reading caller input. Invoice PDFs are generated in the
 * already-authorized browser from a closed financial statement projection.
 */
export async function POST(_request: Request) {
  return NextResponse.json(
    { error: "此 Invoice PDF 服务端路径已停用，请从业务单详情在本地生成 PDF。" },
    { status: 410 },
  );
}
