/**
 * The /alerts filters live in the address and in state (plan Task 5). `pending` holds the queries this page
 * wrote that the address has not reached yet; `seen` is the address query last handled.
 */
export interface AddressSync { pending: string[]; seen: string }

/**
 * One render's step. `address` is the address query, `current` the filters' query. An address that is none
 * of the pending writes came from outside (back/forward, a nav link): `follow` is then true when the filters
 * must be read from it. Arrays come back unchanged (same identity) when nothing changed.
 */
export function syncAddress(state: AddressSync, address: string, current: string): AddressSync & { follow: boolean } {
  let { pending, seen } = state;
  let follow = false;
  if (seen !== address) {
    seen = address;
    const at = pending.indexOf(address);
    if (at >= 0) {
      pending = pending.slice(at + 1);
    } else {
      pending = [];
      follow = address !== current;
    }
  }
  // Caught up: the address shows the latest write, so no earlier write is still owed. Without this, A→B→A with B
  // never landing leaves B pending, and a later outside move to B would be taken for this page's own write.
  if (pending.length > 0 && pending[pending.length - 1] === address && address === current) pending = [];
  return { pending, seen, follow };
}
