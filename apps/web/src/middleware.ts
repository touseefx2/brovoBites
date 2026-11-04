import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCustomerMode } from "@/lib/customer-mode";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!isCustomerMode(host)) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/pos") ||
    pathname.startsWith("/api/admin")
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/login", "/pos", "/api/admin/:path*"],
};
