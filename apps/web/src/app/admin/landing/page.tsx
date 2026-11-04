"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  coerceBusinessTime,
  isValidBusinessTime,
  normalizeBusinessDayHours,
  toOrderItems,
  type ReceiptPaper,
  type ReviewMessageLang,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { fetchSettings, saveSettings } from "@/lib/firestore";
import { uploadLogoImage, uploadHeroSlide, deleteUploadedImage, MAX_HERO_SLIDES } from "@/lib/storage";
import { ImageUploadField } from "@/components/ImageUpload";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ReportEmailSettings } from "@/components/ReportEmailSettings";
import { printReceipt, receiptLabels } from "@/lib/print-receipt";
import { reviewUrlOf } from "@/lib/review-request";
import { forgetReviewSetup } from "@/lib/use-review-setup";

/** Same bounds as the receipt builder (receiptPrintWidthMm in lib/print-receipt). */
function clampPrintWidth(mm: number): number {
  if (!Number.isFinite(mm) || mm <= 0) return DEFAULT_SETTINGS.receiptPrintWidthMm;
  return Math.min(104, Math.max(40, Math.round(mm)));
}

type SlideEntry = { type: "remote"; url: string } | { type: "pending"; file: File; preview: string };

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white shadow-sm overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[#faf8f5] px-5 py-3.5">
        <h2 className="text-sm font-bold text-[var(--ink)] uppercase tracking-wide">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-[var(--muted)]">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function LandingPageSettings() {
  const { t, dir } = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [shopName, setShopName] = useState(DEFAULT_SETTINGS.shopName);
  const [slogan, setSlogan] = useState(DEFAULT_SETTINGS.slogan);
  const [eyebrow, setEyebrow] = useState(DEFAULT_SETTINGS.eyebrow);
  const [copyrightName, setCopyrightName] = useState(DEFAULT_SETTINGS.copyrightName);
  const [whatsappNumber, setWhatsappNumber] = useState(DEFAULT_SETTINGS.whatsappNumber);
  const [googleReviewUrl, setGoogleReviewUrl] = useState(DEFAULT_SETTINGS.googleReviewUrl);
  const [reviewMessageLang, setReviewMessageLang] = useState<ReviewMessageLang>(
    DEFAULT_SETTINGS.reviewMessageLang,
  );
  const [menuUrl, setMenuUrl] = useState(DEFAULT_SETTINGS.menuUrl);
  const [taxPercent, setTaxPercent] = useState(DEFAULT_SETTINGS.taxPercent);
  const [deliveryCharges, setDeliveryCharges] = useState(DEFAULT_SETTINGS.deliveryCharges);
  const [softwareCompanyName, setSoftwareCompanyName] = useState(
    DEFAULT_SETTINGS.softwareCompanyName,
  );
  const [softwareCompanyPhone, setSoftwareCompanyPhone] = useState(
    DEFAULT_SETTINGS.softwareCompanyPhone,
  );
  const [receiptPaper, setReceiptPaper] = useState<ReceiptPaper>(
    DEFAULT_SETTINGS.receiptPaper,
  );
  const [receiptPrintWidthMm, setReceiptPrintWidthMm] = useState(
    DEFAULT_SETTINGS.receiptPrintWidthMm,
  );
  const [businessDayStart, setBusinessDayStart] = useState(
    DEFAULT_SETTINGS.businessDayStart,
  );
  const [businessDayEnd, setBusinessDayEnd] = useState(
    DEFAULT_SETTINGS.businessDayEnd,
  );
  const [logoUrl, setLogoUrl] = useState("");
  const [logoPending, setLogoPending] = useState<File | null>(null);

  const [slides, setSlides] = useState<SlideEntry[]>([]);
  const [slideError, setSlideError] = useState<string | null>(null);
  const slideInputRef = useRef<HTMLInputElement>(null);

  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
  const [deleteAll, setDeleteAll] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const hasPendingSlides = slides.some((s) => s.type === "pending");
  const remoteSlides = slides.filter((s) => s.type === "remote");

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setShopName(s.shopName);
        setSlogan(s.slogan);
        setEyebrow(s.eyebrow);
        setCopyrightName(s.copyrightName);
        setWhatsappNumber(s.whatsappNumber);
        setGoogleReviewUrl(s.googleReviewUrl);
        setReviewMessageLang(s.reviewMessageLang);
        setMenuUrl(s.menuUrl);
        setTaxPercent(s.taxPercent);
        setDeliveryCharges(s.deliveryCharges);
        setSoftwareCompanyName(s.softwareCompanyName);
        setSoftwareCompanyPhone(s.softwareCompanyPhone);
        setReceiptPaper(s.receiptPaper);
        setReceiptPrintWidthMm(s.receiptPrintWidthMm);
        setBusinessDayStart(s.businessDayStart || DEFAULT_SETTINGS.businessDayStart);
        setBusinessDayEnd(s.businessDayEnd || DEFAULT_SETTINGS.businessDayEnd);
        setLogoUrl(s.logoUrl);
        setSlides((s.heroSlides ?? []).map((url) => ({ type: "remote" as const, url })));
      })
      .catch(() => showToast("error", t("loadFailed")))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    return () => {
      for (const s of slides) {
        if (s.type === "pending") URL.revokeObjectURL(s.preview);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    if (type === "success") {
      setTimeout(() => setToast(null), 4000);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setToast(null);

    try {
      const start = coerceBusinessTime(businessDayStart);
      const end = coerceBusinessTime(businessDayEnd);
      if (!start || !end || !isValidBusinessTime(start) || !isValidBusinessTime(end)) {
        showToast("error", t("businessDayInvalid"));
        setSaving(false);
        return;
      }

      let finalLogoUrl = logoUrl;
      if (logoPending) {
        finalLogoUrl = await uploadLogoImage(logoPending);
        setLogoPending(null);
      }

      const finalSlides: string[] = [];
      const newEntries: SlideEntry[] = [];
      for (const slide of slides) {
        if (slide.type === "remote") {
          finalSlides.push(slide.url);
          newEntries.push(slide);
        } else {
          const url = await uploadHeroSlide(slide.file);
          finalSlides.push(url);
          URL.revokeObjectURL(slide.preview);
          newEntries.push({ type: "remote", url });
        }
      }

      await saveSettings({
        shopName: shopName.trim(),
        slogan: slogan.trim(),
        eyebrow: eyebrow.trim(),
        copyrightName: copyrightName.trim(),
        whatsappNumber: whatsappNumber.trim(),
        googleReviewUrl: googleReviewUrl.trim(),
        reviewMessageLang,
        menuUrl: menuUrl.trim(),
        taxPercent: Math.max(0, taxPercent),
        deliveryCharges: Math.max(0, deliveryCharges),
        softwareCompanyName: softwareCompanyName.trim(),
        softwareCompanyPhone: softwareCompanyPhone.trim(),
        receiptPaper,
        receiptPrintWidthMm: clampPrintWidth(receiptPrintWidthMm),
        businessDayStart: start,
        businessDayEnd: end,
        logoUrl: finalLogoUrl,
        heroSlides: finalSlides,
      });

      forgetReviewSetup();
      setBusinessDayStart(start);
      setBusinessDayEnd(end);
      setLogoUrl(finalLogoUrl);
      setSlides(newEntries);
      showToast("success", t("settingsSaved"));
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : t("errGeneric"));
    } finally {
      setSaving(false);
    }
  }

  /** One sample customer copy on the selected roll — prints before saving, to check the printer setup. */
  function handleTestPrint() {
    const items = toOrderItems([
      { key: "1", productId: "t1", productName: "Chicken Sajji", variationLabel: "Half", unitPrice: 1450, qty: 2, note: "extra spicy" },
      { key: "2", productId: "t2", productName: "Zinger Burger", unitPrice: 690, qty: 3 },
      { key: "3", productId: "t3", productName: "Soft Drink 1.5L", unitPrice: 250, qty: 10 },
    ]);
    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const ok = printReceipt({
      order: {
        orderNumber: 99,
        createdAt: new Date().toISOString(),
        orderType: "dine-in",
        items,
        subtotal,
        total: subtotal,
        paymentMethod: "cash",
        tableNumber: "9",
        customerName: "Test Customer",
        createdByName: "Test",
      },
      shopName: shopName.trim() || DEFAULT_SETTINGS.shopName,
      softwareCompanyName: softwareCompanyName.trim(),
      softwareCompanyPhone: softwareCompanyPhone.trim(),
      labels: receiptLabels(t),
      reviewUrl: reviewUrlOf({ googleReviewUrl }),
      dir,
      paper: receiptPaper,
      paperWidthMm: clampPrintWidth(receiptPrintWidthMm),
      copies: ["customer"],
    });
    if (!ok) showToast("error", t("errGeneric"));
  }

  function handleAddSlides(files: FileList | null) {
    if (!files || files.length === 0) return;
    setSlideError(null);

    const remaining = MAX_HERO_SLIDES - slides.length;
    if (remaining <= 0) {
      setSlideError(t("maxSlidesReached"));
      return;
    }

    const toAdd = Array.from(files).slice(0, remaining);
    const skipped = files.length - toAdd.length;
    const errors: string[] = [];
    const accepted: SlideEntry[] = [];

    for (const file of toAdd) {
      if (!file.type.startsWith("image/")) {
        errors.push(`${file.name}: ${t("imageInvalidType")}`);
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        errors.push(`${file.name}: ${t("imageTooLarge")}`);
        continue;
      }
      accepted.push({ type: "pending", file, preview: URL.createObjectURL(file) });
    }

    if (skipped > 0) {
      errors.push(`${skipped} file(s) skipped — max ${MAX_HERO_SLIDES} slides`);
    }

    if (accepted.length > 0) {
      setSlides((prev) => [...prev, ...accepted]);
    }
    if (errors.length > 0) {
      setSlideError(errors.join("\n"));
    }
    if (slideInputRef.current) slideInputRef.current.value = "";
  }

  async function confirmDeleteSlide() {
    if (deleteIdx === null) return;
    const slide = slides[deleteIdx];
    if (!slide) { setDeleteIdx(null); return; }

    setDeleting(true);
    try {
      if (slide.type === "remote") {
        await deleteUploadedImage(slide.url);
      } else {
        URL.revokeObjectURL(slide.preview);
      }

      const newSlides = slides.filter((_, i) => i !== deleteIdx);
      setSlides(newSlides);

      if (slide.type === "remote") {
        await saveSettings({
          heroSlides: newSlides.filter((s) => s.type === "remote").map((s) => (s as { type: "remote"; url: string }).url),
        });
      }
    } catch {
      // best-effort
    } finally {
      setDeleting(false);
      setDeleteIdx(null);
    }
  }

  async function confirmDeleteAll() {
    setDeleting(true);
    try {
      const deletePromises = slides.map((s) => {
        if (s.type === "remote") return deleteUploadedImage(s.url);
        URL.revokeObjectURL(s.preview);
        return Promise.resolve();
      });
      await Promise.all(deletePromises);
      setSlides([]);
      await saveSettings({ heroSlides: [] });
    } catch {
      // best-effort
    } finally {
      setDeleting(false);
      setDeleteAll(false);
    }
  }

  // The daily owner-report email goes out after this day closes.
  const reportHours = useMemo(
    () => normalizeBusinessDayHours(businessDayStart, businessDayEnd),
    [businessDayStart, businessDayEnd],
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gold-deep)]">
            {t("landingPage")}
          </p>
          <h1 className="text-2xl font-bold text-[var(--ink)]">{t("landingPage")}</h1>
        </div>
        <div className="flex items-center justify-center py-16">
          <span className="spinner" aria-hidden />
          <span className="sr-only">{t("loading")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--gold-deep)]">
          {t("landingPage")}
        </p>
        <h1 className="text-2xl font-bold text-[var(--ink)]">{t("landingPage")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("landingPageHint")}</p>
      </div>

      <ReportEmailSettings hours={reportHours} />

      <form onSubmit={handleSave} className="space-y-5">
        {/* ── Branding ── */}
        <SectionCard title={t("logoLabel")} description={t("logoHint")}>
          <ImageUploadField
            label={t("logoLabel")}
            remoteUrl={logoUrl}
            pendingFile={logoPending}
            onPendingFile={setLogoPending}
            onClearRemote={() => setLogoUrl("")}
            disabled={saving}
          />
        </SectionCard>

        {/* ── Shop Info ── */}
        <SectionCard title={t("shopNameLabel")} description="Your restaurant name and branding text">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("shopNameLabel")}
              </label>
              <input
                type="text"
                className="input w-full"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("sloganLabel")}
              </label>
              <input
                type="text"
                className="input w-full"
                value={slogan}
                onChange={(e) => setSlogan(e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("eyebrowLabel")}
              </label>
              <input
                type="text"
                className="input w-full"
                value={eyebrow}
                onChange={(e) => setEyebrow(e.target.value)}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-[var(--muted)]">{t("eyebrowHint")}</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("copyrightLabel")}
              </label>
              <input
                type="text"
                className="input w-full"
                value={copyrightName}
                onChange={(e) => setCopyrightName(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
        </SectionCard>

        {/* ── Software company (receipt footer) ── */}
        <SectionCard
          title={t("softwareCompanySection")}
          description={t("softwareCompanySectionHint")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("softwareCompanyNameLabel")}
              </label>
              <input
                type="text"
                className="input w-full"
                placeholder="Nexora"
                value={softwareCompanyName}
                onChange={(e) => setSoftwareCompanyName(e.target.value)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("softwareCompanyPhoneLabel")}
              </label>
              <input
                type="tel"
                className="input w-full"
                placeholder="0307-5839836"
                value={softwareCompanyPhone}
                onChange={(e) => setSoftwareCompanyPhone(e.target.value)}
                disabled={saving}
                dir="ltr"
              />
            </div>
          </div>
        </SectionCard>

        {/* ── Receipt printer (paper roll + setup steps) ── */}
        <SectionCard
          title={t("receiptPaperSection")}
          description={t("receiptPaperSectionHint")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("receiptPaperLabel")}
              </label>
              <select
                className="input w-full"
                value={receiptPaper}
                onChange={(e) => {
                  const next = e.target.value as ReceiptPaper;
                  setReceiptPaper(next);
                  if (next === "80mm") setReceiptPrintWidthMm(72);
                  if (next === "58mm") setReceiptPrintWidthMm(48);
                }}
                disabled={saving}
              >
                <option value="80mm">{t("receiptPaper80")}</option>
                <option value="58mm">{t("receiptPaper58")}</option>
                <option value="custom">{t("receiptPaperCustom")}</option>
              </select>
            </div>
            {receiptPaper === "custom" ? (
              <div>
                <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                  {t("receiptPrintWidthLabel")}
                </label>
                <input
                  type="number"
                  min="40"
                  max="104"
                  step="1"
                  className="input w-full sm:max-w-xs"
                  value={receiptPrintWidthMm || ""}
                  onChange={(e) => setReceiptPrintWidthMm(Number(e.target.value) || 0)}
                  onBlur={() => setReceiptPrintWidthMm(clampPrintWidth(receiptPrintWidthMm))}
                  disabled={saving}
                  dir="ltr"
                />
                <p className="mt-1 text-xs text-[var(--muted)]">{t("receiptPrintWidthHint")}</p>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleTestPrint}
              disabled={saving}
            >
              🖨️ {t("receiptTestPrint")}
            </button>
            <p className="text-xs text-[var(--muted)]">{t("receiptTestPrintHint")}</p>
          </div>

          <details className="mt-4 rounded-xl border border-[var(--border)] bg-[#faf8f5] px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
              {t("receiptSetupTitle")}
            </summary>
            <ol className="mt-3 list-decimal space-y-2 ps-5 text-xs leading-relaxed text-[var(--ink)]">
              {(
                [
                  "receiptSetupStep1",
                  "receiptSetupStep2",
                  "receiptSetupStep3",
                  "receiptSetupStep4",
                  "receiptSetupStep5",
                  "receiptSetupStep6",
                  "receiptSetupStep7",
                  "receiptSetupStep8",
                  "receiptSetupStep9",
                ] as const
              ).map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ol>
          </details>
        </SectionCard>

        {/* ── WhatsApp ── */}
        <SectionCard title={t("whatsappNumberLabel")} description={t("whatsappNumberHint")}>
          <div>
            <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
              {t("whatsappNumberLabel")}
            </label>
            <input
              type="tel"
              className="input w-full sm:max-w-xs"
              placeholder="03XX-XXXXXXX"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              disabled={saving}
            />
          </div>
        </SectionCard>

        {/* ── Google review link (receipt QR + WhatsApp review) ── */}
        <SectionCard title={t("googleReviewUrlLabel")} description={t("googleReviewUrlHint")}>
          <div>
            <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
              {t("googleReviewUrlLabel")}
            </label>
            <input
              type="url"
              className="input w-full"
              placeholder="https://g.page/r/…/review"
              value={googleReviewUrl}
              onChange={(e) => setGoogleReviewUrl(e.target.value)}
              disabled={saving}
              dir="ltr"
            />
            {googleReviewUrl.trim() ? (
              <a
                href={googleReviewUrl.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block text-xs font-semibold text-[var(--gold-deep)] underline"
              >
                {t("googleReviewUrlTest")}
              </a>
            ) : null}
          </div>
          <div className="mt-4">
            <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
              {t("reviewMessageLangLabel")}
            </label>
            <select
              className="input w-full sm:max-w-xs"
              value={reviewMessageLang}
              onChange={(e) => setReviewMessageLang(e.target.value as ReviewMessageLang)}
              disabled={saving}
            >
              <option value="both">{t("reviewMessageLangBoth")}</option>
              <option value="en">{t("reviewMessageLangEn")}</option>
              <option value="ur">{t("reviewMessageLangUr")}</option>
            </select>
          </div>
          <div className="mt-4">
            <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
              {t("menuUrlLabel")}
            </label>
            <input
              type="url"
              className="input w-full"
              placeholder="https://your-domain.com/#menu"
              value={menuUrl}
              onChange={(e) => setMenuUrl(e.target.value)}
              disabled={saving}
              dir="ltr"
            />
            <p className="mt-1 text-xs text-[var(--muted)]">{t("menuUrlHint")}</p>
            {menuUrl.trim() ? (
              <a
                href={menuUrl.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block text-xs font-semibold text-[var(--gold-deep)] underline"
              >
                {t("googleReviewUrlTest")}
              </a>
            ) : null}
          </div>
        </SectionCard>

        {/* ── Tax & Delivery ── */}
        <SectionCard title={t("taxPercentLabel")} description={t("taxPercentHint")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("taxPercentLabel")}
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                className="input w-full sm:max-w-xs"
                placeholder="0"
                value={taxPercent || ""}
                onChange={(e) => setTaxPercent(Number(e.target.value) || 0)}
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("deliveryChargesLabel")}
              </label>
              <input
                type="number"
                min="0"
                step="1"
                className="input w-full sm:max-w-xs"
                placeholder="0"
                value={deliveryCharges || ""}
                onChange={(e) => setDeliveryCharges(Number(e.target.value) || 0)}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-[var(--muted)]">{t("deliveryChargesHint")}</p>
            </div>
          </div>
        </SectionCard>

        {/* ── Business day (Pakistan) ── */}
        <SectionCard title={t("businessDaySection")} description={t("businessDaySectionHint")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("businessDayStartLabel")}
              </label>
              <input
                type="time"
                className="input w-full min-h-11 text-base sm:max-w-xs"
                value={businessDayStart}
                onChange={(e) => {
                  const next = coerceBusinessTime(e.target.value);
                  setBusinessDayStart(next ?? e.target.value);
                }}
                disabled={saving}
                dir="ltr"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1.5">
                {t("businessDayEndLabel")}
              </label>
              <input
                type="time"
                className="input w-full min-h-11 text-base sm:max-w-xs"
                value={businessDayEnd}
                onChange={(e) => {
                  const next = coerceBusinessTime(e.target.value);
                  setBusinessDayEnd(next ?? e.target.value);
                }}
                disabled={saving}
                dir="ltr"
                required
              />
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <button
              type="button"
              className="min-h-11 rounded-xl border border-[var(--border)] bg-[#faf8f5] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[#f0ebe3] disabled:opacity-50"
              disabled={
                saving ||
                (businessDayStart === DEFAULT_SETTINGS.businessDayStart &&
                  businessDayEnd === DEFAULT_SETTINGS.businessDayEnd)
              }
              onClick={() => {
                setBusinessDayStart(DEFAULT_SETTINGS.businessDayStart);
                setBusinessDayEnd(DEFAULT_SETTINGS.businessDayEnd);
              }}
            >
              {t("businessDayReset")}
            </button>
            <p className="text-xs text-[var(--muted)]">{t("businessDayResetHint")}</p>
          </div>
        </SectionCard>

        {/* ── Hero Slides ── */}
        <SectionCard
          title={`${t("heroSlidesLabel")}  ${slides.length}/${MAX_HERO_SLIDES}`}
          description={t("heroSlidesHint")}
        >
          <div className="space-y-4">
            {slides.length === 0 && (
              <p className="text-sm text-[var(--muted)] italic py-2">{t("noSlides")}</p>
            )}

            {slides.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {slides.map((slide, i) => {
                  const src = slide.type === "remote" ? slide.url : slide.preview;
                  const isPending = slide.type === "pending";
                  return (
                    <div key={`${src}-${i}`} className="group relative overflow-hidden rounded-xl border border-[var(--border)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={`Slide ${i + 1}`}
                        className="aspect-video w-full object-cover"
                      />
                      <button
                        type="button"
                        className="absolute top-1.5 end-1.5 rounded-lg bg-black/60 px-2 py-1 text-xs font-medium text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100"
                        disabled={saving || deleting}
                        onClick={() => {
                          if (isPending) {
                            URL.revokeObjectURL(slide.preview);
                            setSlides((prev) => prev.filter((_, idx) => idx !== i));
                          } else {
                            setDeleteIdx(i);
                          }
                        }}
                      >
                        {t("removeSlide")}
                      </button>
                      <span className="absolute bottom-1.5 start-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {i + 1}
                      </span>
                      {isPending && (
                        <span className="absolute bottom-1.5 end-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {t("imagePendingSave")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={saving || deleting || slides.length >= MAX_HERO_SLIDES}
                onClick={() => slideInputRef.current?.click()}
              >
                {t("addSlide")}
              </button>
              {remoteSlides.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-red-600 hover:bg-red-50"
                  disabled={saving || deleting}
                  onClick={() => setDeleteAll(true)}
                >
                  {t("deleteAllSlides")}
                </button>
              )}
              {slides.length >= MAX_HERO_SLIDES && (
                <span className="text-xs text-[var(--muted)]">{t("maxSlidesReached")}</span>
              )}
              <input
                ref={slideInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                disabled={saving || deleting}
                multiple
                onChange={(e) => handleAddSlides(e.target.files)}
              />
            </div>

            {slideError && (
              <p className="text-xs text-[var(--danger)] whitespace-pre-line">{slideError}</p>
            )}
          </div>
        </SectionCard>

        {/* ── Toast (inline near save) ── */}
        {toast && (
          <div
            className={`flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-sm ${
              toast.type === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            <span className="text-base" aria-hidden>
              {toast.type === "success" ? "✓" : "✗"}
            </span>
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              className="ml-auto text-xs opacity-60 hover:opacity-100"
              onClick={() => setToast(null)}
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Save ── */}
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-white px-5 py-4 shadow-sm">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || deleting}
          >
            {t("save")}
          </button>
          {(logoPending || hasPendingSlides) && (
            <p className="text-xs font-medium text-[var(--gold-deep)]">
              {t("imagePendingSave")}
            </p>
          )}
        </div>
      </form>

      {/* ── Saving overlay ── */}
      {saving && (
        <div className="action-overlay" role="status" aria-live="polite">
          <div className="action-overlay-card">
            <span className="spinner" aria-hidden />
            <p className="text-sm font-semibold text-[var(--ink)]">{t("saving")}</p>
            <p className="text-xs text-[var(--muted)]">Uploading images & saving settings...</p>
          </div>
        </div>
      )}

      {/* ── Delete single slide confirmation ── */}
      <ConfirmDialog
        open={deleteIdx !== null}
        title={t("removeSlide")}
        message={t("confirmDeleteSlide")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        busy={deleting}
        danger
        onCancel={() => { if (!deleting) setDeleteIdx(null); }}
        onConfirm={() => void confirmDeleteSlide()}
      />

      {/* ── Delete all slides confirmation ── */}
      <ConfirmDialog
        open={deleteAll}
        title={t("deleteAllSlides")}
        message={t("confirmDeleteAllSlides")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        busy={deleting}
        danger
        onCancel={() => { if (!deleting) setDeleteAll(false); }}
        onConfirm={() => void confirmDeleteAll()}
      />
    </div>
  );
}
