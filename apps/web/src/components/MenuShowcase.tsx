"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import {
  formatPkr,
  type Category,
  type Product,
} from "@bravobites/domain";
import { useLocale } from "@/i18n/locale-context";
import { usePublicMenu } from "@/lib/menu-context";
import { resolveProductImage, resolveCategoryImage } from "@/lib/menu-images";
import { MenuMediaImage } from "@/components/MenuMediaImage";
import { ButtonSpinner, LoadError, PageSpinner } from "@/components/Loading";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAction } from "@/components/ActionProvider";
import { mapFirebaseError } from "@/lib/errors";
import { notifyActionFailed } from "@/lib/action";
import { useRetryOnReconnect } from "@/lib/use-retry-on-reconnect";
import {
  deleteCategory,
  deleteProduct,
  fetchCategories,
  fetchProducts,
  saveCategory,
  saveProduct,
} from "@/lib/firestore";
import {
  invalidatePublicMenuCache,
  peekPublicMenu,
  subscribeMenuCacheInvalidation,
} from "@/lib/menu-data";
import { deleteUploadedImage } from "@/lib/storage";

function PriceBlock({ product, fromLabel }: { product: Product; fromLabel: string }) {
  if (
    product.compareAtPrice != null &&
    product.compareAtPrice > product.basePrice
  ) {
    return (
      <div className="landing-price-stack" dir="ltr">
        <span className="landing-was">{formatPkr(product.compareAtPrice)}</span>
        <span className="landing-price-badge">{formatPkr(product.basePrice)}</span>
      </div>
    );
  }

  if (product.type === "sized" && product.variations.length) {
    const prices = product.variations.map((v) => v.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return (
      <div className="landing-price-stack" dir="ltr">
        <span className="landing-price-badge">
          {min === max ? formatPkr(min) : `${fromLabel} ${formatPkr(min)}`}
        </span>
      </div>
    );
  }

  return (
    <div className="landing-price-stack" dir="ltr">
      <span className="landing-price-badge">{formatPkr(product.basePrice)}</span>
    </div>
  );
}

function matchesQuery(product: Product, q: string, categoryName = "") {
  if (!q) return true;
  if (categoryName.toLowerCase().includes(q)) return true;
  const hay = [
    product.name,
    ...product.variations.map((v) => v.label),
    ...product.dealItems.map((d) => d.label),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function sectionId(catId: string) {
  return `menu-section-${catId}`;
}

type MenuShowcaseProps = {
  /** Owner: full catalog + add/edit/hide/delete on the showcase UI. */
  manage?: boolean;
};

/** Landing-style menu; optional owner manage actions on the same layout. */
export function MenuShowcase({ manage = false }: MenuShowcaseProps) {
  const { t, locale } = useLocale();
  const { runAction, busy: actionBusy } = useAction();
  const {
    categories: publicCategories,
    products: publicProducts,
    showBootLoader: publicBoot,
    hasData: publicHasData,
    error: publicError,
    refresh: refreshPublic,
    status: publicStatus,
  } = usePublicMenu();

  const [manageCategories, setManageCategories] = useState<Category[]>([]);
  const [manageProducts, setManageProducts] = useState<Product[]>([]);
  const [pageLoading, setPageLoading] = useState(() => manage && !peekPublicMenu());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<{
    category: Category;
    products: Product[];
  } | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<Product | null>(null);
  const [pendingToggleProduct, setPendingToggleProduct] = useState<Product | null>(null);
  const [pendingToggleCategory, setPendingToggleCategory] = useState<Category | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);
  const catsRef = useRef<HTMLElement>(null);
  const scrollLockRef = useRef(false);
  const mountedRef = useRef(true);
  const manageFetchGen = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadManageMenu = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (!manage) return;
      const soft = opts?.soft === true;
      const gen = ++manageFetchGen.current;
      if (!soft) {
        setPageLoading(true);
        setLoadError(null);
      }
      try {
        const [c, p] = await Promise.all([
          fetchCategories(),
          fetchProducts(),
        ]);
        if (!mountedRef.current || gen !== manageFetchGen.current) return;
        setManageCategories(c);
        setManageProducts(p);
        setLoadError(null);
      } catch (e) {
        if (!mountedRef.current || gen !== manageFetchGen.current) return;
        if (!soft) {
          setLoadError(mapFirebaseError(e, locale) || t("loadFailed"));
        }
      } finally {
        if (mountedRef.current && gen === manageFetchGen.current) {
          setPageLoading(false);
        }
      }
    },
    [manage, locale, t],
  );

  useEffect(() => {
    if (manage) {
      const cached = peekPublicMenu();
      if (cached) {
        setManageCategories(cached.categories);
        setManageProducts(cached.products);
        setPageLoading(false);
      }
      void loadManageMenu({ soft: Boolean(cached) });
      return;
    }
    void refreshPublic(true);
  }, [manage, loadManageMenu, refreshPublic]);

  // Owner manage list: soft-refetch when another tab saves (add/edit/delete).
  // subscribeMenuCacheInvalidation cleans BroadcastChannel + listeners on unmount.
  useEffect(() => {
    if (!manage) return;
    return subscribeMenuCacheInvalidation(() => {
      void loadManageMenu({ soft: true });
    });
  }, [manage, loadManageMenu]);

  useRetryOnReconnect(Boolean(manage && loadError && !pageLoading), () => {
    void loadManageMenu();
  });

  function showFail(msg: string) {
    notifyActionFailed(msg, setActionError);
    queueMicrotask(() => {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  const categories = manage ? manageCategories : publicCategories;
  const products = manage ? manageProducts : publicProducts;
  const showBootLoader = manage ? pageLoading : publicBoot;
  const hasData = manage
    ? manageCategories.length > 0 || manageProducts.length > 0
    : publicHasData;
  const error = manage ? loadError : publicError;
  const status = manage
    ? pageLoading
      ? "loading"
      : loadError
        ? "error"
        : "ready"
    : publicStatus;

  const q = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    const sections = categories
      .map((cat) => ({
        category: cat,
        items: products
          .filter((p) => p.categoryId === cat.id)
          .filter((p) => matchesQuery(p, q, cat.name))
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((g) => {
        if (manage && !q) return true;
        return g.items.length > 0;
      });

    if (!manage) return { sections, orphans: [] as Product[] };

    const catIds = new Set(categories.map((c) => c.id));
    const orphans = products
      .filter((p) => !catIds.has(p.categoryId))
      .filter((p) => matchesQuery(p, q))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return { sections, orphans };
  }, [categories, products, q, manage]);

  useEffect(() => {
    if (!grouped.sections.length) {
      setActiveCat("");
      return;
    }
    setActiveCat((prev) =>
      grouped.sections.some((g) => g.category.id === prev)
        ? prev
        : grouped.sections[0].category.id,
    );
  }, [grouped.sections]);

  const scrollChipIntoView = useCallback((catId: string) => {
    const nav = catsRef.current;
    const chip = nav?.querySelector<HTMLElement>(
      `.admin-menu-cat[data-cat="${CSS.escape(catId)}"]`,
    );
    if (!nav || !chip) return;
    const next = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, next), behavior: "smooth" });
  }, []);

  const scrollToCategory = useCallback(
    (catId: string) => {
      const list = listRef.current;
      const el = document.getElementById(sectionId(catId));
      if (!list || !el) return;

      scrollLockRef.current = true;
      setActiveCat(catId);
      scrollChipIntoView(catId);

      const nextTop =
        list.scrollTop +
        (el.getBoundingClientRect().top - list.getBoundingClientRect().top) -
        12;
      list.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });

      window.setTimeout(() => {
        scrollLockRef.current = false;
      }, 650);
    },
    [scrollChipIntoView],
  );

  useEffect(() => {
    if (showBootLoader || !grouped.sections.length) return;
    const list = listRef.current;
    if (!list) return;

    const pickActive = () => {
      if (scrollLockRef.current) return;
      const listTop = list.getBoundingClientRect().top;
      const marker = listTop + 28;
      let current = grouped.sections[0]?.category.id ?? "";
      for (const g of grouped.sections) {
        const el = document.getElementById(sectionId(g.category.id));
        if (!el) continue;
        if (el.getBoundingClientRect().top <= marker) current = g.category.id;
      }
      setActiveCat((prev) => {
        if (prev === current) return prev;
        scrollChipIntoView(current);
        return current;
      });
    };

    list.addEventListener("scroll", pickActive, { passive: true });
    pickActive();
    return () => list.removeEventListener("scroll", pickActive);
  }, [showBootLoader, grouped.sections, scrollChipIntoView]);

  useEffect(() => {
    if (showBootLoader || !grouped.sections.length) return;
    const list = listRef.current;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = document.querySelectorAll<HTMLElement>(
      ".admin-menu-showcase .landing-reveal",
    );
    if (reduce) {
      nodes.forEach((el) => el.classList.add("is-in"));
      return;
    }
    nodes.forEach((el) => el.classList.remove("is-in"));
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          obs.unobserve(entry.target);
        }
      },
      {
        root: list,
        threshold: 0.04,
        rootMargin: "12% 0px -2% 0px",
      },
    );
    const id = requestAnimationFrame(() => {
      nodes.forEach((el) => obs.observe(el));
    });
    return () => {
      cancelAnimationFrame(id);
      obs.disconnect();
    };
  }, [showBootLoader, grouped.sections]);

  async function toggleProduct(p: Product) {
    const next = { ...p, isActive: !p.isActive };
    setManageProducts((list) => list.map((x) => (x.id === p.id ? next : x)));
    setBusyId(p.id);
    setPendingToggleProduct(null);
    setActionError(null);
    const result = await runAction(() => saveProduct(next), {
      label: t("pleaseWait"),
      silentFail: true,
    });
    if (!result.ok) {
      setManageProducts((list) => list.map((x) => (x.id === p.id ? p : x)));
      if (result.message !== t("errOffline")) showFail(result.message);
      else setActionError(result.message);
    } else {
      invalidatePublicMenuCache();
    }
    setBusyId(null);
  }

  async function removeProduct(p: Product) {
    const prev = manageProducts;
    setManageProducts((list) => list.filter((x) => x.id !== p.id));
    setBusyId(p.id);
    setPendingDeleteProduct(null);
    setActionError(null);
    const result = await runAction(() => deleteProduct(p.id), {
      label: t("pleaseWait"),
      silentFail: true,
    });
    if (!result.ok) {
      setManageProducts(prev);
      if (result.message !== t("errOffline")) showFail(result.message);
      else setActionError(result.message);
    } else {
      invalidatePublicMenuCache();
      if (p.imageUrl) void deleteUploadedImage(p.imageUrl);
    }
    setBusyId(null);
  }

  async function toggleCategory(c: Category) {
    const next = { ...c, isActive: !c.isActive };
    setManageCategories((list) => list.map((x) => (x.id === c.id ? next : x)));
    setBusyId(c.id);
    setPendingToggleCategory(null);
    setActionError(null);
    const result = await runAction(() => saveCategory(next), {
      label: t("pleaseWait"),
      silentFail: true,
    });
    if (!result.ok) {
      setManageCategories((list) => list.map((x) => (x.id === c.id ? c : x)));
      if (result.message !== t("errOffline")) showFail(result.message);
      else setActionError(result.message);
    } else {
      invalidatePublicMenuCache();
    }
    setBusyId(null);
  }

  function askRemoveCategory(c: Category, items: Product[]) {
    setActionError(null);
    setPendingDeleteCategory({ category: c, products: items });
  }

  async function confirmRemoveCategory() {
    if (!pendingDeleteCategory) return;
    const { category: c, products: items } = pendingDeleteCategory;
    const prevCategories = manageCategories;
    const prevProducts = manageProducts;
    const productIds = items.map((p) => p.id);

    setManageCategories((list) => list.filter((x) => x.id !== c.id));
    setManageProducts((list) => list.filter((x) => x.categoryId !== c.id));
    setBusyId(c.id);
    setDeletingCategory(true);
    setActionError(null);

    const result = await runAction(() => deleteCategory(c.id, productIds), {
      label: t("pleaseWait"),
      silentFail: true,
    });

    if (!result.ok) {
      setManageCategories(prevCategories);
      setManageProducts(prevProducts);
      if (result.message !== t("errOffline")) showFail(result.message);
      else setActionError(result.message);
    } else {
      invalidatePublicMenuCache();
      const imageUrls = [c.imageUrl, ...items.map((p) => p.imageUrl)].filter(
        Boolean,
      );
      for (const url of imageUrls) {
        void deleteUploadedImage(url);
      }
    }

    setBusyId(null);
    setDeletingCategory(false);
    setPendingDeleteCategory(null);
  }

  function retry() {
    if (manage) void loadManageMenu();
    else void refreshPublic(true);
  }

  if (showBootLoader) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <PageSpinner label={t("loading")} />
      </div>
    );
  }

  if (error && !hasData) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        {manage ? (
          <LoadError
            message={error}
            onRetry={retry}
            retryLabel={t("retry")}
          />
        ) : (
          <div className="card text-center">
            <p className="toast-error inline-block">{error}</p>
            <div className="mt-3">
              <button type="button" className="btn btn-sm" onClick={retry}>
                {t("retry")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="admin-menu-showcase flex h-full min-h-0 flex-col">
      <header className="admin-menu-head relative z-30 shrink-0 px-4 pb-3 pt-4 sm:px-6 sm:pt-5 md:px-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="admin-menu-eyebrow">{t("ourMenu")}</p>
            <h1 className="admin-menu-title">
              {t("menuPrices")}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status === "revalidating" ? (
              <span className="text-xs text-[var(--muted)]">{t("loading")}</span>
            ) : null}
            {manage ? (
              <>
                <Link
                  href="/admin/menu/category/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm min-h-11"
                >
                  {t("addCategory")}
                </Link>
                <Link
                  href="/admin/menu/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm min-h-11"
                >
                  {t("addMenuItem")}
                </Link>
              </>
            ) : null}
          </div>
        </div>

        {actionError ? (
          <div ref={errorRef} className="toast-error mb-3">
            {actionError}
          </div>
        ) : null}

        <label className="relative mb-3 block">
          <span className="sr-only">{t("searchMenu")}</span>
          <svg
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchMenu")}
            autoComplete="off"
            enterKeyHint="search"
            className="input pos-menu-search w-full text-base sm:text-sm"
          />
        </label>

        {grouped.sections.length > 0 ? (
          <nav
            ref={catsRef}
            className="admin-menu-cats flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label={t("category")}
          >
            {grouped.sections.map(({ category }) => (
              <button
                key={category.id}
                type="button"
                data-cat={category.id}
                aria-current={activeCat === category.id ? "true" : undefined}
                className={`admin-menu-cat shrink-0 capitalize whitespace-nowrap${
                  activeCat === category.id ? " is-active" : ""
                }${!category.isActive ? " is-hidden" : ""}`}
                onClick={() => scrollToCategory(category.id)}
              >
                {category.name}
                {manage && !category.isActive ? (
                  <span className="ms-1.5 text-[10px] font-bold uppercase opacity-70">
                    · {t("hiddenBadge")}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        ) : null}
      </header>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-4 sm:px-6 md:px-8"
      >
        {!grouped.sections.length && !grouped.orphans.length ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-white/70 px-4 py-8 text-center">
            <p className="text-sm text-[var(--muted)]">
              {q ? t("noSearchResults") : t("emptyMenu")}
            </p>
            {manage && !q ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link
                  href="/admin/menu/category/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  {t("addCategory")}
                </Link>
                <Link
                  href="/admin/menu/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                >
                  {t("addMenuItem")}
                </Link>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="landing-sections !gap-8 sm:!gap-10">
            {grouped.sections.map(({ category, items }) => {
              const catImg = resolveCategoryImage(
                category.imageUrl,
                category.name,
              );
              const allInCat = manage
                ? manageProducts.filter((p) => p.categoryId === category.id)
                : items;
              return (
                <section
                  key={category.id}
                  id={sectionId(category.id)}
                  className="landing-section"
                >
                  <div
                    className={`landing-cat-header landing-reveal !mb-3 sm:!mb-4 ${
                      manage ? "flex-wrap gap-y-2" : ""
                    }`}
                  >
                    <div className="landing-cat-header-thumb">
                      <MenuMediaImage
                        src={catImg}
                        alt={category.name}
                        sizes="72px"
                        ikWidth={160}
                        quality={84}
                        priority={false}
                      />
                    </div>
                    <div className="landing-cat-header-text min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="!text-lg sm:!text-xl">{category.name}</h3>
                        {manage && !category.isActive ? (
                          <span className="rounded-md bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                            {t("hiddenBadge")}
                          </span>
                        ) : null}
                      </div>
                      <span className="landing-cat-header-meta">
                        {items.length} {t("itemsCount")}
                      </span>
                    </div>
                    {manage ? null : (
                      <span className="landing-cat-header-line" aria-hidden />
                    )}
                    {manage ? (
                      <div className="flex w-full flex-wrap gap-1.5 ps-[calc(56px+0.75rem)] sm:w-auto sm:flex-1 sm:justify-end sm:ps-0">
                        <Link
                          href={`/admin/menu/new?category=${encodeURIComponent(category.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          {t("addItem")}
                        </Link>
                        <Link
                          href={`/admin/menu/category/${category.id}/edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          {t("edit")}
                        </Link>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busyId === category.id || actionBusy}
                          onClick={() => setPendingToggleCategory(category)}
                        >
                          {busyId === category.id ? <ButtonSpinner /> : null}
                          {category.isActive ? t("hide") : t("show")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-danger-ghost"
                          disabled={busyId === category.id || actionBusy}
                          onClick={() => askRemoveCategory(category, allInCat)}
                        >
                          {t("delete")}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {items.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--border)] bg-white/60 px-4 py-5">
                      <p className="text-sm text-[var(--muted)]">
                        {t("noProductsInCategory")}
                      </p>
                      {manage ? (
                        <Link
                          href={`/admin/menu/new?category=${encodeURIComponent(category.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm"
                        >
                          {t("addItem")}
                        </Link>
                      ) : null}
                    </div>
                  ) : (
                    <div className="landing-grid">
                      {items.map((product, idx) => {
                        const src = resolveProductImage(
                          product.imageUrl,
                          product.name,
                          category.name,
                        );
                        return (
                          <article
                            key={product.id}
                            className={`landing-item landing-reveal ${
                              manage && !product.isActive ? "opacity-70" : ""
                            }`}
                            style={
                              {
                                "--reveal-delay": `${Math.min(idx % 4, 3) * 90}ms`,
                                "--reveal-dir": idx % 2 === 0 ? "-1" : "1",
                              } as CSSProperties
                            }
                          >
                            <div className="landing-item-media relative">
                              <MenuMediaImage
                                src={src}
                                alt={product.name}
                                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
                                ikWidth={800}
                                quality={82}
                                priority={false}
                              />
                              {manage ? (
                                <div className="absolute inset-x-0 bottom-0 z-[2] flex justify-end gap-1.5 bg-gradient-to-t from-black/55 to-transparent p-2.5 pt-8">
                                  <Link
                                    href={`/admin/menu/${product.id}/edit`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="admin-menu-edit"
                                  >
                                    {t("edit")}
                                  </Link>
                                </div>
                              ) : null}
                            </div>
                            <div className="landing-item-body">
                              <div className="landing-item-top">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <h4>{product.name}</h4>
                                    {manage && !product.isActive ? (
                                      <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                                        {t("hiddenBadge")}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <PriceBlock
                                  product={product}
                                  fromLabel={t("from")}
                                />
                              </div>
                              {product.type === "sized" &&
                              product.variations.length ? (
                                <ul className="landing-size-row" dir="ltr">
                                  {product.variations.map((v) => (
                                    <li
                                      key={v.id}
                                      className="landing-size-chip"
                                    >
                                      <span className="landing-size-label">
                                        {v.label}
                                      </span>
                                      <span className="landing-size-price">
                                        {formatPkr(v.price)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              {product.type === "bundle" &&
                              product.dealItems.length ? (
                                <p className="landing-item-deal">
                                  {product.dealItems
                                    .map((d) =>
                                      d.qty > 1
                                        ? `${d.qty}× ${d.label}`
                                        : d.label,
                                    )
                                    .join(" · ")}
                                </p>
                              ) : null}
                              {manage ? (
                                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[var(--border)]/60 pt-2">
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={
                                      busyId === product.id || actionBusy
                                    }
                                    onClick={() =>
                                      setPendingToggleProduct(product)
                                    }
                                  >
                                    {busyId === product.id ? (
                                      <ButtonSpinner />
                                    ) : null}
                                    {product.isActive ? t("hide") : t("show")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm btn-danger-ghost"
                                    disabled={
                                      busyId === product.id || actionBusy
                                    }
                                    onClick={() =>
                                      setPendingDeleteProduct(product)
                                    }
                                  >
                                    {t("delete")}
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}

            {manage && grouped.orphans.length ? (
              <section className="landing-section">
                <div className="landing-cat-header !mb-3">
                  <div className="landing-cat-header-text">
                    <h3 className="!text-lg text-[var(--muted)] sm:!text-xl">
                      Other
                    </h3>
                  </div>
                </div>
                <div className="landing-grid">
                  {grouped.orphans.map((product, idx) => {
                    const src = resolveProductImage(
                      product.imageUrl,
                      product.name,
                    );
                    return (
                      <article
                        key={product.id}
                        className="landing-item landing-reveal"
                        style={
                          {
                            "--reveal-delay": `${Math.min(idx % 4, 3) * 90}ms`,
                          } as CSSProperties
                        }
                      >
                        <div className="landing-item-media relative">
                          <MenuMediaImage
                            src={src}
                            alt={product.name}
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
                            ikWidth={800}
                            quality={82}
                          />
                          <div className="absolute inset-x-0 bottom-0 z-[2] flex justify-end gap-1.5 bg-gradient-to-t from-black/55 to-transparent p-2.5 pt-8">
                            <Link
                              href={`/admin/menu/${product.id}/edit`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="admin-menu-edit"
                            >
                              {t("edit")}
                            </Link>
                          </div>
                        </div>
                        <div className="landing-item-body">
                          <div className="landing-item-top">
                            <h4>{product.name}</h4>
                            <PriceBlock
                              product={product}
                              fromLabel={t("from")}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[var(--border)]/60 pt-2">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-danger-ghost"
                              onClick={() => setPendingDeleteProduct(product)}
                            >
                              {t("delete")}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>

      {manage ? (
        <>
          <ConfirmDialog
            open={Boolean(pendingDeleteCategory)}
            title={t("confirmDeleteCategory")}
            message={
              pendingDeleteCategory
                ? pendingDeleteCategory.products.length > 0
                  ? t("confirmDeleteCategoryWithItems")
                      .replace("{name}", pendingDeleteCategory.category.name)
                      .replace(
                        "{count}",
                        String(pendingDeleteCategory.products.length),
                      )
                  : t("confirmDeleteCategoryBody")
                : ""
            }
            confirmLabel={t("yes")}
            cancelLabel={t("no")}
            busy={deletingCategory}
            danger
            onCancel={() => {
              if (!deletingCategory) setPendingDeleteCategory(null);
            }}
            onConfirm={() => void confirmRemoveCategory()}
          />

          <ConfirmDialog
            open={Boolean(pendingDeleteProduct)}
            title={t("confirmDeleteProductTitle")}
            message={t("confirmDeleteProduct")}
            confirmLabel={t("yes")}
            cancelLabel={t("no")}
            busy={Boolean(busyId)}
            danger
            onCancel={() => {
              if (!busyId) setPendingDeleteProduct(null);
            }}
            onConfirm={() => {
              if (pendingDeleteProduct) void removeProduct(pendingDeleteProduct);
            }}
          />

          <ConfirmDialog
            open={Boolean(pendingToggleProduct)}
            title={
              pendingToggleProduct?.isActive
                ? t("confirmHideProductTitle")
                : t("confirmShowProductTitle")
            }
            message={
              pendingToggleProduct?.isActive
                ? t("confirmHideProduct")
                : t("confirmShowProduct")
            }
            confirmLabel={t("yes")}
            cancelLabel={t("no")}
            busy={Boolean(busyId)}
            danger={Boolean(pendingToggleProduct?.isActive)}
            onCancel={() => {
              if (!busyId) setPendingToggleProduct(null);
            }}
            onConfirm={() => {
              if (pendingToggleProduct) void toggleProduct(pendingToggleProduct);
            }}
          />

          <ConfirmDialog
            open={Boolean(pendingToggleCategory)}
            title={
              pendingToggleCategory?.isActive
                ? t("confirmHideCategoryTitle")
                : t("confirmShowCategoryTitle")
            }
            message={
              pendingToggleCategory?.isActive
                ? t("confirmHideCategory")
                : t("confirmShowCategory")
            }
            confirmLabel={t("yes")}
            cancelLabel={t("no")}
            busy={Boolean(busyId)}
            danger={Boolean(pendingToggleCategory?.isActive)}
            onCancel={() => {
              if (!busyId) setPendingToggleCategory(null);
            }}
            onConfirm={() => {
              if (pendingToggleCategory)
                void toggleCategory(pendingToggleCategory);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
