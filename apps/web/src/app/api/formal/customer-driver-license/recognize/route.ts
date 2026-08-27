import { NextResponse } from "next/server";
import { currentSession } from "@formal/modules/auth/current-session";
import {
  validateCustomerLicenseRecognition,
  type CustomerLicenseRecognition,
} from "@/lib/customers/customer-driver-license-recognition";
import type { LicenseImageTransform } from "@/lib/customers/license-extraction/image-input";
import {
  CustomerDriverLicenseImageError,
  prepareCustomerDriverLicenseImage,
} from "@/lib/server/customer-driver-license-image";
import { recognizeCustomerDriverLicense } from "@/lib/server/customer-driver-license-recognizer";

export const runtime = "nodejs";

type RecognitionSession = {
  account: { role: string };
};

type RecognitionDependencies = {
  readSession(): Promise<RecognitionSession | null>;
  recognize(file: File, transform: LicenseImageTransform): Promise<CustomerLicenseRecognition>;
};

export function createCustomerDriverLicenseRecognitionHandler(
  dependencies: RecognitionDependencies,
) {
  return async function customerDriverLicenseRecognitionHandler(request: Request): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (session.account.role !== "super_admin" && session.account.role !== "front_desk") {
      return NextResponse.json({ error: "当前账号没有客户证件写入权限" }, { status: 403 });
    }

    try {
      const form = await request.formData();
      const image = form.get("image");
      if (!(image instanceof File) || form.getAll("image").length !== 1) {
        return NextResponse.json({ error: "请选择驾驶证图片" }, { status: 400 });
      }
      if (image.type !== "image/jpeg" && image.type !== "image/png") {
        return NextResponse.json(
          { error: "仅支持有效的 JPEG 或 PNG 驾驶证图片" },
          { status: 400 },
        );
      }
      const transform = parseTransform(form);
      const recognition = validateCustomerLicenseRecognition(
        await dependencies.recognize(image, transform),
      );
      return NextResponse.json(recognition, {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      if (error instanceof CustomerDriverLicenseImageError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof RecognitionInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof Error && error.message.includes("尚未在系统设置中填写")) {
        return NextResponse.json(
          { error: "证件识别尚未配置，可以改为人工填写" },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: "证件识别暂时不可用，已保留当前图片和输入" },
        { status: 502 },
      );
    }
  };
}

class RecognitionInputError extends Error {}

function parseTransform(form: FormData): LicenseImageTransform {
  const rotationRaw = form.get("rotation");
  const cropRaw = form.get("crop");
  if (typeof rotationRaw !== "string" || typeof cropRaw !== "string" ||
      form.getAll("rotation").length !== 1 || form.getAll("crop").length !== 1) {
    throw new RecognitionInputError("图片编辑参数无效");
  }
  const rotation = Number(rotationRaw);
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new RecognitionInputError("图片编辑参数无效");
  }
  let crop: unknown;
  try {
    crop = JSON.parse(cropRaw);
  } catch {
    throw new RecognitionInputError("图片编辑参数无效");
  }
  if (crop === null) crop = { x: 0, y: 0, width: 1, height: 1 };
  if (!crop || typeof crop !== "object" || Array.isArray(crop)) {
    throw new RecognitionInputError("图片编辑参数无效");
  }
  const record = crop as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "height,width,x,y") {
    throw new RecognitionInputError("图片编辑参数无效");
  }
  const values = [record.x, record.y, record.width, record.height];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value)) ||
      typeof record.x !== "number" || typeof record.y !== "number" ||
      typeof record.width !== "number" || typeof record.height !== "number" ||
      record.x < 0 || record.y < 0 || record.width <= 0 || record.height <= 0 ||
      record.x + record.width > 1 || record.y + record.height > 1) {
    throw new RecognitionInputError("图片编辑参数无效");
  }
  return {
    rotation,
    crop: { x: record.x, y: record.y, width: record.width, height: record.height },
  };
}

export const POST = createCustomerDriverLicenseRecognitionHandler({
  readSession: currentSession,
  recognize: async (file, transform) => {
    const prepared = await prepareCustomerDriverLicenseImage(file, transform);
    return recognizeCustomerDriverLicense(prepared);
  },
});
