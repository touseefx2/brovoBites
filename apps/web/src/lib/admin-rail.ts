/**
 * Admin desktop rail: expanded (icons + labels) or collapsed (icons only), remembered per
 * browser. No React here, so the root (server) layout can inline the boot script.
 */
export const ADMIN_RAIL_STORAGE_KEY = "brovobites-admin-rail";

/** On <html> while the rail is collapsed; 09-admin.css keys every collapsed rule off it. */
export const ADMIN_RAIL_ATTR = "data-admin-rail";

/** Runs in <head> before first paint: a collapsed rail never flashes open on load. */
export const ADMIN_RAIL_BOOT_SCRIPT = `try{if(localStorage.getItem("${ADMIN_RAIL_STORAGE_KEY}")==="collapsed")document.documentElement.setAttribute("${ADMIN_RAIL_ATTR}","collapsed")}catch(e){}`;
