import { useState, useEffect } from "react";

/**
 * High-performance UI hook to prevent excessive Python backend dispatching.
 * State updates immediately in local sliders, but network variables only emit 
 * upon a specified delay threshold (P1 Phase 4 Risk Matrix).
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Stage the network variable shift
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // If slider moves again within `delay`, cancel the prior staged update
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]); // Only re-evaluate if the user moves the slider continuously

  return debouncedValue;
}
