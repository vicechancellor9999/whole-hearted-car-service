import { expect, test } from "@playwright/test";
import { createFormalCustomer } from "../../src/lib/customers/formal-customer-create";

test("正式新建客户直接写入正式接口并返回正式编号", async () => {
  const captured: { request?: Request } = {};
  const customer = await createFormalCustomer({
    customerType: "individual",
    fullName: "  张三  ",
    organizationName: "",
    phone: " +1 876 555 0101 ",
    whatsapp: "",
    email: "",
    address: " Kingston ",
    trn: "",
  }, async (input, init) => {
    captured.request = new Request(new URL(String(input), "http://localhost"), init);
    return Response.json({
      kind: "person",
      record: {
        id: 7,
        customerNo: "CUST-202608-0007",
        fullName: "张三",
        normalizedPhone: "+18765550101",
        whatsapp: null,
        email: null,
        address: "Kingston",
        trn: null,
        isActive: true,
        version: 1,
        createdAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:00.000Z",
      },
    }, { status: 201 });
  });

  expect(captured.request?.url).toBe("http://localhost/api/formal/customers");
  expect(captured.request?.method).toBe("POST");
  await expect(captured.request?.json()).resolves.toEqual({
    customerType: "individual",
    fullName: "张三",
    organizationName: null,
    phone: "+1 876 555 0101",
    whatsapp: null,
    email: null,
    address: "Kingston",
    trn: null,
  });
  expect(customer).toMatchObject({
    id: "CUST-202608-0007",
    customerType: "individual",
    nameZh: "张三",
    nameEn: null,
    phone: "+18765550101",
    createdAt: "2026-08-26T10:00:00.000Z",
  });
});

test("正式新建客户保留后端错误信息", async () => {
  await expect(createFormalCustomer({
    customerType: "organization",
    fullName: "",
    organizationName: "重复公司",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    trn: "",
  }, async () => Response.json({ error: "TRN 已被其他客户使用" }, { status: 409 })))
    .rejects.toThrow("TRN 已被其他客户使用");
});
