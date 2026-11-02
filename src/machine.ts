export const STATUSES = ['placed', 'paid', 'packed', 'shipped', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

/** Allowed moves. Shipped and cancelled orders are final. */
const NEXT: Record<Status, Status[]> = {
  placed: ['paid', 'cancelled'],
  paid: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
};

export const canTransition = (from: Status, to: Status): boolean => NEXT[from].includes(to);

/** Statuses an order may be in for it to move to `to`. Used for conditional updates so two writers cannot both win. */
export const sourcesFor = (to: Status): Status[] => STATUSES.filter((s) => canTransition(s, to));
