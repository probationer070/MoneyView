"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { useT } from "@/lib/i18n/locale";

/** A pointer drag this far (px) sideways moves one card; a shorter one is a click on the card. */
const DRAG_THRESHOLD = 48;

const CARD_CLASS = "block h-full w-full overflow-hidden border border-[var(--line)] bg-[var(--bg)] p-3 text-left";

interface CardDeckProps<T> {
  items: T[];
  /** How many exist; above items.length a last "View all N" card links to moreHref (spec §3.2, R-D6). */
  total: number;
  render: (item: T) => ReactNode;
  onActivate: (item: T) => void;
  moreHref: string;
  /** The carousel's accessible name. */
  label: string;
}

/**
 * The stacked card deck of risk UI spec §3.2. The front card shows with the next one peeking behind it.
 * ←/→ on the focused deck, the prev/next buttons, or a pointer drag move it; Enter on the deck or a click
 * on the front card calls onActivate (Enter on the "View all" card follows moreHref). A new front card enters with `mv-enter` (instant under reduced motion).
 * Renders nothing for an empty deck: the caller shows its own empty state.
 */
export function CardDeck<T>({ items, total, render, onActivate, moreHref, label }: CardDeckProps<T>) {
  const t = useT();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const hasMore = total > items.length;
  const slots = items.length + (hasMore ? 1 : 0);
  if (slots === 0) return null;
  const current = Math.min(index, slots - 1);
  const move = (step: number) => setIndex(Math.max(0, Math.min(slots - 1, current + step)));
  const itemAt = (slot: number) => (slot < items.length ? items[slot] : null);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      move(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      const item = itemAt(current);
      if (item === null) router.push(moreHref);
      else onActivate(item);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragStart.current = event.clientX;
    dragged.current = false;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStart.current === null) return;
    const dx = event.clientX - dragStart.current;
    dragStart.current = null;
    if (Math.abs(dx) < DRAG_THRESHOLD) return;
    dragged.current = true;
    move(dx < 0 ? 1 : -1);
  }

  function slotView(slot: number): ReactNode {
    const item = itemAt(slot);
    return item === null ? (
      <span className="type-label flex h-full items-center justify-center text-[var(--brand-text)]">{t("risk.deck.more", { count: total })}</span>
    ) : render(item);
  }

  const frontItem = itemAt(current);
  const peekSlot = current + 1 < slots ? current + 1 : null;

  return (
    <section
      data-testid="card-deck"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-col gap-2"
    >
      <div
        className="relative h-64 pr-2 pt-2"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragStart.current = null; }}
      >
        {peekSlot !== null && (
          <div
            data-testid="deck-peek"
            aria-hidden="true"
            inert
            className="absolute bottom-2 left-2 right-0 top-0 overflow-hidden border border-[var(--line)] bg-[var(--surface)] p-3 opacity-60"
          >
            {slotView(peekSlot)}
          </div>
        )}
        <div key={current} className="mv-enter relative h-full select-none">
          {frontItem === null ? (
            <Link data-testid="deck-more" href={moreHref} className={CARD_CLASS}
              draggable={false}
              onClick={(event) => {
                if (dragged.current) event.preventDefault();
                dragged.current = false;
              }}
            >
              {slotView(current)}
            </Link>
          ) : (
            <button
              type="button"
              data-testid="deck-card"
              tabIndex={-1}
              className={clsx(CARD_CLASS, "cursor-pointer")}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                onActivate(frontItem);
              }}
            >
              {render(frontItem)}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <IconButton icon={<ChevronLeft className="h-4 w-4" />} label={t("risk.deck.prev")} size="sm" disabled={current === 0} onClick={() => move(-1)} />
        <p data-testid="deck-position" aria-live="polite" className="type-mono text-[var(--ink-muted)]">
          {t("risk.deck.position", { index: current + 1, total: slots })}
        </p>
        <IconButton icon={<ChevronRight className="h-4 w-4" />} label={t("risk.deck.next")} size="sm" disabled={current === slots - 1} onClick={() => move(1)} />
      </div>
    </section>
  );
}
