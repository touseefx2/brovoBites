/** People still type "drink" when the category is called Beverages. */
const BEVERAGE_WORDS = "drink drinks cold drink ڈرنک مشروبات";

/** `q` is already lower case. Used by the customer menu and the admin menu search. */
export function categoryMatchesQuery(categoryName: string, q: string): boolean {
  const name = categoryName.toLowerCase();
  if (name.includes(q)) return true;
  return /beverage|مشروب/.test(name) && BEVERAGE_WORDS.includes(q);
}
