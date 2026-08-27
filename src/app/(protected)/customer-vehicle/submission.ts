import { z } from "zod";
import type {
  CustomerVehicleActionContext,
  CustomerVehicleService,
} from "@/modules/customer-vehicle/customer-vehicle-service";

const id = z.coerce.number().int().positive();
const version = z.coerce.number().int().positive();
const booleanField = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalYear = z.preprocess(
  (value) => value === "" || value == null ? null : value,
  z.coerce.number().int().min(1886).max(2200).nullable(),
);
const optionalInteger = (minimum: number, maximum: number) => z.preprocess(
  (value) => value === "" || value == null ? null : value,
  z.coerce.number().int().min(minimum).max(maximum).nullable(),
);
const vehicleProfileFields = {
  plate: z.string(),
  vin: z.string().optional().default(""),
  engineNumber: z.string().optional().default(""),
  make: z.string(),
  makeZh: z.string().optional().default(""),
  model: z.string(),
  modelZh: z.string().optional().default(""),
  modelYear: optionalYear,
  color: z.string().optional().default(""),
  bodyType: z.string().optional().default(""),
  fuelType: z.string().optional().default(""),
  engineCc: optionalInteger(1, 30_000),
  seating: optionalInteger(1, 200),
  usage: z.string().optional().default(""),
  specialNotes: z.string().optional().default(""),
};
const contactFields = {
  companyId: id,
  personalCustomerId: id,
  jobTitle: z.string().optional().default(""),
  isPrimary: booleanField,
  canSign: booleanField,
  receivesInvoice: booleanField,
  receivesCollection: booleanField,
};

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create_person"), fullName: z.string(),
    phone: z.string().optional().default(""), whatsapp: z.string().optional().default(""),
    email: z.string().optional().default(""), address: z.string().optional().default(""),
    trn: z.string().optional().default(""),
  }),
  z.object({
    operation: z.literal("update_person"), customerId: id, version,
    fullName: z.string(), phone: z.string().optional().default(""),
    whatsapp: z.string().optional().default(""), email: z.string().optional().default(""),
    address: z.string().optional().default(""), trn: z.string().optional().default(""),
    isActive: booleanField,
  }),
  z.object({
    operation: z.literal("create_company"), legalName: z.string(),
    trn: z.string().optional().default(""), phone: z.string().optional().default(""),
    email: z.string().optional().default(""), address: z.string().optional().default(""),
  }),
  z.object({
    operation: z.literal("update_company"), companyId: id, version,
    legalName: z.string(), trn: z.string().optional().default(""),
    phone: z.string().optional().default(""), email: z.string().optional().default(""),
    address: z.string().optional().default(""), isActive: booleanField,
  }),
  z.object({ operation: z.literal("add_contact"), ...contactFields }),
  z.object({
    operation: z.literal("update_contact"), contactId: id, version,
    jobTitle: z.string().optional().default(""), isPrimary: booleanField,
    canSign: booleanField, receivesInvoice: booleanField,
    receivesCollection: booleanField, isActive: booleanField,
  }),
  z.object({
    operation: z.literal("create_vehicle"), ...vehicleProfileFields,
    ownerType: z.enum(["person", "company"]), ownerId: id,
  }),
  z.object({
    operation: z.literal("update_vehicle"), vehicleId: id, version,
    ...vehicleProfileFields,
    isActive: booleanField,
  }),
  z.object({
    operation: z.literal("change_owner"), vehicleId: id,
    ownerType: z.enum(["person", "company"]), ownerId: id, reason: z.string(),
  }),
  z.object({ operation: z.literal("open_dispute"), vehicleId: id, note: z.string() }),
  z.object({ operation: z.literal("resolve_dispute"), disputeId: id, note: z.string() }),
]);

export type CustomerVehicleSubmission = z.infer<typeof schema>;

export function parseCustomerVehicleSubmission(formData: FormData): CustomerVehicleSubmission {
  const raw = Object.fromEntries(formData.entries());
  if (typeof raw.ownerRef === "string" && raw.ownerRef.includes(":")) {
    const [ownerType, ownerId] = raw.ownerRef.split(":", 2);
    raw.ownerType = ownerType;
    raw.ownerId = ownerId;
  }
  return schema.parse(raw);
}

export type CustomerVehicleSubmissionService = Pick<
  CustomerVehicleService,
  | "createPersonalCustomer" | "updatePersonalCustomer"
  | "createCompanyAccount" | "updateCompanyAccount" | "addCompanyContact"
  | "updateCompanyContact"
  | "createVehicle" | "updateVehicle" | "changeVehicleOwner"
  | "openVehicleDispute" | "resolveVehicleDispute"
>;

export async function executeCustomerVehicleSubmission(
  submission: CustomerVehicleSubmission,
  service: CustomerVehicleSubmissionService,
  context: CustomerVehicleActionContext,
): Promise<{ message: string; destination: "/customers" | "/companies" | "/vehicles" }> {
  switch (submission.operation) {
    case "create_person":
      await service.createPersonalCustomer({
        fullName: submission.fullName, phone: submission.phone,
        whatsapp: submission.whatsapp, email: submission.email,
        address: submission.address, trn: submission.trn, context,
      });
      return { message: "个人客户已创建", destination: "/customers" };
    case "update_person":
      await service.updatePersonalCustomer({
        customerId: submission.customerId, version: submission.version,
        fullName: submission.fullName, phone: submission.phone,
        whatsapp: submission.whatsapp, email: submission.email,
        address: submission.address, trn: submission.trn,
        isActive: submission.isActive, context,
      });
      return { message: "个人客户资料已保存", destination: "/customers" };
    case "create_company":
      await service.createCompanyAccount({
        legalName: submission.legalName, trn: submission.trn,
        phone: submission.phone, email: submission.email,
        address: submission.address, context,
      });
      return { message: "公司账户已创建", destination: "/companies" };
    case "update_company":
      await service.updateCompanyAccount({
        companyId: submission.companyId, version: submission.version,
        legalName: submission.legalName, trn: submission.trn,
        phone: submission.phone, email: submission.email,
        address: submission.address, isActive: submission.isActive, context,
      });
      return { message: "公司账户资料已保存", destination: "/companies" };
    case "add_contact":
      await service.addCompanyContact({
        companyId: submission.companyId,
        personalCustomerId: submission.personalCustomerId,
        jobTitle: submission.jobTitle, isPrimary: submission.isPrimary,
        canSign: submission.canSign, receivesInvoice: submission.receivesInvoice,
        receivesCollection: submission.receivesCollection, context,
      });
      return { message: "公司联系人已添加", destination: "/companies" };
    case "update_contact":
      await service.updateCompanyContact({
        contactId: submission.contactId, version: submission.version,
        jobTitle: submission.jobTitle, isPrimary: submission.isPrimary,
        canSign: submission.canSign, receivesInvoice: submission.receivesInvoice,
        receivesCollection: submission.receivesCollection,
        isActive: submission.isActive, context,
      });
      return { message: "公司联系人关系已保存", destination: "/companies" };
    case "create_vehicle":
      await service.createVehicle({
        plate: submission.plate, vin: submission.vin, engineNumber: submission.engineNumber,
        make: submission.make, makeZh: submission.makeZh,
        model: submission.model, modelZh: submission.modelZh,
        modelYear: submission.modelYear, color: submission.color,
        bodyType: submission.bodyType, fuelType: submission.fuelType,
        engineCc: submission.engineCc, seating: submission.seating,
        usage: submission.usage, specialNotes: submission.specialNotes,
        ownerType: submission.ownerType,
        ownerId: submission.ownerId, context,
      });
      return { message: "车辆档案已创建", destination: "/vehicles" };
    case "update_vehicle":
      await service.updateVehicle({
        vehicleId: submission.vehicleId, version: submission.version,
        plate: submission.plate, vin: submission.vin, engineNumber: submission.engineNumber,
        make: submission.make, makeZh: submission.makeZh,
        model: submission.model, modelZh: submission.modelZh,
        modelYear: submission.modelYear, color: submission.color,
        bodyType: submission.bodyType, fuelType: submission.fuelType,
        engineCc: submission.engineCc, seating: submission.seating,
        usage: submission.usage, specialNotes: submission.specialNotes,
        isActive: submission.isActive, context,
      });
      return { message: "车辆档案已保存", destination: "/vehicles" };
    case "change_owner":
      await service.changeVehicleOwner({
        vehicleId: submission.vehicleId, ownerType: submission.ownerType,
        ownerId: submission.ownerId, reason: submission.reason, context,
      });
      return { message: "车辆归属已变更并保留历史", destination: "/vehicles" };
    case "open_dispute":
      await service.openVehicleDispute({
        vehicleId: submission.vehicleId, note: submission.note, context,
      });
      return { message: "客户争议已记录", destination: "/vehicles" };
    case "resolve_dispute":
      await service.resolveVehicleDispute({
        disputeId: submission.disputeId, note: submission.note, context,
      });
      return { message: "客户争议已解决并记录", destination: "/vehicles" };
  }
}
