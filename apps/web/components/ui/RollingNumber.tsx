"use client";

import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";
import { MISSING } from "@/lib/format";
import { odometerPlan, usePrefersReducedMotion, type OdometerCell } from "@/lib/motion";
import { tokens } from "@/lib/tokens.generated";

interface RollingNumberProps {
  value: number | null;
  format: (n: number) => string;
  /** auto: the sign of (value - previous value). */
  direction?: "auto" | "up" | "down";
  /** Roll in from zeros on the first client mount. */
  enter?: boolean;
  className?: string;
  testId?: string;
}

type Roll = { cells: OdometerCell[]; rising: boolean; tint: string; settle: boolean; id: number };

const ms = (token: string) => Number.parseFloat(token);
const ROLL = ms(tokens.duration.roll);
const ROLL_ENTER = ms(tokens["duration"]["roll-enter"]);
const FLASH = ms(tokens.duration.flash);
const STAGGER = ms(tokens.duration["digit-stagger"]);
const EASING = tokens.easing.emphasized;
const NBSP = " ";

// A number whose changed characters roll like an odometer. The server render is the final text
// (usePrefersReducedMotion's server snapshot is true), so hydration matches; a roll starts from a layout
// effect, when motion is allowed, so an `enter` figure never paints its final text before rolling from zeros.
// A changed value (not an enter) also washes the figure's background in up-soft or down-soft, fading over duration.flash. Mid-roll the cells are aria-hidden and the final text is exposed once in an
// sr-only span, so the intermediate digits are never announced. A roll ends as plain text, with the tint fading over duration.flash.
export function RollingNumber({ value, format, direction = "auto", enter = false, className, testId }: RollingNumberProps) {
  const reduced = usePrefersReducedMotion();
  const text = value === null ? MISSING : format(value);
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<{ text: string; value: number | null } | null>(null);
  const pendingEnter = useRef(enter);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = useRef<string | null>(null);
  const [roll, setRoll] = useState<Roll | null>(null);

  const cancel = () => {
    clearTimeout(timer.current);
    ref.current?.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  };

  useLayoutEffect(() => {
    const last = shown.current;
    shown.current = { text, value };
    if (reduced || value === null) {
      cancel();
      setRoll(null);
      return;
    }
    // Missing before, or an enter roll still owed: roll in from zeros.
    const fromZeros = pendingEnter.current || (last !== null && last.value === null);
    if (!fromZeros && (last === null || last.text === text)) return;
    pendingEnter.current = false;
    cancel();
    const rising = direction === "auto" ? fromZeros || value >= (last?.value ?? value) : direction === "up";
    setRoll({
      cells: odometerPlan(fromZeros ? null : (last?.text ?? null), text),
      rising,
      tint: fromZeros ? "var(--ink)" : rising ? "var(--up)" : "var(--down)",
      settle: !fromZeros,
      id: (roll?.id ?? 0) + 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new text or the motion preference starts a roll
  }, [text, reduced]);

  // The columns exist now: animate them, then settle back to plain text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!roll || !el) return;
    const duration = roll.settle ? ROLL : ROLL_ENTER;
    let last = 0;
    el.querySelectorAll<HTMLElement>("[data-col]").forEach((col) => {
      const delay = Number(col.dataset.delay) * STAGGER;
      last = Math.max(last, delay);
      const color = roll.tint;
      col.animate(
        roll.rising
          ? [{ transform: "translateY(0)", color }, { transform: "translateY(-50%)", color }]
          : [{ transform: "translateY(-50%)", color }, { transform: "translateY(0)", color }],
        { duration, delay, easing: EASING, fill: "both" },
      );
    });
    if (roll.settle) {
      const wash = roll.rising ? "var(--up-soft)" : "var(--down-soft)";
      el.animate([{ backgroundColor: wash }, { backgroundColor: "transparent" }], { duration: FLASH, easing: EASING });
    }
    timer.current = setTimeout(() => {
      flash.current = roll.settle ? roll.tint : null;
      setRoll(null);
    }, last + duration);
    return () => clearTimeout(timer.current);
  }, [roll]);

  // Back to plain text: fade the tint out.
  useLayoutEffect(() => {
    const el = ref.current;
    if (roll || !el || flash.current === null) return;
    const from = flash.current;
    flash.current = null;
    el.animate([{ color: from }, { color: getComputedStyle(el).color }], { duration: FLASH, easing: EASING });
  }, [roll]);

  return (
    <span ref={ref} data-testid={testId} aria-label={text} data-rolling={roll ? "true" : "false"} className={clsx(roll && "mv-odo", className)}>
      {roll ? (
        <>
          <span aria-hidden="true">
            {roll.cells.map((cell, i) => {
              if (cell.from === cell.to) return <span key={`${roll.id}-${i}`}>{cell.to}</span>;
              const [top, bottom] = roll.rising ? [cell.from, cell.to] : [cell.to, cell.from];
              return (
                <span key={`${roll.id}-${i}`} className="mv-dg">
                  <span data-col data-delay={cell.delayIndex}>
                    <span>{top || NBSP}</span>
                    <span>{bottom || NBSP}</span>
                  </span>
                </span>
              );
            })}
          </span>
          <span className="sr-only">{text}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}
