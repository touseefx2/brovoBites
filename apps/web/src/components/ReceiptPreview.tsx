"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PREVIEW_GUTTER_PX, RECEIPT_PREVIEW_WIDTH } from "@/lib/print-receipt";
import { usePosTheme } from "@/lib/pos-theme";

/**
 * POS dark mode, screen only: the slips sit on the page's dark stage instead of
 * the cream one. The paper stays white and the printed copy never sees this.
 */
function darkStageCss(stage: string) {
  return `@media screen{html{background:${stage}}.receipt{box-shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.45)}.receipt+.receipt::before{border-top-color:rgba(255,237,213,.3)}.receipt+.receipt::after{background:${stage};color:#a8907f}}`;
}

/**
 * Checkout preview = the printed document itself: the same HTML from
 * buildReceiptHtml(), laid out at paper width inside an iframe (no app CSS can
 * leak in). Narrow screens only scale it visually, so line breaks never differ
 * from the paper.
 */
export function ReceiptPreview({ html, title }: { html: string; title: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState(0);
  const [theme] = usePosTheme();

  // Same write path as printReceipt(); synchronous, so typing doesn't flicker.
  useLayoutEffect(() => {
    const el = frameRef.current;
    const doc = el?.contentDocument;
    if (!el || !doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    if (theme === "dark") {
      // Same colour as the column around the frame (--pd-sunken in globals.css).
      const stage = getComputedStyle(document.documentElement).getPropertyValue("--pd-sunken").trim();
      const style = doc.createElement("style");
      style.textContent = darkStageCss(stage || "#140a07");
      doc.head.appendChild(style);
    }
    let alive = true;
    // Body bottom, not scrollHeight: scrollHeight never drops below the current
    // frame height, so the frame would not shrink when items are removed.
    const measure = () => {
      if (!alive || !doc.body) return;
      // The paper width comes from the document (80mm, 58mm or custom roll).
      setFrame({
        width: Math.ceil(doc.body.getBoundingClientRect().width) + PREVIEW_GUTTER_PX * 2,
        height: Math.ceil(doc.body.getBoundingClientRect().bottom),
      });
    };
    measure();
    void doc.fonts?.ready.then(measure);
    return () => {
      alive = false;
    };
  }, [html, theme]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const scale =
    frame.width > 0 && available > 0 ? Math.min(1, available / frame.width) : 1;

  return (
    <div ref={boxRef} className="w-full">
      <div
        className="relative mx-auto overflow-hidden"
        style={{
          width: frame.width ? frame.width * scale : undefined,
          height: frame.height ? frame.height * scale : undefined,
        }}
      >
        <iframe
          ref={frameRef}
          title={title}
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 block border-0"
          style={{
            width: frame.width || RECEIPT_PREVIEW_WIDTH,
            height: frame.height || undefined,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: "0 0",
          }}
        />
      </div>
    </div>
  );
}
