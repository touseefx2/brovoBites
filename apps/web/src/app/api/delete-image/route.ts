import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";

export const runtime = "nodejs";

/**
 * Server-side image deletion for ImageKit.
 * ImageKit delete requires the fileId, but we only store URLs.
 * We use the ImageKit "list files" API to find the file by URL, then delete it.
 */
export async function POST(request: NextRequest) {
  const gate = await requireOwner(request);
  if ("error" in gate && gate.error) return gate.error;

  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
  const urlEndpoint = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT?.trim();

  if (!privateKey || !urlEndpoint) {
    return NextResponse.json({ error: "ImageKit not configured" }, { status: 503 });
  }

  try {
    const { url } = (await request.json()) as { url?: string };
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    // Extract the file path from the ImageKit URL
    // URL format: https://ik.imagekit.io/<id>/path/to/file.jpg
    const endpointBase = urlEndpoint.replace(/\/$/, "");
    if (!url.startsWith(endpointBase)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const filePath = url.slice(endpointBase.length);
    const auth = Buffer.from(`${privateKey}:`).toString("base64");

    // Search for the file by path
    const searchUrl = `https://api.imagekit.io/v1/files?searchQuery=${encodeURIComponent(`filePath="${filePath}"`)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!searchRes.ok) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const files = (await searchRes.json()) as { fileId?: string }[];
    if (!files.length || !files[0]?.fileId) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Delete the file
    const deleteRes = await fetch(`https://api.imagekit.io/v1/files/${files[0].fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Basic ${auth}` },
    });

    return NextResponse.json({ ok: deleteRes.ok });
  } catch {
    return NextResponse.json({ ok: true, skipped: true });
  }
}
