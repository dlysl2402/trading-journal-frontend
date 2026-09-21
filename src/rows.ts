/**
 * The contract between this app and the record.
 *
 * The backend writes `deals.raw`, `orders.raw` and `accounts.raw` to Supabase
 * as jsonb, holding each row exactly as MetaApi sent it. These shapes name
 * only the fields the journal reads back out. They are declared here rather
 * than shared as a package because the two repositories deploy separately and
 * a type they both import is a coupling that a jsonb column does not actually
 * have: the column is the contract, and `supabase/schema.sql` in the backend
 * repository is where it is written down.
 *
 * Adding a field is safe from either side. Renaming or removing one is not,
 * and is the one change that needs both repositories in the same breath.
 */

/**
 * A deal as MetaApi sent it. Optional fields really are absent, not null:
 * a deposit carries no symbol, and a fill with no stop set carries no stop.
 */
export interface RawDeal {
  id: string
  /** DEAL_TYPE_BUY, DEAL_TYPE_SELL, DEAL_TYPE_BALANCE, or a kind the journal refuses. */
  type: string
  /** DEAL_ENTRY_IN or DEAL_ENTRY_OUT on a fill; absent on a deposit. */
  entryType?: string
  /** True UTC. */
  time: string
  /** The same instant on the broker's clock: "YYYY-MM-DD HH:mm:ss.SSS". */
  brokerTime: string
  symbol?: string
  volume?: number
  price?: number
  commission: number
  swap: number
  /** Gross, booked on the closing fill. A deposit puts its amount here too. */
  profit: number
  orderId?: string
  positionId?: string
  /** What fired the deal: DEAL_REASON_SL, _TP, _CLIENT, _MOBILE, _WEB, _EXPERT, _SO. */
  reason?: string
  /** The position's levels as they stood when this deal was booked. */
  stopLoss?: number
  takeProfit?: number
}

export interface RawOrder {
  id: string
  /**
   * The comment as MetaApi first saw it. MT5 overwrites a comment with the
   * bracket that fired, so this may read "[tp 4382.63]" rather than a tag.
   */
  comment?: string
  stopLoss?: number
  takeProfit?: number
}

export interface RawAccount {
  broker: string
  currency: string
  login: number
  balance: number
  /** True when MetaApi holds the investor password rather than the master one. */
  investorMode: boolean
}

/** One read of the record, assembled to the same shape one fetch of the feed had. */
export interface RawFeed {
  account: RawAccount
  deals: RawDeal[]
  orders: RawOrder[]
  /** When the import last wrote the account row — what a staleness check reads. */
  fetchedAt: Date
}

/**
 * Layer 4 — the margin: what you write next to a trade.
 *
 * The only table this app writes, and the only one with real columns rather
 * than a jsonb copy of somebody else's row, because nobody else sends these.
 * Keyed by the position the broker gave the trade, so a note stays attached to
 * its trade without the journal having to invent an id of its own.
 *
 * `note` is the plain text as typed — the formatting in `notes.ts` is a
 * reading of it, never stored.
 */
export interface RawAnnotation {
  position_id: string
  note: string | null
  tags: string[]
  updated_at: string
}
