/** Public customer menu deployments — no staff screens there. */
const CUSTOMER_HOSTS = [
  "brovobites-menu.vercel.app",
  "brovobites-menu-dev.vercel.app",
];

export function isCustomerMode(host: string): boolean {
  if (process.env.NEXT_PUBLIC_CUSTOMER_MODE === "true") return true;
  const bare = host.split(":")[0]!;
  return CUSTOMER_HOSTS.includes(bare);
}
