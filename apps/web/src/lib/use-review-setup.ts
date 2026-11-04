"use client";

import { DEFAULT_SETTINGS } from "@bravobites/domain";
import { useEffect, useState } from "react";
import { fetchSettings } from "@/lib/firestore";
import {
  menuUrlOf,
  reviewUrlOf,
  type ReviewSetup,
} from "@/lib/review-request";

const FALLBACK_SETUP: ReviewSetup = {
  url: "",
  lang: "both",
  shopName: DEFAULT_SETTINGS.shopName,
  menuUrl: "",
};

// One settings read for every order card on the page.
let reviewSetupLoad: Promise<ReviewSetup> | null = null;

/** Link + message language, loaded ahead so the WhatsApp click opens at once (no popup block). */
export function useReviewSetup(): ReviewSetup {
  const [setup, setSetup] = useState(FALLBACK_SETUP);
  useEffect(() => {
    let live = true;
    reviewSetupLoad ??= fetchSettings().then(
      (s) => ({
        url: reviewUrlOf(s),
        lang: s.reviewMessageLang,
        shopName: s.shopName.trim() || DEFAULT_SETTINGS.shopName,
        menuUrl: menuUrlOf(s),
      }),
      () => {
        reviewSetupLoad = null;
        return FALLBACK_SETUP;
      },
    );
    void reviewSetupLoad.then((s) => live && setSetup(s));
    return () => {
      live = false;
    };
  }, []);
  return setup;
}

/** After the owner saves new review settings, the next screen reads them again. */
export function forgetReviewSetup() {
  reviewSetupLoad = null;
}
