import { NextResponse } from "next/server";
import { readBackendPort } from "@/lib/server/backendPort";

export async function GET() {
  return NextResponse.json({ port: readBackendPort() });
}
