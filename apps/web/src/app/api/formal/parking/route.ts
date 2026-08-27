import { forwardFormalBackend } from "@/lib/api/formal-backend-proxy";
export async function GET(request: Request) { return forwardFormalBackend(request, "/api/parking", "none"); }
export async function POST(request: Request) { return forwardFormalBackend(request, "/api/parking", "json"); }
