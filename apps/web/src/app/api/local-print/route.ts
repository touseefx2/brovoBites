import { NextResponse } from "next/server";
import { exec } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

/**
 * POST /api/local-print
 *
 * Receives raw ESC/POS bytes (application/octet-stream) and sends them to the
 * local thermal printer via `lp -o raw`. Only works when the Next.js server
 * runs on the same machine as the USB printer (POS counter Mac).
 *
 * The CUPS printer is expected to be named "POS80". The endpoint also accepts
 * a ?printer=NAME query param to override.
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const printer = url.searchParams.get("printer") || "POS80";

    const body = await req.arrayBuffer();
    if (!body.byteLength) {
      return NextResponse.json({ error: "empty body" }, { status: 400 });
    }

    const tmp = join(tmpdir(), `receipt-${randomUUID()}.bin`);
    await writeFile(tmp, new Uint8Array(body));

    await new Promise<void>((resolve, reject) => {
      exec(
        `lp -d ${encodeShellArg(printer)} -o raw ${encodeShellArg(tmp)}`,
        { timeout: 10_000 },
        (err, _stdout, stderr) => {
          unlink(tmp).catch(() => {});
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        },
      );
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function encodeShellArg(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
