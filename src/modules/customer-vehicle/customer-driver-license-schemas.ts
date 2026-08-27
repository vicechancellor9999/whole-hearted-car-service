import { z } from "zod";

const isoBirthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, "出生日期格式不正确");

export const customerDriverLicenseSubjectSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("individual_customer"),
    personalCustomerId: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("organization_primary_contact"),
    companyAccountId: z.number().int().positive(),
    companyContactId: z.number().int().positive().nullable(),
    personalCustomerId: z.number().int().positive().nullable(),
  }).refine(
    (value) => (value.companyContactId === null) === (value.personalCustomerId === null),
    "公司联系人关系不完整",
  ),
]);

export const customerDriverLicenseProfileSchema = z.object({
  name: z.string().trim().min(1, "驾驶证姓名不能为空").max(160),
  birthDate: isoBirthDate,
  sex: z.enum(["M", "F"]),
  address: z.string().trim().min(1, "驾驶证地址不能为空").max(500),
});

export const storedCustomerDriverLicenseUploadSchema = z.object({
  storageKey: z.string().regex(
    /^customer-license-files\/\d{4}\/\d{2}\/[A-Za-z0-9-]+\.(?:jpg|png)$/,
  ),
  originalName: z.string().trim().min(1).max(255),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
  sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
});

export const customerDriverLicenseWriteSchema = z.object({
  subject: customerDriverLicenseSubjectSchema,
  file: storedCustomerDriverLicenseUploadSchema,
  profile: customerDriverLicenseProfileSchema,
  verified: z.boolean(),
});

export type LicenseSubject = z.infer<typeof customerDriverLicenseSubjectSchema>;
export type CustomerDriverLicenseProfile = z.infer<typeof customerDriverLicenseProfileSchema>;
