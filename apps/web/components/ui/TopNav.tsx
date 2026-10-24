"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type FocusEvent, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import clsx from "clsx";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import { NAV_ITEMS, activeNavItem } from "@/components/ui/navItems";
import { useT } from "@/lib/i18n/locale";
import { tokens } from "@/lib/tokens.generated";

// font-bold: nav labels are bold ink in every state, so they clear 4.5:1 on paper (sidebar-contrast.spec.ts).

/** Spec §1/§9: the panel closes this long after the pointer leaves; it opens with no delay. */
const CLOSE_DELAY_MS = 150;
const WIDE_QUERY = `(min-width: ${tokens.bp.tablet})`;

/** `path` keys the open state to the page it was opened on, so navigating closes it without an
 *  effect. `pinned` = opened with ☰ (plan N6): pointer leave does not close it. */
type MenuState = { path: string; pinned: boolean } | null;

// M2: menu labels are bold ink in every state so they clear 4.5:1 on paper; sidebar-contrast.spec.ts pins weight 700.
const PANEL_LINK = "flex items-center gap-3 rounded-[var(--radius-1)] px-3 py-2 type-body font-bold text-[var(--ink)] hover:bg-[var(--surface-raised)]";

export function TopNav() {
  const pathname = usePathname();
  const t = useT();
  const [menu, setMenu] = useState<MenuState>(null);
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  // Browser back and forward move the page without a panel link's onClick, so a menu left open
  // on the old page would reopen when the user returns to it. Clear it during render.
  if (menu !== null && menu.path !== pathname) setMenu(null);
  const open = menu !== null && menu.path === pathname;
  const pinned = open && menu.pinned;
  const current = activeNavItem(pathname);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Hover and focus open it only on wide screens; below 768px only ☰ does (spec §1).
  const openTransient = () => {
    if (!window.matchMedia(WIDE_QUERY).matches) return;
    cancelClose();
    setMenu((m) => (m !== null && m.path === pathname ? m : { path: pathname, pinned: false }));
  };
  const closeSoon = () => {
    if (pinned) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setMenu((m) => (m?.pinned ? m : null));
    }, CLOSE_DELAY_MS);
  };
  const close = () => {
    cancelClose();
    setMenu(null);
  };
  const toggle = () => {
    cancelClose();
    setMenu(pinned ? null : { path: pathname, pinned: true });
  };

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

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  return (
    <header id="app-topnav" className="fixed inset-x-0 top-0 z-40 h-12 border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="flex h-full items-center gap-4 px-4 lg:px-8">
        <div className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 bg-[var(--brand)]" />
          <span className="type-panel-title text-[var(--ink)]">MoneyView</span>
        </div>

        {/* The hover/focus zone is the menu cluster only (plan N5): the logo and the language
            toggle stay outside it, so clicking the toggle never opens the panel. */}
        <div
          ref={zoneRef}
          data-testid="topnav-menu"
          className="relative flex h-full min-w-0 flex-1 items-center gap-2"
          onMouseEnter={openTransient}
          onMouseLeave={closeSoon}
          onFocus={openTransient}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeSoon();
          }}
        >
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
                    "flex h-8 items-center gap-2 rounded-[var(--radius-1)] px-2 text-[var(--ink)] hover:bg-[var(--surface-raised)]",
                    isActive && "bg-[var(--surface-raised)]",
                  )}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  {isActive && <span className="type-caption uppercase">{t(item.shortKey)}</span>}
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

          {/* Overlay, no scrim. `hidden` when closed keeps it out of the a11y tree and out of the
              pointer's way (spec §9). The links keep the old sidebar's look (DS Task 8). */}
          <div
            ref={panelRef}
            id="app-nav-panel"
            hidden={!open}
            className="absolute left-0 top-full z-40 w-64 border border-[var(--line)] bg-[var(--surface)] p-4"
          >
            <nav aria-label={t("topnav.full")} className="flex flex-col gap-2">
              {NAV_ITEMS.map((item) => {
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
