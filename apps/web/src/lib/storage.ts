/**
 * Menu image upload via ImageKit (free tier — CDN + image URLs for Firestore).
 *
 * Setup:
 *   1. https://imagekit.io → Developer options
 *   2. Copy into .env.development.local / .env.production.local:
 *        NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY=
 *        NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your_id
 *        IMAGEKIT_PRIVATE_KEY=          (server-only — never NEXT_PUBLIC_)
 *   3. Restart `pnpm --filter web dev`
 *
 * Later (optional): NEXT_PUBLIC_IMAGE_UPLOAD_PROVIDER=firebase
 */

import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { getClientAuth, getClientStorage } from "@/lib/firebase/client";

async function ownerAuthHeaders(): Promise<HeadersInit> {
  const token = await getClientAuth().currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in as owner to upload images");
  return { Authorization: `Bearer ${token}` };
}

export type ImageUploadProvider = "imagekit" | "firebase" | "none";

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

function validateImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image must be under 5 MB");
  }
}

/** Client-safe check (public env only). Private key is validated on the API route. */
export function getImageUploadProvider(): ImageUploadProvider {
  const forced = (process.env.NEXT_PUBLIC_IMAGE_UPLOAD_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (forced === "firebase" || forced === "imagekit") {
    return forced;
  }
  if (
    process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY &&
    process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT
  ) {
    return "imagekit";
  }
  return "none";
}

async function uploadViaFirebase(file: File, pathPrefix: string): Promise<string> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `menu/${pathPrefix}/${id}.${safeExt(file)}`;
  const storageRef = ref(getClientStorage(), path);
  await uploadBytes(storageRef, file, {
    contentType: file.type || "image/jpeg",
    cacheControl: "public,max-age=31536000",
  });
  return getDownloadURL(storageRef);
}

/** Upload via Next.js API (ImageKit private key stays on server). */
async function uploadViaImageKit(file: File, pathPrefix: string): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  body.append("pathPrefix", pathPrefix);

  const res = await fetch("/api/upload-menu-image", {
    method: "POST",
    headers: await ownerAuthHeaders(),
    body,
  });
  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !data.url) {
    throw new Error(data.error || `ImageKit upload failed (${res.status})`);
  }
  return data.url;
}


/**
 * Load image dimensions without rendering it on screen.
 */
function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

/**
 * Resize an image to exact target dimensions, then compress.
 * - cover: zoom + center-crop (hero / food photos)
 * - contain: fit inside without cropping (logos — keeps full circular badge)
 */
function resizeAndCompress(
  file: File,
  opts: {
    width: number;
    height: number;
    quality: number;
    name: string;
    fit?: "cover" | "contain";
    mime?: "image/jpeg" | "image/png";
    /** Canvas fill behind contain when using JPEG (no alpha) */
    fill?: string;
  },
): Promise<File> {
  const {
    width: tw,
    height: th,
    quality,
    name,
    fit = "cover",
    mime = "image/jpeg",
    fill = "#0a1628",
  } = opts;

  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sw = img.naturalWidth;
      const sh = img.naturalHeight;

      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }

      if (fit === "contain") {
        if (mime === "image/jpeg") {
          ctx.fillStyle = fill;
          ctx.fillRect(0, 0, tw, th);
        } else {
          ctx.clearRect(0, 0, tw, th);
        }
        const scale = Math.min(tw / sw, th / sh);
        const scaledW = Math.round(sw * scale);
        const scaledH = Math.round(sh * scale);
        const dx = Math.round((tw - scaledW) / 2);
        const dy = Math.round((th - scaledH) / 2);
        ctx.drawImage(img, dx, dy, scaledW, scaledH);
      } else {
        const scale = Math.max(tw / sw, th / sh);
        const scaledW = Math.round(sw * scale);
        const scaledH = Math.round(sh * scale);
        const ox = Math.round((scaledW - tw) / 2);
        const oy = Math.round((scaledH - th) / 2);
        ctx.drawImage(img, -ox, -oy, scaledW, scaledH);
      }

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(new File([blob], name, { type: blob.type, lastModified: Date.now() }));
        },
        mime,
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };
    img.src = url;
  });
}

/** Square logo — crisp on retina; contain-fit so the full badge isn’t cropped. */
export const LOGO_SIZE = 512;
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
export const CATEGORY_IMG_SIZE = 400;
export const PRODUCT_IMG_WIDTH = 800;
export const PRODUCT_IMG_HEIGHT = 640;

/** Upload a logo (min 512×512, contain-fit PNG so the circular badge isn’t cropped). */
export async function uploadLogoImage(file: File): Promise<string> {
  validateImage(file);
  const dims = await loadImageDimensions(file);
  if (dims.width < LOGO_SIZE || dims.height < LOGO_SIZE) {
    throw new Error(`Logo must be at least ${LOGO_SIZE}x${LOGO_SIZE}px. Your image is ${dims.width}x${dims.height}px.`);
  }

  const compressed = await resizeAndCompress(file, {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    quality: 1,
    name: "logo.png",
    fit: "contain",
    mime: "image/png",
  });

  const provider = getImageUploadProvider();
  if (provider === "none") {
    throw new Error("Image upload is not configured.");
  }
  if (provider === "imagekit") {
    return uploadViaImageKit(compressed, "branding");
  }
  return uploadViaFirebase(compressed, "branding");
}

/** Upload a hero slide (min 1920×1080, resized to 1920×1080); returns a public HTTPS URL. */
export async function uploadHeroSlide(file: File): Promise<string> {
  validateImage(file);
  const dims = await loadImageDimensions(file);
  if (dims.width < SLIDE_WIDTH || dims.height < SLIDE_HEIGHT) {
    throw new Error(`Slide must be at least ${SLIDE_WIDTH}x${SLIDE_HEIGHT}px. Your image is ${dims.width}x${dims.height}px.`);
  }

  const compressed = await resizeAndCompress(file, {
    width: SLIDE_WIDTH,
    height: SLIDE_HEIGHT,
    quality: 0.80,
    name: `slide-${Date.now()}.jpg`,
  });

  const provider = getImageUploadProvider();
  if (provider === "none") {
    throw new Error("Image upload is not configured.");
  }
  if (provider === "imagekit") {
    return uploadViaImageKit(compressed, "hero-slides");
  }
  return uploadViaFirebase(compressed, "hero-slides");
}

/** Upload a category image (min 400×400, resized to 400×400); returns a public HTTPS URL. */
export async function uploadCategoryImage(file: File, branchId: string): Promise<string> {
  validateImage(file);
  const dims = await loadImageDimensions(file);
  if (dims.width < CATEGORY_IMG_SIZE || dims.height < CATEGORY_IMG_SIZE) {
    throw new Error(`Category image must be at least ${CATEGORY_IMG_SIZE}x${CATEGORY_IMG_SIZE}px. Your image is ${dims.width}x${dims.height}px.`);
  }

  const compressed = await resizeAndCompress(file, {
    width: CATEGORY_IMG_SIZE,
    height: CATEGORY_IMG_SIZE,
    quality: 0.82,
    name: `cat-${Date.now()}.jpg`,
  });

  const provider = getImageUploadProvider();
  if (provider === "none") throw new Error("Image upload is not configured.");
  if (provider === "imagekit") return uploadViaImageKit(compressed, `categories/${branchId}`);
  return uploadViaFirebase(compressed, `categories/${branchId}`);
}

/** Upload a product image (min 800×640, resized to 800×640); returns a public HTTPS URL. */
export async function uploadProductImage(file: File, branchId: string): Promise<string> {
  validateImage(file);
  const dims = await loadImageDimensions(file);
  if (dims.width < PRODUCT_IMG_WIDTH || dims.height < PRODUCT_IMG_HEIGHT) {
    throw new Error(`Product image must be at least ${PRODUCT_IMG_WIDTH}x${PRODUCT_IMG_HEIGHT}px. Your image is ${dims.width}x${dims.height}px.`);
  }

  const compressed = await resizeAndCompress(file, {
    width: PRODUCT_IMG_WIDTH,
    height: PRODUCT_IMG_HEIGHT,
    quality: 0.82,
    name: `prod-${Date.now()}.jpg`,
  });

  const provider = getImageUploadProvider();
  if (provider === "none") throw new Error("Image upload is not configured.");
  if (provider === "imagekit") return uploadViaImageKit(compressed, `products/${branchId}`);
  return uploadViaFirebase(compressed, `products/${branchId}`);
}

export const MAX_HERO_SLIDES = 8;

/**
 * Delete an uploaded image from storage (Firebase Storage or ImageKit).
 * Best-effort — does not throw on failure.
 */
export async function deleteUploadedImage(url: string): Promise<void> {
  if (!url) return;
  const provider = getImageUploadProvider();

  try {
    if (provider === "firebase" && url.includes("firebasestorage.googleapis.com")) {
      const storageRef = ref(getClientStorage(), url);
      await deleteObject(storageRef);
    } else if (provider === "imagekit") {
      await fetch("/api/delete-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await ownerAuthHeaders()),
        },
        body: JSON.stringify({ url }),
      });
    }
  } catch {
    // Best-effort — storage cleanup is not critical
  }
}

