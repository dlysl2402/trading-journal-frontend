import assert from 'node:assert/strict'
import test from 'node:test'
import type { Sample } from './edge.ts'
import { binsOf, capture, costShare, curveOf, deepestDip, edgeOf, exitsOf, inBin, keysFor, pastTheStop, runs, sliceBy, topTenth } from './edge.ts'
import type { ExitReason, Trade } from './journal.ts'
import type { Note } from './margin.ts'
import type { Kind } from './tags.ts'
import { multipleOf } from './view.ts'

const kinds: Record<string, Kind> = {
  'failed-breakout': 'play', 'trend-pullback': 'play',
  'trend-day': 'context', chop: 'context', chased: 'mistake', 'cut-early': 'mistake',
}
const kindOf = (slug: string): Kind | undefined => kinds[slug]

/**
 * A long from 100 with its stop at 98, so 1R is two points and 1R of the
 * account is 1% on a balance of 1000 — gross 10 per R — closed at `r` times
 * the stop, less a commission of 0.2. `hour` is when it opened, on the
 * broker's clock, and it closes on the day given, twenty minutes later.
 */
let made = 0

function sample(r: number, note: Partial<Note> = {}, over: { day?: string; hour?: number; exit?: ExitReason['kind']; target?: number | null; side?: Trade['side'] } = {}): Sample {
  const { day = '2026-09-21', hour = 10, exit = 'manual', target = 106, side = 'buy' } = over
  const direction = side === 'buy' ? 1 : -1
  const opened = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`)
  const exitPrice = 100 + direction * 2 * r
  const reason: ExitReason = exit === 'manual' ? { kind: 'manual' }
    : { kind: exit, price: exit === 'stop' ? 100 - direction * 2 : target ?? exitPrice }
  const trade: Trade = {
    positionId: String(++made), symbol: 'XAUUSD', side, tag: null,
    entry: { dealId: 'in', time: opened, price: 100, volume: 1 },
    exits: [{ dealId: 'out', time: new Date(opened.getTime() + 20 * 60_000), price: exitPrice, volume: 1, reason }],
    stop: { initial: 100 - direction * 2, final: 100 - direction * 2 },
    target: { initial: target === null ? null : 100 + direction * (target - 100), final: null },
    grossProfit: 10 * r, commission: -0.2, swap: 0, balanceAtEntry: 1000,
  }
  return {
    trade,
    note: { preTrade: '', inTrade: '', postTrade: '', tags: ['failed-breakout'], grade: null, updatedAt: new Date(), ...note },
  }
}

test('a play is a tag of the play kind, carried by the trade', () => {
  const ran = sample(1).note
  assert.equal(runs(ran, 'failed-breakout', kindOf), true)
  assert.equal(runs(ran, 'trend-pullback', kindOf), false)
  // A context tag is never a play, whatever it is called.
  assert.equal(runs({ ...ran, tags: ['trend-day'] }, 'trend-day', kindOf), false)
})

test('the edge is the average R, with wins counted after costs', () => {
  const edge = edgeOf([sample(2), sample(-1), sample(3), sample(-1), sample(0)])
  assert.equal(edge.count, 5)
  assert.equal(edge.wins, 2)
  assert.equal(edge.winRate, 0.4)
  // The scratch cost its commission, so it is no win; but it never went
  // against the trade, so it is no loser either, and the losers' average is
  // the stop rather than two thirds of it.
  assert.equal(edge.losses, 2)
  assert.equal(edge.scratches, 1)
  assert.equal(edge.expectancy, 0.6)
  assert.equal(edge.totalR, 3)
  assert.equal(edge.avgWin, 2.5)
  assert.equal(edge.avgLoss, -1)
  assert.equal(edge.payoff, 2.5)
  // Net of costs, as a share of the account: 3R of 1% each, less five commissions.
  assert.equal(Number(edge.total.toFixed(6)), 0.029)
  assert.equal(Number(edge.risk!.toFixed(6)), 0.01)
})

test('the range around the average is wide on a few trades and narrows as they add up', () => {
  const few = edgeOf([sample(2), sample(-1), sample(3)])
  const many = edgeOf(Array.from({ length: 10 }, () => [sample(2), sample(-1), sample(3)]).flat())
  assert.equal(few.expectancy?.toFixed(6), many.expectancy?.toFixed(6))
  const width = (edge: typeof few) => edge.range!.high - edge.range!.low
  assert.ok(few.range!.low < 0 && few.range!.high > 2, 'three trades cannot tell this edge from nothing')
  assert.ok(many.range!.low > 0, 'thirty of the same can')
  assert.ok(width(many) < width(few) / 4)
  // One trade has no spread to measure.
  assert.equal(edgeOf([sample(2)]).range, null)
  assert.equal(edgeOf([]).expectancy, null)
})

test('a trade opened without a stop counts as a trade but has no R', () => {
  const bare = sample(1)
  bare.trade.stop = { initial: null, final: 99 }
  const edge = edgeOf([bare, sample(-1)])
  assert.equal(edge.count, 2)
  assert.deepEqual(edge.rs, [-1])
  assert.equal(edge.expectancy, -1)
  assert.equal(multipleOf(bare.trade), null)
})

test('the curve adds the R up in the order the trades closed', () => {
  const steps = curveOf([
    sample(2, {}, { day: '2026-09-23' }),
    sample(-1, {}, { day: '2026-09-21' }),
    sample(1.5, {}, { day: '2026-09-22' }),
  ])
  assert.deepEqual(steps.map((step) => [step.r, step.total]), [[-1, -1], [1.5, 0.5], [2, 2.5]])
})

test('outcomes are binned around whole and half R, so a full stop and a scratch each have a bar', () => {
  const bins = binsOf([-1, -1, -1.3, 0, 0.1, 2.5, 2.4])
  assert.deepEqual(bins.map((bin) => [bin.at, bin.count]),
    [[-1.5, 1], [-1, 2], [-0.5, 0], [0, 2], [0.5, 0], [1, 0], [1.5, 0], [2, 0], [2.5, 2]])
  assert.equal(inBin(-1.3, bins[0]!), true)
  assert.equal(inBin(-1, bins[0]!), false)
  assert.deepEqual(binsOf([]), [])
  // A play with a long right tail gets wider bars rather than a hundred thin ones.
  assert.equal(binsOf([-1, 30])[0]!.width, 2)
})

test('a split sums each group, grades in order and the trades with none last', () => {
  const samples = [
    sample(2, { grade: 'A', tags: ['failed-breakout', 'trend-day'] }),
    sample(-1, { grade: 'C', tags: ['failed-breakout', 'chop', 'chased'] }),
    sample(3, { grade: 'A', tags: ['failed-breakout', 'trend-day'] }),
    sample(-1, { tags: ['failed-breakout', 'chop', 'trend-day'] }),
  ]
  const grades = sliceBy(samples, 'grade', kindOf)
  assert.deepEqual(grades.map((slice) => [slice.key, slice.edge.count, slice.edge.expectancy]),
    [['A', 2, 2.5], ['C', 1, -1], [null, 1, -1]])

  // A trade with two contexts counts under both; tags come out best R first.
  const contexts = sliceBy(samples, 'context', kindOf)
  assert.deepEqual(contexts.map((slice) => [slice.key, slice.edge.totalR]), [['trend-day', 4], ['chop', -2]])

  // Run clean is the group with no mistake.
  const mistakes = sliceBy(samples, 'mistake', kindOf)
  assert.deepEqual(mistakes.map((slice) => [slice.key, slice.edge.count]), [['chased', 1], [null, 3]])
})

test('the broker states the hour and the side, so every trade has one', () => {
  const late = sample(1, {}, { hour: 16, side: 'sell' })
  assert.deepEqual(keysFor(late, 'hour', kindOf), ['16'])
  assert.deepEqual(keysFor(sample(1, {}, { hour: 9 }), 'hour', kindOf), ['09'])
  assert.deepEqual(keysFor(late, 'side', kindOf), ['sell'])
  assert.deepEqual(keysFor(late, 'symbol', kindOf), ['XAUUSD'])
  assert.equal(multipleOf(late.trade), 1, 'a short that went its way is positive')
  const hours = sliceBy([late, sample(-1, {}, { hour: 9 })], 'hour', kindOf)
  assert.deepEqual(hours.map((slice) => slice.key), ['09', '16'])
})

test('the exits are filed under what closed each trade', () => {
  const exits = exitsOf([sample(-1, {}, { exit: 'stop' }), sample(3, {}, { exit: 'target', target: 106 }), sample(0.5)])
  assert.equal(exits.stop.count, 1)
  assert.equal(exits.target.expectancy, 3)
  assert.equal(exits.manual.count, 1)
})

test('capture weighs what the winners took against the reward their targets planned', () => {
  const taken = capture([sample(1.5), sample(3), sample(-1)])
  // Both targets stood at 3R, six points past a two-point stop.
  assert.deepEqual(taken, { planned: 3, taken: 2.25, count: 2 })
  assert.equal(capture([sample(1, {}, { target: null })]), null)
  assert.equal(capture([sample(-1)]), null)
})

test('a loss past the stop by more than a tenth of an R stands out', () => {
  const past = pastTheStop([sample(-1), sample(-1.05), sample(-1.4), sample(2)])
  assert.deepEqual(past.map((one) => multipleOf(one.trade)?.toFixed(2)), ['-1.40'])
})

test('the deepest dip is the furthest the running R fell below its best', () => {
  const steps = curveOf([
    sample(-1, {}, { day: '2026-09-21' }), sample(3, {}, { day: '2026-09-22' }),
    sample(-1, {}, { day: '2026-09-23' }), sample(-1, {}, { day: '2026-09-24' }),
    sample(0.5, {}, { day: '2026-09-25' }),
  ])
  // From nothing down to −1 is a dip too; from +2 down to 0 is the deepest.
  assert.equal(deepestDip(steps), 2)
  assert.equal(deepestDip(curveOf([sample(1), sample(2)])), 0)
})

test('the best tenth of the trades, and their share of the total', () => {
  const twelve = [sample(5), sample(2), ...Array.from({ length: 10 }, () => sample(-0.1))]
  const top = topTenth(twelve)!
  // A tenth of twelve is two trades, whatever is left of one.
  assert.equal(top.count, 2)
  // They made 7R less two commissions; the other ten lost a tenth of an R each, and their commissions besides.
  assert.equal(top.share.toFixed(4), (0.0696 / 0.0576).toFixed(4))
  assert.ok(top.share > 1, 'the rest gave some of it back')
  assert.equal(topTenth([sample(-1), sample(0.5)]), null)
  assert.equal(topTenth([sample(2)]), null)
})

test('costs are a share of what the trades made before them', () => {
  // Two trades that made 30 and lost 10 before costs, and paid 0.2 each: 0.4 of 20.
  assert.equal(costShare([sample(3), sample(-1)])?.toFixed(6), '0.020000')
  assert.equal(costShare([]), null)
})

test('a trade costs put under water after it went its way is a scratch; one without a stop is a loss', () => {
  // A hair in its favour before costs, and under water after them.
  const hair = sample(0.01)
  hair.trade.commission = -0.5
  const bare = sample(-1)
  bare.trade.stop = { initial: null, final: 99 }
  const edge = edgeOf([hair, bare, sample(1)])
  assert.deepEqual([edge.wins, edge.scratches, edge.losses], [1, 1, 1])
  // The loss without a stop has no R to average, so the losers have none.
  assert.equal(edge.avgLoss, null)
})
