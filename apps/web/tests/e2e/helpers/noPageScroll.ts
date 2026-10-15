import { expect, type Page } from "@playwright/test";

export type PageSize = { scrollHeight: number; innerHeight: number; scrollWidth: number; clientWidth: number };

/** Why a page counts as scrolling, one string per axis; [] when it fits. Sideways gets 1 px of sub-pixel slack. */
export function pageScrollProblems(size: PageSize): string[] {
  const problems: string[] = [];
  if (size.scrollHeight > size.innerHeight) problems.push(`vertical: scrollHeight ${size.scrollHeight} > innerHeight ${size.innerHeight}`);
  if (size.scrollWidth > size.clientWidth + 1) problems.push(`horizontal: scrollWidth ${size.scrollWidth} > clientWidth ${size.clientWidth}`);
  return problems;
}

export function measurePage(page: Page): Promise<PageSize> {
  return page.evaluate(() => ({
    scrollHeight: document.scrollingElement!.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

export async function expectNoPageScroll(page: Page, where: string): Promise<void> {
  expect(await measurePage(page).then(pageScrollProblems), `${where}: the page must not scroll`).toEqual([]);
}
