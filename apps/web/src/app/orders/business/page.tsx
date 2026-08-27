import { Suspense } from "react";
import { FormalBusinessOrdersWorkspace } from "@/components/orders/formal-business-orders-workspace";

export default function BusinessOrdersPage() {
  return <Suspense fallback={null}><FormalBusinessOrdersWorkspace /></Suspense>;
}
