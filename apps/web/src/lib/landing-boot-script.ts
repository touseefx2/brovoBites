/**
 * Landing boot loader: shown once per browser session (sessionStorage = this tab until
 * it is closed). No React here, so the root (server) layout can inline the script.
 */
export const LANDING_BOOT_SEEN_KEY = "brovobites-boot-seen";

/** On <html> when this session has already seen the boot loader (07-loader.css hides it). */
export const LANDING_BOOT_SEEN_ATTR = "data-boot-seen";

/**
 * Runs in <head> before first paint: a reload later in the session never flashes the
 * server-rendered loader before React takes it away.
 */
export const LANDING_BOOT_SCRIPT = `try{if(sessionStorage.getItem("${LANDING_BOOT_SEEN_KEY}"))document.documentElement.setAttribute("${LANDING_BOOT_SEEN_ATTR}","")}catch(e){}`;
