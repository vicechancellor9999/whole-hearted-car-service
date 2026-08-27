import { z } from "zod";
import { normalizePhone } from "@formal/modules/master-data/master-data-schemas";

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().transform((value) => value || null);

export function normalizeTrn(value: string): string {
  return value.normalize("NFKC").replace(/\D/g, "");
}

export function normalizePlate(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeVin(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
}

const optionalPhone = z.string().optional().transform((value, context) => {
  if (!value?.trim()) return null;
  const normalized = normalizePhone(value);
  if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
    context.addIssue({ code: "custom", message: "手机号格式不正确" });
    return z.NEVER;
  }
  return normalized;
});

const optionalTrn = z.string().optional().transform((value, context) => {
  if (!value?.trim()) return null;
  const normalized = normalizeTrn(value);
  if (!/^\d{9}$/.test(normalized)) {
    context.addIssue({ code: "custom", message: "TRN 必须是 9 位数字" });
    return z.NEVER;
  }
  return normalized;
});

export const createPersonalCustomerSchema = z
  .object({
    fullName: z.string().trim().min(1, "客户姓名不能为空").max(160),
    phone: optionalPhone,
    whatsapp: optionalPhone,
    email: optionalText(254),
    address: optionalText(500),
    trn: optionalTrn,
  });

export const updatePersonalCustomerSchema = createPersonalCustomerSchema.extend({
  isActive: z.boolean(),
  version: z.number().int().positive(),
});

export const createCompanyAccountSchema = z.object({
  legalName: z.string().trim().min(1, "公司名称不能为空").max(200),
  trn: optionalTrn,
  phone: optionalPhone,
  email: optionalText(254),
  address: optionalText(500),
});

export const updateCompanyAccountSchema = createCompanyAccountSchema.extend({
  isActive: z.boolean(),
  version: z.number().int().positive(),
});

export const companyContactSchema = z.object({
  companyId: z.number().int().positive(),
  personalCustomerId: z.number().int().positive(),
  jobTitle: optionalText(120),
  isPrimary: z.boolean(),
  canSign: z.boolean(),
  receivesInvoice: z.boolean(),
  receivesCollection: z.boolean(),
});

export const updateCompanyContactSchema = z.object({
  contactId: z.number().int().positive(),
  jobTitle: optionalText(120),
  isPrimary: z.boolean(),
  canSign: z.boolean(),
  receivesInvoice: z.boolean(),
  receivesCollection: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int().positive(),
});

export const vehicleOwnerSchema = z.discriminatedUnion("ownerType", [
  z.object({ ownerType: z.literal("person"), ownerId: z.number().int().positive() }),
  z.object({ ownerType: z.literal("company"), ownerId: z.number().int().positive() }),
]);

export const createVehicleSchema = z
  .object({
    plate: optionalText(40),
    vin: z.string().optional().transform((value, context) => {
      if (!value?.trim()) return null;
      const normalized = normalizeVin(value);
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) {
        context.addIssue({ code: "custom", message: "VIN 格式不正确" });
        return z.NEVER;
      }
      return normalized;
    }),
    engineNumber: optionalText(120),
    make: z.string().trim().min(1, "品牌不能为空").max(120),
    makeZh: optionalText(120),
    model: z.string().trim().min(1, "车型不能为空").max(120),
    modelZh: optionalText(120),
    modelYear: z.number().int().min(1886).max(2200).nullable().optional(),
    color: optionalText(80),
    bodyType: optionalText(80),
    fuelType: optionalText(80),
    engineCc: z.number().int().min(1).max(30_000).nullable().optional(),
    seating: z.number().int().min(1).max(200).nullable().optional(),
    usage: optionalText(160),
    specialNotes: optionalText(2_000),
  })
  .and(vehicleOwnerSchema)
  .transform((value, context) => {
    const normalizedPlate = value.plate ? normalizePlate(value.plate) : null;
    if (value.plate && !normalizedPlate) {
      context.addIssue({ code: "custom", path: ["plate"], message: "车牌格式不正确" });
      return z.NEVER;
    }
    return { ...value, normalizedPlate };
  });

export const updateVehicleSchema = z
  .object({
    plate: optionalText(40),
    vin: z.string().optional().transform((value, context) => {
      if (!value?.trim()) return null;
      const normalized = normalizeVin(value);
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) {
        context.addIssue({ code: "custom", message: "VIN 格式不正确" });
        return z.NEVER;
      }
      return normalized;
    }),
    engineNumber: optionalText(120),
    make: z.string().trim().min(1, "品牌不能为空").max(120),
    makeZh: optionalText(120),
    model: z.string().trim().min(1, "车型不能为空").max(120),
    modelZh: optionalText(120),
    modelYear: z.number().int().min(1886).max(2200).nullable().optional(),
    color: optionalText(80),
    bodyType: optionalText(80),
    fuelType: optionalText(80),
    engineCc: z.number().int().min(1).max(30_000).nullable().optional(),
    seating: z.number().int().min(1).max(200).nullable().optional(),
    usage: optionalText(160),
    specialNotes: optionalText(2_000),
    isActive: z.boolean(),
    version: z.number().int().positive(),
  })
  .transform((value, context) => {
    const normalizedPlate = value.plate ? normalizePlate(value.plate) : null;
    if (value.plate && !normalizedPlate) {
      context.addIssue({ code: "custom", path: ["plate"], message: "车牌格式不正确" });
      return z.NEVER;
    }
    return { ...value, normalizedPlate };
  });

export const changeVehicleOwnerSchema = vehicleOwnerSchema.and(
  z.object({ reason: z.string().trim().min(1, "变更原因不能为空").max(500) }),
);

export const disputeNoteSchema = z.string().trim().min(1, "争议备注不能为空").max(2_000);

export const registerVehicleAttachmentSchema = z.object({
  vehicleId: z.number().int().positive(),
  storageKey: z.string().trim().min(1).max(500),
  originalName: z.string().trim().min(1).max(255),
  mediaType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().safe().nonnegative(),
  sha256Hex: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/),
  kind: z.enum(["photo", "document", "dispute_evidence"]),
  caption: optionalText(500),
});
