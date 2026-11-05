"use client";

import { useEffect } from "react";

export default function OfflineFallback() {
  useEffect(() => {
    const handler = () => window.location.reload();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#1a1206] px-6 text-center">
      <img src="/logo-full.png" alt="Bravo Bites" className="h-40 w-auto" />
      <h1 className="text-xl font-bold text-[#d4a843]">You are offline</h1>
      <p className="max-w-sm text-sm text-stone-400">
        Internet connection lost. The page will reload automatically when you&apos;re back online.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-2 rounded-lg bg-[#d4a843] px-6 py-2 text-sm font-semibold text-[#1a1206] transition hover:bg-[#c49a3a]"
      >
        Retry
      </button>
    </div>
  );
}
