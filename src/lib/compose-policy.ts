export const COMPOSE_IDLE_DELAY = 700;

export function isComposeVisible(mobile: boolean, scrolling: boolean, open: boolean) {
  return !mobile || !scrolling || open;
}