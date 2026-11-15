export const COMPOSE_IDLE_DELAY = 700;

/** Compose floats at the bottom right on every screen size; it slides away while you scroll and returns when you stop. */
export function isComposeVisible(scrolling: boolean, open: boolean) {
  return !scrolling || open;
}
