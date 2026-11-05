import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "brovobites-pos",
    time: new Date().toISOString(),
  });
}
