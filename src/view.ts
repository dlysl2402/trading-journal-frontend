/**
 * Layer 3 — the figures, derived from the trades.
 *
 * Every function here is a pure function of layer 2, and nothing is stored, so
 * a number on the screen can never disagree with the record beneath it. They
 * are the handful of facts about a trade that the broker does not state
 * outright: what it netted, what it cost, the price it actually left at, and
 * which of its exits the trade should be filed under.
 *
 * The sums the page leads with — win rate, profit factor, drawdown, the
 * calendar — are not here. `page.ts` works those out from the same trades the
 * table shows, so the two cannot disagree either.
 */

import type { ExitReason, Trade } from './journal.ts'

/** One step of the curve: where the account stood after a trade closed. */
export interface EquityPoint {
  time: Date
  /**
   * Growth of one unit put in before the first trade and left alone: every
   * return so far compounded, so 1.02 is up two percent. Deposits do not move
   * it; only trading does.
   */
  growth: number
  trade: Trade | null
}

/** Gross profit less what it cost to place and hold. */
export function netOf(trade: Trade): number {
  return trade.grossProfit + trade.commission + trade.swap
}

/** What the trade did to the account it was sized against, as a fraction: 0.01 is one percent. */
export function returnOf(trade: Trade): number {
  return netOf(trade) / trade.balanceAtEntry
}

/** Commission plus swap. Always negative or zero. */
export function costsOf(trade: Trade): number {
  return trade.commission + trade.swap
}

/** When the last piece of the position was closed. */
export function closedAt(trade: Trade): Date {
  return new Date(Math.max(...trade.exits.map((exit) => exit.time.getTime())))
}

/** How many decimals a price was quoted to, so an average is not printed to nine. */
function decimals(price: number): number {
  return String(price).split('.')[1]?.length ?? 0
}

/** The exits averaged by volume, to the decimals the broker quotes. */
export function exitPrice(trade: Trade): number {
  const volume = trade.exits.reduce((total, exit) => total + exit.volume, 0)
  const digits = Math.max(decimals(trade.entry.price), ...trade.exits.map((exit) => decimals(exit.price)))
  const weighted = trade.exits.reduce((total, exit) => total + exit.price * exit.volume, 0) / volume
  return Number(weighted.toFixed(digits))
}

/**
 * Which exit the trade is filed under. A position closed in pieces has one
 * reason per piece; the one that closed the most of it is the honest answer.
 */
export function endedAs(trade: Trade): ExitReason['kind'] {
  return trade.exits.reduce((best, exit) => exit.volume > best.volume ? exit : best).reason.kind
}

/** The stop in force at the close, else the one placed at entry; null if there was never one. */
export function stopAt(trade: Trade): number | null {
  return trade.stop.final ?? trade.stop.initial
}

/**
 * Growth over time, one point per closed trade, starting at one when the
 * first trade was opened so the line begins on the baseline.
 *
 * Returns rather than money, on purpose: the sample account took four
 * deposits totalling 32,000 against a few hundred of P&L, so a balance curve
 * is four steps with the trading invisible on top of them — and a win on the
 * first 10,000 should stand as tall as the same-sized win on 32,000. Each
 * trade's return is compounded in the order the trades closed, which is what
 * lets the page draw the curve on a log axis, where equal heights are equal
 * percentages.
 */
export function equityCurve(trades: Trade[]): EquityPoint[] {
  if (trades.length === 0) return []
  const byClose = [...trades].sort((a, b) => closedAt(a).getTime() - closedAt(b).getTime())

  const opened = new Date(Math.min(...trades.map((trade) => trade.entry.time.getTime())))
  const points: EquityPoint[] = [{ time: opened, growth: 1, trade: null }]

  let growth = 1
  for (const trade of byClose) {
    growth *= 1 + returnOf(trade)
    points.push({ time: closedAt(trade), growth, trade })
  }
  return points
}
