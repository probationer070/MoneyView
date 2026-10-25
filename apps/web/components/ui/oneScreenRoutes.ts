// Pages that must not scroll (spec §2A, D10; market one-screen spec §2.1). Each keeps a 24px bottom pad
// at lg and up, so the tab panel reaches the viewport edge. A later one-screen page joins by adding its route here.
export const ONE_SCREEN_ROUTES = ["/corporate", "/", "/monte-carlo", "/alerts", "/detail"];

/**
 * True for a listed route and the paths under it. "/corporate-x" is a different page, so it is false.
 * "/" lists only the overview: the prefix it would match is "//", which no app path starts with.
 */
export function isOneScreenRoute(pathname: string): boolean {
  return ONE_SCREEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
