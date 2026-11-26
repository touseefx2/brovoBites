"use client";

import { useEffect, useState } from "react";

const PAYMENT_STATUS_KEY = "pos:printPaymentStatus";

/**
 * "Payment status" checkbox of the print previews (checkout + order sheet):
 * print "Cash - PAID" / "PENDING" on the receipt's payment line. Off by
 * default; remembered on this PC (like the Customer / Branch / Kitchen copies),
 * so it stays as it was last left.
 */
export function usePrintPaymentStatus(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PAYMENT_STATUS_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(PAYMENT_STATUS_KEY, on ? "1" : "0");
    } catch {}
  }, [on]);
  return [on, setOn];
}
