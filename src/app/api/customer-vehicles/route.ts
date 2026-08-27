import { NextResponse } from "next/server";
import { currentSession } from "@/modules/auth/current-session";
import { createCustomerVehicleRuntime } from "@/modules/customer-vehicle/customer-vehicle-runtime";
import type { PageResult } from "@/modules/customer-vehicle/customer-vehicle-service";

type WorkspaceSession = { account: { id: number } };

type WorkspaceApiDependencies = {
  readSession(): Promise<WorkspaceSession | null>;
  listPeople(input: { viewerAccountId: number; page: number; pageSize: number }): Promise<PageResult<unknown>>;
  listCompanies(input: { viewerAccountId: number; page: number; pageSize: number }): Promise<PageResult<unknown>>;
  listCompanyContacts(input: { viewerAccountId: number; companyId: number }): Promise<unknown[]>;
  listVehicles(input: { viewerAccountId: number; page: number; pageSize: number }): Promise<PageResult<unknown>>;
  listVehicleAttachments(input: { viewerAccountId: number; vehicleIds: number[] }): Promise<unknown[]>;
  listOnSiteVehicleIds(input: { viewerAccountId: number; vehicleIds: number[] }): Promise<number[]>;
  listVehicleOwnerHistory?(input: { viewerAccountId: number; vehicleIds: number[] }): Promise<unknown[]>;
};

async function collectAll<Item>(
  loader: (input: { viewerAccountId: number; page: number; pageSize: number }) => Promise<PageResult<Item>>,
  viewerAccountId: number,
): Promise<{ items: Item[]; total: number }> {
  const items: Item[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await loader({ viewerAccountId, page, pageSize: 100 });
    items.push(...result.items);
    total = result.total;
    page += 1;
    if (result.page >= result.pageCount) break;
  } while (items.length < total);
  return { items, total };
}

export function createCustomerVehicleWorkspaceApiHandler(dependencies: WorkspaceApiDependencies) {
  return async function customerVehicleWorkspaceApiHandler(): Promise<Response> {
    const session = await dependencies.readSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    try {
      const [people, companies, vehicles] = await Promise.all([
        collectAll(dependencies.listPeople, session.account.id),
        collectAll(dependencies.listCompanies, session.account.id),
        collectAll(dependencies.listVehicles, session.account.id),
      ]);
      const vehicleIds = (vehicles.items as Array<{ id: number }>).map((vehicle) => vehicle.id);
      const [companyContacts, vehicleAttachments, onSiteVehicleIds, ownerHistory] = await Promise.all([
        Promise.all(
          (companies.items as Array<{ id: number }>).map((company) => dependencies.listCompanyContacts({
            viewerAccountId: session.account.id,
            companyId: company.id,
          })),
        ).then((groups) => groups.flat()),
        dependencies.listVehicleAttachments({
          viewerAccountId: session.account.id,
          vehicleIds,
        }),
        dependencies.listOnSiteVehicleIds({
          viewerAccountId: session.account.id,
          vehicleIds,
        }),
        dependencies.listVehicleOwnerHistory
          ? dependencies.listVehicleOwnerHistory({
            viewerAccountId: session.account.id,
            vehicleIds,
          })
          : Promise.resolve(undefined),
      ]);
      return NextResponse.json({
        people: people.items,
        companies: companies.items,
        companyContacts,
        vehicles: vehicles.items,
        vehicleAttachments,
        onSiteVehicleIds,
        ...(ownerHistory ? { ownerHistory } : {}),
        totals: {
          people: people.total,
          companies: companies.total,
          vehicles: vehicles.total,
        },
      });
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : 500;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "客户与车辆档案读取失败" },
        { status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500 },
      );
    }
  };
}

export async function GET(): Promise<Response> {
  const runtime = createCustomerVehicleRuntime(process.env);
  try {
    return await createCustomerVehicleWorkspaceApiHandler({
      readSession: currentSession,
      listPeople: (input) => runtime.service.listPersonalCustomers(input),
      listCompanies: (input) => runtime.service.listCompanyAccounts(input),
      listCompanyContacts: (input) => runtime.service.listCompanyContacts(input),
      listVehicles: (input) => runtime.service.listVehicles(input),
      listVehicleAttachments: (input) => runtime.service.listVehicleAttachments(input),
      listOnSiteVehicleIds: (input) => runtime.service.listOnSiteVehicleIds(input),
      listVehicleOwnerHistory: (input) => runtime.service.listVehicleOwnerHistory(input),
    })();
  } finally {
    await runtime.close();
  }
}
