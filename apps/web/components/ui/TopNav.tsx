"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import clsx from "clsx";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { NAV_GROUPS, NAV_ITEMS, activeNavItem, navGroupOf } from "@/components/ui/navItems";
import { useT } from "@/lib/i18n/locale";

// font-bold: nav labels are bold ink in every state, so they clear 4.5:1 on paper (sidebar-contrast.spec.ts).

/** `path` keys the open state to the page it was opened on, so navigating closes it without an
 *  effect. `group` is the flyout group that hover, click or focus last chose; null = the page's own group. */
type MenuState = { path: string; group: string | null } | null;

// M2: menu labels are bold ink in every state so they clear 4.5:1 on paper; sidebar-contrast.spec.ts pins weight 700.
const PANEL_LINK = "flex items-center gap-3 rounded-[var(--radius-1)] px-3 py-2 type-body font-bold text-[var(--ink)] hover:bg-[var(--surface-raised)]";

// D1: a label slides out to the right of its icon on hover or keyboard focus. The current page's label is always open.
// Under reduced motion the width changes at once (motion-reduce:transition-none).
const LABEL = "type-caption overflow-hidden whitespace-nowrap uppercase transition-[max-width,margin-left,opacity] duration-[var(--duration-normal)] ease-[var(--easing-emphasized)] motion-reduce:transition-none";
const LABEL_OPEN = "ml-2 max-w-[12rem] opacity-100";
const LABEL_SHUT = "ml-0 max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-[12rem] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[12rem] group-focus-visible:opacity-100";

export function TopNav() {
  const pathname = usePathname();
  const t = useT();
  const [menu, setMenu] = useState<MenuState>(null);
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // Browser back and forward move the page without a panel link's onClick, so a menu left open
  // on the old page would reopen when the user returns to it. Clear it during render.
  if (menu !== null && menu.path !== pathname) setMenu(null);
  const open = menu !== null && menu.path === pathname;
  const chosenGroup = menu !== null && menu.path === pathname ? menu.group : null;
  const current = activeNavItem(pathname);
  // With the panel open, the flyout shows the group the user chose, else the current page's group.
  const shownGroup = NAV_GROUPS.find((group) => group.key === chosenGroup) ?? navGroupOf(current?.href) ?? NAV_GROUPS[0];
  const flyoutItems = shownGroup.hrefs.flatMap((href) => NAV_ITEMS.filter((item) => item.href === href));

  const chooseGroup = (key: string) => setMenu({ path: pathname, group: key });
  const close = () => setMenu(null);
  const toggle = () => setMenu(open ? null : { path: pathname, group: null });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Hiding the panel would drop a focused panel link to <body>; hand focus back to ☰ first.
      if (panelRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
      setMenu(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (zoneRef.current && !zoneRef.current.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <header id="app-topnav" className="fixed inset-x-0 top-0 z-40 h-12 border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="flex h-full items-center gap-4 px-4 lg:px-8">
        <div className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 bg-[var(--brand)]" />
          <span className="type-panel-title text-[var(--ink)]">MoneyView</span>
        </div>

        {/* The menu cluster holds the icon row, ☰ and the panel. The logo and the language toggle
            stay outside it, so clicking the toggle never opens the panel. */}
        <div ref={zoneRef} data-testid="topnav-menu" className="relative flex h-full min-w-0 flex-1 items-center gap-2">
          <nav aria-label={t("topnav.primary")} className="hidden h-full items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === current?.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={t(item.key)}
                  title={t(item.key)}
                  aria-current={isActive ? "page" : undefined}
                  onClick={close}
                  className={clsx(
                    "group flex h-8 items-center rounded-[var(--radius-1)] px-2 text-[var(--ink)] hover:bg-[var(--surface-raised)]",
                    isActive && "bg-[var(--surface-raised)] shadow-[inset_0_-2px_0_var(--brand)]",
                  )}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  <span aria-hidden="true" className={clsx(LABEL, isActive ? LABEL_OPEN : LABEL_SHUT)}>
                    {t(item.shortKey)}
                  </span>
                </Link>
              );
            })}
          </nav>
          <span data-testid="topnav-current" className="type-body whitespace-nowrap text-[var(--ink)] md:hidden">
            {current ? t(current.shortKey) : ""}
          </span>
          <button
            ref={buttonRef}
            type="button"
            aria-label={t("topnav.menu")}
            aria-expanded={open}
            aria-controls="app-nav-panel"
            onClick={toggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-1)] text-[var(--ink)] hover:bg-[var(--surface-raised)]"
          >
            <Menu aria-hidden="true" className="h-4 w-4" />
          </button>

          {/* Overlay, no scrim. `hidden` when closed keeps the panel and its flyout out of the
              a11y tree and out of the pointer's way. The flyout sits beside the panel on wide
              screens and under the group list on narrow ones. */}
          <div
            ref={panelRef}
            id="app-nav-panel"
            hidden={!open}
            className="absolute left-0 top-full z-40 w-64 border border-[var(--line)] bg-[var(--surface)] p-4"
          >
            <nav aria-label={t("topnav.full")} className="flex flex-col gap-1">
              {NAV_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                const expanded = group.key === shownGroup.key;
                return (
                  <button
                    key={group.key}
                    type="button"
                    aria-expanded={expanded}
                    onMouseEnter={() => chooseGroup(group.key)}
                    onFocus={() => chooseGroup(group.key)}
                    onClick={() => chooseGroup(group.key)}
                    className={clsx(PANEL_LINK, "w-full text-left", expanded && "bg-[var(--surface-raised)]")}
                  >
                    <GroupIcon aria-hidden="true" className="h-5 w-5" />
                    {t(group.label)}
                  </button>
                );
              })}
            </nav>
            <nav
              aria-label={t(shownGroup.label)}
              className="mt-3 flex flex-col gap-1 border border-[var(--line)] bg-[var(--surface)] p-2 md:absolute md:left-full md:top-0 md:ml-2 md:mt-0 md:w-64 md:p-4"
            >
              {flyoutItems.map((item) => {
                const isActive = item.href === current?.href;
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={close} className={clsx(PANEL_LINK, isActive && "bg-[var(--surface-raised)]")}>
                    {isActive && <span aria-hidden="true" className="h-4 w-0.5 bg-[var(--brand)]" />}
                    <Icon aria-hidden="true" className="h-5 w-5" />
                    {t(item.key)}
                  </Link>
                );
              })}
            </nav>
            <div className="type-caption mt-4 text-[var(--ink-muted)]">{t("topnav.poweredBy")}</div>
          </div>
        </div>

        <div className="shrink-0">
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}
