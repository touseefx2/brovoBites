/** Open the native date picker for the whole field (not only the tiny calendar icon). */
export function openDatePicker(el: HTMLInputElement | null) {
  if (!el || el.disabled || typeof el.showPicker !== "function") return;
  try {
    void el.showPicker();
  } catch {
    // NotAllowedError / unsupported — ignore; focus still works
  }
}
