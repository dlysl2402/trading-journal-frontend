/**
 * What one play's trades say about it: the figures on a setup's page.
 *
 * A play is the shape of trade you ran — one per trade, named from the
 * vocabulary — and so the unit a playbook is kept in. What's working answers
 * which plays pay; this answers the questions a single play raises once it
 * has some trades behind it. Does it have an edge, or is that a handful of
 * lucky ones? Is it still working? Which version of it is the good one — the A,
 * the trend day, the strong close — and is that the one you press? What does
 * running it badly cost? Which trades are the ones to watch again?
 *
 * R leads. A play is judged by what it made in units of what it risked,
 * before costs, because R is the same on a small position and a big one: it
 * measures the setup apart from how hard you pressed it. How hard you pressed
 * it is measured on its own, as the share of the account each trade stood to
 * lose, and what the two came to together is the return, net of costs, as it
 * is everywhere else on the page. A win is a trade that closed in profit
 * after costs, as it is everywhere else too. A loss is one that went against
 * you. One that closed where it opened, down only its costs, is a scratch:
 * not a win, and kept out of the losers' average, where it would pass for a
 * loser cut short and make every loss look smaller than the stop.
 *
 * Pure, like `breakdown.ts`: trades and what you wrote in, figures out.
 */

import type { Facet } from './breakdown.ts'
import { breakdown, keysOf } from './breakdown.ts'
import type { ExitReason, Trade } from './journal.ts'
import type { Note } from './margin.ts'
import type { Kind } from './tags.ts'
import { GRADES } from './tags.ts'
import { closedAt, costsOf, endedAs, multipleOf, plannedRatio, returnOf, riskShare } from './view.ts'

/** A trade, with what you wrote against it. */
export interface Sample {
  trade: Trade
  note: Note
}

/** What a set of trades came to. */
export interface Edge {
  count: number
  wins: number
  /** Trades that went against you: under water after costs, and not a scratch. */
  losses: number
  /** Trades that closed at or past their entry but no better than their costs: neither won nor lost. */
  scratches: number
  /** What they did to the account, net of costs, summed the way What's working sums a group. */
  total: number
  /** Each trade's R, in the order given. A trade opened without a stop has none, and is not here. */
  rs: number[]
  /** The R's added up. */
  totalR: number
  /** The average R: what one more trade of the kind is worth, in units of what it risks. */
  expectancy: number | null
  /** Where the true average most likely sits, 95 times in 100; null until there are two R's to spread. */
  range: { low: number; high: number } | null
  winRate: number | null
  /** The average R of the winners, and of the losers — below zero. Scratches are in neither. */
  avgWin: number | null
  avgLoss: number | null
  /** The average winner over the average loser. */
  payoff: number | null
  /** The average share of the account a trade stood to lose at its stop. */
  risk: number | null
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length

/**
 * Student's t for a two-sided 95% range, by degrees of freedom. The normal
 * curve's 1.96 undersells how little a few trades pin down, which is the case
 * a playbook spends its first months in; past thirty the difference fades.
 */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042]
const t95 = (df: number): number => T95[df - 1] ?? 1.96 + 2.4 / df

/**
 * How sure the average is: the average plus or minus t standard errors. A
 * spread of outcomes as wide as a trading setup's makes this wide for a long
 * while, and it is meant to — it says how much of the average is still luck.
 */
function rangeOf(rs: number[]): Edge['range'] {
  const n = rs.length
  if (n < 2) return null
  const average = mean(rs)!
  const variance = rs.reduce((total, r) => total + (r - average) ** 2, 0) / (n - 1)
  const margin = t95(n - 1) * Math.sqrt(variance / n)
  return { low: average - margin, high: average + margin }
}

/**
 * What a trade came to: a win after costs; a loss, under water and against
 * you; or a scratch between them, at or past its entry but no better than its
 * costs. A trade with no stop has no R to say it went its way, so under water
 * it is a loss.
 */
export function outcomeOf(trade: Trade): 'win' | 'loss' | 'scratch' {
  const result = returnOf(trade)
  if (result > 0) return 'win'
  const r = multipleOf(trade)
  return result < 0 && (r === null || r < 0) ? 'loss' : 'scratch'
}

export function edgeOf(samples: Sample[]): Edge {
  const results = samples.map((sample) => returnOf(sample.trade))
  const wins = samples.filter((sample) => outcomeOf(sample.trade) === 'win')
  const losses = samples.filter((sample) => outcomeOf(sample.trade) === 'loss')
  const measured = (list: Sample[]): number[] =>
    list.map((sample) => multipleOf(sample.trade)).filter((r): r is number => r !== null)

  const rs = measured(samples)
  const avgWin = mean(measured(wins)), avgLoss = mean(measured(losses))
  const risks = samples.map((sample) => riskShare(sample.trade)).filter((risk): risk is number => risk !== null)
  return {
    count: samples.length,
    wins: wins.length,
    losses: losses.length,
    scratches: samples.length - wins.length - losses.length,
    total: results.reduce((total, result) => total + result, 0),
    rs,
    totalR: rs.reduce((total, r) => total + r, 0),
    expectancy: mean(rs),
    range: rangeOf(rs),
    winRate: samples.length === 0 ? null : wins.length / samples.length,
    avgWin,
    avgLoss,
    payoff: avgWin !== null && avgLoss !== null && avgLoss < 0 ? avgWin / -avgLoss : null,
    risk: mean(risks),
  }
}

/** Whether a trade ran a play: carries its tag, and the tag is a play. */
export function runs(note: Note, slug: string, kindOf: (slug: string) => Kind | undefined): boolean {
  return kindOf(slug) === 'play' && note.tags.includes(slug)
}

/**
 * The plays with trades behind them, in the order What's working ranks them —
 * best total first — which is the order their pages step through.
 */
export function playsOf(samples: Sample[], kindOf: (slug: string) => Kind | undefined): string[] {
  return breakdown(samples.map((sample) => ({ result: returnOf(sample.trade), note: sample.note })), 'play', kindOf)
    .flatMap((group) => (group.key === null ? [] : [group.key]))
}

/** Oldest close first: the order a play's record was written in. */
export const byClose = (a: Sample, b: Sample): number =>
  closedAt(a.trade).getTime() - closedAt(b.trade).getTime()

/** One step of a play's curve: a trade, and the R the play had made once it closed. */
export interface Step {
  sample: Sample
  r: number
  /** Every R so far, this one included. */
  total: number
}

/** The play's R added up trade by trade, oldest first. Trades without an R are left off. */
export function curveOf(samples: Sample[]): Step[] {
  const steps: Step[] = []
  let total = 0
  for (const sample of samples.toSorted(byClose)) {
    const r = multipleOf(sample.trade)
    if (r === null) continue
    total += r
    steps.push({ sample, r, total })
  }
  return steps
}

/** One bar of the spread of outcomes: every trade whose R rounds to `at`. */
export interface Bin {
  /** The R the bar is centred on. */
  at: number
  /** The bar reaches half a width either side: from `at - width / 2`, up to but not including `at + width / 2`. */
  width: number
  count: number
}

/**
 * The trades' R's as a histogram, one bar per step of R, each centred on a
 * multiple of its width: a stop taken in full is the −1R bar, a scratch the 0R
 * bar and a target at two and a half times the stop the +2.5R bar. A loss well
 * beyond the stop stands apart, left of the −1R bar, which is the point.
 *
 * Half an R apart while that keeps the chart to a couple of dozen bars; a whole
 * R, then two, for a play whose outcomes spread wider. Empty bars inside the
 * range are kept, so the gaps show.
 */
export function binsOf(rs: number[]): Bin[] {
  if (rs.length === 0) return []
  const lo = Math.min(...rs), hi = Math.max(...rs)
  const width = [0.5, 1, 2, 5].find((w) => (hi - lo) / w <= 24) ?? 10
  const index = (r: number): number => Math.floor(r / width + 0.5)
  const first = index(lo), last = index(hi)
  const bins: Bin[] = []
  for (let i = first; i <= last; i++) bins.push({ at: i * width, width, count: 0 })
  for (const r of rs) bins[index(r) - first]!.count++
  return bins
}

/** Whether an R falls in a bar, by the same rounding that filled it. */
export function inBin(r: number, bin: Bin): boolean {
  return Math.floor(r / bin.width + 0.5) * bin.width === bin.at
}

/** A way to split a play's trades. The grade and the tag kinds, as What's working has them, and three the broker states. */
export type Split = Exclude<Facet, 'play'> | 'hour' | 'side' | 'symbol'

/** One group of a split, and what its trades came to. */
export interface Slice {
  /** The grade, a tag's slug, the hour as "09", the side or the symbol; null for the trades with none. */
  key: string | null
  edge: Edge
}

/** The keys a trade files under for a split. Empty for a trade with none of it: no grade, no mistake. */
export function keysFor(sample: Sample, split: Split, kindOf: (slug: string) => Kind | undefined): string[] {
  if (split === 'hour') return [String(sample.trade.entry.time.getUTCHours()).padStart(2, '0')]
  if (split === 'side') return [sample.trade.side]
  if (split === 'symbol') return [sample.trade.symbol]
  return keysOf(sample.note, split, kindOf)
}

/**
 * A play's trades split one way, each group summed.
 *
 * A trade with two tags of a kind counts in both, as in What's working.
 * Grades come out A, B, C and hours in the order of the day, because those
 * orders mean something; tags and symbols come out by the R they made, best
 * first. The
 * trades with none of the split come last, and for mistakes that group is the
 * one to read first: the play run clean.
 */
export function sliceBy(samples: Sample[], split: Split, kindOf: (slug: string) => Kind | undefined): Slice[] {
  const groups = new Map<string | null, Sample[]>()
  for (const sample of samples) {
    const keys = keysFor(sample, split, kindOf)
    for (const key of keys.length === 0 ? [null] : keys) {
      const members = groups.get(key) ?? []
      members.push(sample)
      groups.set(key, members)
    }
  }
  const slices = [...groups].map(([key, members]) => ({ key, edge: edgeOf(members) }))
  const rank = (key: string): number => (GRADES as readonly string[]).indexOf(key)
  return slices.sort((a, b) => {
    if (a.key === null || b.key === null) return (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0)
    if (split === 'grade') return rank(a.key) - rank(b.key)
    if (split === 'hour' || split === 'side') return a.key.localeCompare(b.key)
    return b.edge.totalR - a.edge.totalR
  })
}

/** How the trades left, by what closed the most of each. */
export function exitsOf(samples: Sample[]): Record<ExitReason['kind'], Edge> {
  const of = (kind: ExitReason['kind']): Edge => edgeOf(samples.filter((sample) => endedAs(sample.trade) === kind))
  return { stop: of('stop'), target: of('target'), manual: of('manual') }
}

/**
 * What the winners took of the reward they were opened for: the average
 * winner's R over the average reward its target stood at. Only winners that
 * went in with a target and a stop count, since the others planned nothing to
 * measure against. Below one is money left before the target; above it, a
 * winner held past it.
 */
export function capture(samples: Sample[]): { planned: number; taken: number; count: number } | null {
  const pairs = samples
    .filter((sample) => returnOf(sample.trade) > 0)
    .map((sample) => ({ planned: plannedRatio(sample.trade), taken: multipleOf(sample.trade) }))
    .filter((pair): pair is { planned: number; taken: number } => pair.planned !== null && pair.taken !== null)
  if (pairs.length === 0) return null
  return {
    planned: mean(pairs.map((pair) => pair.planned))!,
    taken: mean(pairs.map((pair) => pair.taken))!,
    count: pairs.length,
  }
}

/**
 * The deepest the play's running R fell below its best, in R: the slump it
 * has been through. Zero if it never gave any back.
 */
export function deepestDip(steps: Step[]): number {
  let peak = 0, dip = 0
  for (const step of steps) {
    peak = Math.max(peak, step.total)
    dip = Math.max(dip, peak - step.total)
  }
  return dip
}

/**
 * The best tenth of a play's trades, and the share of its total they made,
 * net of costs. Most of a trader's profit tends to come from a few trades;
 * this says how true that is of one play, and so how much hangs on never
 * missing — and pressing — the next one like them. A tenth is at least one
 * trade. Above one, the rest of the play gave back some of what they made.
 * Null for a play that has made nothing to take a share of.
 */
export function topTenth(samples: Sample[]): { count: number; share: number } | null {
  const results = samples.map((sample) => returnOf(sample.trade)).sort((a, b) => b - a)
  const total = results.reduce((sum, result) => sum + result, 0)
  if (results.length < 2 || total <= 0) return null
  const count = Math.ceil(results.length / 10)
  return { count, share: results.slice(0, count).reduce((sum, result) => sum + result, 0) / total }
}

/**
 * Commission and swap as a share of what the trades made before them, each
 * taken against its own balance first, as the overview counts them. A play
 * that takes small moves pays for them here. Null when they made nothing
 * either way.
 */
export function costShare(samples: Sample[]): number | null {
  const against = (money: number, sample: Sample): number => money / sample.trade.balanceAtEntry
  const gross = samples.reduce((total, sample) => total + against(sample.trade.grossProfit, sample), 0)
  const costs = samples.reduce((total, sample) => total + against(costsOf(sample.trade), sample), 0)
  return gross === 0 ? null : -costs / Math.abs(gross)
}

/**
 * The trades that lost more than their stop allowed for: a fill well past the
 * level, or a stop moved further away. A tenth of an R of slippage is the
 * market; past that, a −1R trade has become something else.
 */
export function pastTheStop(samples: Sample[]): Sample[] {
  return samples.filter((sample) => {
    const r = multipleOf(sample.trade)
    return r !== null && r < -1.1
  })
}
