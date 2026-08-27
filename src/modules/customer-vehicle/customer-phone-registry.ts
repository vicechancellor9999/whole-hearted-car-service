import type { AuthSqlExecutor } from "@formal/modules/auth/session-repository";

export type CustomerPhoneOwner = {
  ownerKind: "person" | "company";
  ownerId: number;
};

export class CustomerPhoneOwnershipConflictError extends Error {
  constructor(
    readonly normalizedPhone: string,
    readonly owner: CustomerPhoneOwner,
  ) {
    super("customer phone is owned by another customer");
    this.name = "CustomerPhoneOwnershipConflictError";
  }
}

export async function findPhoneOwner(
  executor: AuthSqlExecutor,
  normalizedPhone: string,
): Promise<CustomerPhoneOwner | null> {
  const rows = await executor.query<{ owner_kind: "person" | "company"; owner_id: number }>(
    `select owner_kind, owner_id
     from customer_phone_registry
     where normalized_phone = $1
     limit 1`,
    [normalizedPhone],
  );
  return rows[0]
    ? { ownerKind: rows[0].owner_kind, ownerId: Number(rows[0].owner_id) }
    : null;
}

export async function syncCustomerPhoneOwnership(
  executor: AuthSqlExecutor,
  input: {
    ownerKind: "person" | "company";
    ownerId: number;
    phones: Array<string | null>;
  },
): Promise<void> {
  const desired = [...new Set(input.phones.filter((phone): phone is string => Boolean(phone)))]
    .sort();
  for (const phone of desired) {
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      throw new Error("customer phone ownership requires a normalized phone");
    }
  }

  if (desired.length > 0) {
    const claimed = await executor.query<{
      normalized_phone: string;
      owner_kind: "person" | "company";
      owner_id: number;
    }>(
      `select normalized_phone, owner_kind, owner_id
       from customer_phone_registry
       where normalized_phone = any($1::text[])
       order by normalized_phone
       for update`,
      [desired],
    );
    const conflict = claimed.find((row) =>
      row.owner_kind !== input.ownerKind || Number(row.owner_id) !== input.ownerId,
    );
    if (conflict) {
      throw new CustomerPhoneOwnershipConflictError(conflict.normalized_phone, {
        ownerKind: conflict.owner_kind,
        ownerId: Number(conflict.owner_id),
      });
    }
  }

  if (desired.length === 0) {
    await executor.query(
      "delete from customer_phone_registry where owner_kind = $1 and owner_id = $2",
      [input.ownerKind, input.ownerId],
    );
  } else {
    await executor.query(
      `delete from customer_phone_registry
       where owner_kind = $1 and owner_id = $2
         and not (normalized_phone = any($3::text[]))`,
      [input.ownerKind, input.ownerId, desired],
    );
  }

  for (const phone of desired) {
    await executor.query(
      `insert into customer_phone_registry (normalized_phone, owner_kind, owner_id)
       values ($1, $2, $3)
       on conflict (normalized_phone) do nothing`,
      [phone, input.ownerKind, input.ownerId],
    );
    const owner = await findPhoneOwner(executor, phone);
    if (!owner || owner.ownerKind !== input.ownerKind || owner.ownerId !== input.ownerId) {
      if (!owner) throw new Error("customer phone ownership could not be registered");
      throw new CustomerPhoneOwnershipConflictError(phone, owner);
    }
  }
}
