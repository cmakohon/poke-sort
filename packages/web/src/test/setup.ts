/**
 * jsdom has no matchMedia, and next-themes calls it on mount to resolve
 * "system". Without this the provider throws and every test fails for a reason
 * that has nothing to do with what is being tested.
 *
 * Defaults to "not dark" so `system` resolves light unless a test says
 * otherwise, which keeps the light/dark assertions unambiguous.
 */
let prefersDark = false;

export function setPrefersDark(value: boolean): void {
  prefersDark = value;
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: query.includes("prefers-color-scheme: dark") ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
