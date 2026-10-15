// Pages that must not scroll (spec §2A, D10). Each keeps a 24px bottom pad at lg and up, so the tab
// panel reaches the viewport edge. A later one-screen page joins by adding its route here.
export const ONE_SCREEN_ROUTES = ["/corporate"];

/** True for a listed route and the paths under it. "/corporate-x" is a different page, so it is false. */
export function isOneScreenRoute(pathname: string): boolean {
  return ONE_SCREEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
