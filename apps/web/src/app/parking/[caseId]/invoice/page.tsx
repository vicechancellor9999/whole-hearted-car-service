import { redirect } from "next/navigation";

/** Legacy parking invoices no longer have an independent public document surface. */
export default function ParkingInvoicePage() {
  redirect("/payments");
}
