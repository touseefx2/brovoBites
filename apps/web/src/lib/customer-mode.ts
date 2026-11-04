/** Public customer menu deployments — no staff screens there. */
const CUSTOMER_HOSTS = [
  "bravobites-customer.vercel.app",
  "menu.your-domain.com",
  "menu.dev.your-domain.com",
];

export function isCustomerMode(host: string): boolean {
  if (process.env.NEXT_PUBLIC_CUSTOMER_MODE === "true") return true;
  const bare = host.split(":")[0]!;
  return CUSTOMER_HOSTS.includes(bare);
}
