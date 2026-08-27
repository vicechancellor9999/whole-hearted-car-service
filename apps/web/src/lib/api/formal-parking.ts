export type FormalParkingWorkspace = { asOf: string; items: Array<
  | { kind: "candidate"; vehicleId: number; businessOrderId: number; orderNo: string; plateDisplay: string | null; customerName: string }
  | { kind: "notice"; noticeId: number; vehicleId: number; businessOrderId: number; orderNo: string; plateDisplay: string | null; customerName: string; notifiedAt: string; pausedAt: string | null; status: "waiting_pickup" | "parking_paused_needs_front_desk_decision"; accruedParkingMinor: number | null; frontDeskDecisionRequired: boolean }
> };
async function request<T>(input: string, init?: RequestInit): Promise<T> { const response = await fetch(input, { cache: "no-store", ...init }); const payload = await response.json().catch(() => ({})) as T & { error?: unknown }; if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "待取车读取失败"); return payload; }
export const fetchFormalParking = () => request<FormalParkingWorkspace>("/api/formal/parking");
export const notifyFormalPickup = (vehicleId: number) => request<{ noticeId: number }>("/api/formal/parking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "notify", vehicleId }) });
export const recordFormalPickup = (noticeId: number) => request<{ noticeId: number }>("/api/formal/parking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pickup", noticeId }) });
