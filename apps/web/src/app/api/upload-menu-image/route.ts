import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/require-owner";

export const runtime = "nodejs";

function safeExt(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]+$/.test(fromName) && fromName.length <= 5) {
    return fromName;
  }
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

/**
 * Server-side ImageKit upload (private key never sent to the browser).
 * Docs: https://docs.imagekit.io/api-reference/upload-file-api/server-side-file-upload
 */
export async function POST(request: NextRequest) {
  const gate = await requireOwner(request);
  if ("error" in gate && gate.error) return gate.error;

  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY?.trim();
  const publicKey = process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY?.trim();
  const urlEndpoint = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT?.trim();

  if (!privateKey || !publicKey || !urlEndpoint) {
    return NextResponse.json(
      {
        error:
          "ImageKit is not configured. Set NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY, NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT, and IMAGEKIT_PRIVATE_KEY.",
      },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    const pathPrefix = String(form.get("pathPrefix") || "misc").replace(
      /[^a-zA-Z0-9/_-]/g,
      "",
    );

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Please choose an image file" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Image must be under 5 MB" }, { status: 400 });
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fileName = `${id}.${safeExt(file)}`;
    const folder =
      process.env.IMAGEKIT_FOLDER?.trim() || `bravobites/menu/${pathPrefix || "misc"}`;

    const body = new FormData();
    body.append("file", file);
    body.append("fileName", fileName);
    body.append("publicKey", publicKey);
    body.append("folder", folder);
    body.append("useUniqueFileName", "true");

    const auth = Buffer.from(`${privateKey}:`).toString("base64");
    const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
      },
      body,
    });

    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      message?: string;
      help?: string;
    };

    if (!res.ok || !data.url) {
      return NextResponse.json(
        {
          error: data.message || data.help || `ImageKit upload failed (${res.status})`,
        },
        { status: res.status >= 400 ? res.status : 502 },
      );
    }

    return NextResponse.json({ url: data.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
