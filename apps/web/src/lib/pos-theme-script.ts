/**
 * POS colour theme constants — no React here, so the root (server) layout can
 * inline the boot script. The hooks live in lib/pos-theme.ts.
 */
export const POS_THEME_STORAGE_KEY = "bravobites-pos-theme";

/** On <html> only while the POS is open; every dark rule in globals.css keys off it. */
export const POS_THEME_ATTR = "data-pos-theme";

/**
 * Runs in <head> before first paint: a hard load of /pos comes up dark straight
 * away instead of flashing light until React mounts. Other routes stay light.
 */
export const POS_THEME_BOOT_SCRIPT = `try{if(/^\\/pos(\\/|$)/.test(location.pathname)&&localStorage.getItem("${POS_THEME_STORAGE_KEY}")==="dark")document.documentElement.setAttribute("${POS_THEME_ATTR}","dark")}catch(e){}`;
