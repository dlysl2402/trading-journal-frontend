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

/** How far a price sits from the entry in the direction the trade wanted to go: above zero is profit. */
export function inFavour(trade: Trade, price: number): number {
  return (price - trade.entry.price) * (trade.side === 'buy' ? 1 : -1)
}

/**
 * The distance to the stop the entry order carried: what the trade risked.
 *
 * Only the initial stop will do. A stop set after entry, or trailed, says
 * where the stop ended up, not what was put at risk — `journal.ts` keeps the
 * two apart for exactly this. Null without one, or with one that was never on
 * the losing side of the entry.
 */
function riskOf(trade: Trade): number | null {
  if (trade.stop.initial === null) return null
  const risk = -inFavour(trade, trade.stop.initial)
  return risk > 0 ? risk : null
}

/**
 * What the trade made in units of what it risked: +2 is twice the distance to
 * the stop it was opened with, −1 is the stop. From prices, so before costs.
 */
export function multipleOf(trade: Trade): number | null {
  const risk = riskOf(trade)
  return risk === null ? null : inFavour(trade, exitPrice(trade)) / risk
}

/** Reward over risk as the entry order planned it: the target's distance over the stop's. */
export function plannedRatio(trade: Trade): number | null {
  const risk = riskOf(trade)
  if (risk === null || trade.target.initial === null) return null
  const reward = inFavour(trade, trade.target.initial)
  return reward > 0 ? reward / risk : null
}

/** A trade that stood out from its week: the one that moved the account most, either way. */
export type Standing = 'best' | 'worst'

/** The Monday a moment's week began on, on the broker's clock, as YYYY-MM-DD. */
function weekOf(at: Date): string {
  const sinceMonday = (at.getUTCDay() + 6) % 7
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - sinceMonday))
    .toISOString().slice(0, 10)
}

/**
 * Each week's biggest win and biggest loss, by position id.
 *
 * Most trades need a grade and a tag and nothing more; the ones that moved
 * the account most are the ones worth taking apart moment by moment. A week
 * rather than a day, because at a handful of trades a day nearly every trade
 * would be the biggest something. A week of one trade has nothing to stand
 * out from, and a week with no loss has no biggest loss.
 */
export function standouts(trades: Trade[]): Map<string, Standing> {
  const standing = new Map<string, Standing>()
  for (const week of Map.groupBy(trades, (trade) => weekOf(closedAt(trade))).values()) {
    if (week.length < 2) continue
    const ranked = week.toSorted((a, b) => returnOf(b) - returnOf(a))
    const best = ranked[0]!, worst = ranked[ranked.length - 1]!
    if (returnOf(best) > 0) standing.set(best.positionId, 'best')
    if (returnOf(worst) < 0) standing.set(worst.positionId, 'worst')
  }
  return standing
}

/**
 * Growth over time, one point per closed trade, starting at one at midnight
 * of the day the first trade opened so the line begins on the baseline and
 * its climb to the first result is a stroke across the morning rather than
 * a hairline up the left edge — a trade held two minutes has no width.
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

  const opened = Math.min(...trades.map((trade) => trade.entry.time.getTime()))
  // The journal's times are the broker's clock read as UTC, so this is the broker's midnight.
  const dawn = new Date(new Date(opened).setUTCHours(0, 0, 0, 0))
  const points: EquityPoint[] = [{ time: dawn, growth: 1, trade: null }]

  let growth = 1
  for (const trade of byClose) {
    growth *= 1 + returnOf(trade)
    points.push({ time: closedAt(trade), growth, trade })
  }
  return points
}
