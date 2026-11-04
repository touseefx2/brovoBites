/**
 * The only Firebase projects this codebase may talk to.
 *
 * `scripts/set-firebase-ids.sh <dev-id> <live-id>` rewrites these two ids when
 * the real projects get other names. Local test runs use emulator-only
 * `demo-…` projects, which never reach the cloud.
 *
 * Every Firebase entry point (browser app, server admin, apps/web/scripts/*)
 * checks this list, so an env file copied from another shop can never read
 * or write that shop's data from here.
 */
export const SHOP_FIREBASE_PROJECTS: readonly string[] = ["bravobites-dev", "bravobites-live"];

export function isShopFirebaseProject(projectId: string | undefined | null): boolean {
  const id = (projectId ?? "").trim();
  return id.startsWith("demo-") || SHOP_FIREBASE_PROJECTS.includes(id);
}

export function assertShopFirebaseProject(projectId: string | undefined | null): void {
  if (isShopFirebaseProject(projectId)) return;
  throw new Error(
    `Firebase project "${(projectId ?? "").trim() || "(missing)"}" is not one of this shop's projects ` +
      `(${SHOP_FIREBASE_PROJECTS.join(", ")}). Check your .env files — if you created new Firebase ` +
      `projects, run: bash scripts/set-firebase-ids.sh <dev-id> <live-id>`,
  );
}
