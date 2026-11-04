import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

interface PublicStaff {
  displayName: string;
  phone: string;
}

interface PublicBranch {
  id: string;
  name: string;
  phone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  staff: PublicStaff[];
}

export async function GET() {
  try {
    const db = getAdminDb();

    const [branchesSnap, usersSnap] = await Promise.all([
      db.collection("branches").where("isActive", "==", true).get(),
      db.collection("users").where("role", "==", "counter").where("isActive", "==", true).get(),
    ]);

    const staffByBranch = new Map<string, PublicStaff[]>();
    for (const doc of usersSnap.docs) {
      const data = doc.data();
      const branchIds: string[] = Array.isArray(data.branchIds) ? data.branchIds : [];
      const entry: PublicStaff = {
        displayName: String(data.displayName ?? ""),
        phone: String(data.phone ?? ""),
      };
      for (const bid of branchIds) {
        const list = staffByBranch.get(bid) ?? [];
        list.push(entry);
        staffByBranch.set(bid, list);
      }
    }

    const branches: PublicBranch[] = branchesSnap.docs.map((doc) => {
      const d = doc.data();
      const lat = d.latitude != null && Number.isFinite(Number(d.latitude)) ? Number(d.latitude) : null;
      const lng = d.longitude != null && Number.isFinite(Number(d.longitude)) ? Number(d.longitude) : null;
      return {
        id: doc.id,
        name: String(d.name ?? ""),
        phone: String(d.phone ?? ""),
        address: String(d.address ?? ""),
        latitude: lat,
        longitude: lng,
        staff: staffByBranch.get(doc.id) ?? [],
      };
    });

    return NextResponse.json({ branches }, {
      headers: { "Cache-Control": "no-cache" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
