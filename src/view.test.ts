import assert from 'node:assert/strict'
import test from 'node:test'
import type { Trade } from './journal.ts'
import { costsOf, endedAs, equityCurve, exitPrice, inFavour, multipleOf, netOf, plannedRatio, returnOf, riskShare, standouts, stopAt } from './view.ts'

/*
 * There were two tests here that no longer have anything to test. The page
 * used to be a string with the journal's JSON substituted into it, so a broker
 * named "Bad </script> Broker" could close the script tag early and a tag
 * containing "$&" could be eaten by the replacement, and both were checked.
 * The page now holds the journal in memory and never becomes a string, so
 * neither failure is reachable. Nothing replaced them, on purpose.
 */

function trade(positionId: string, net: number, opened: string, closed: string, balanceAtEntry = 1000): Trade {
  return {
    positionId, symbol: 'XAUUSD', side: 'buy', tag: null,
    entry: { dealId: positionId, time: new Date(opened), price: 100, volume: 1 },
    exits: [{ dealId: positionId + 'x', time: new Date(closed), price: 101, volume: 1, reason: { kind: 'manual' } }],
    stop: { initial: null, final: null }, target: { initial: null, final: null },
    grossProfit: net + 1, commission: -1, swap: 0, balanceAtEntry,
  }
}

// Given out of order, so the curve has to sort them itself. The third trade
// was opened on twice the balance, so its 15 counts half as much as 15 would
// have on the first day.
const trades = [
  trade('2', -50, '2026-09-08T10:00:00Z', '2026-09-08T11:00:00Z'),
  trade('1', 100, '2026-09-07T10:00:00Z', '2026-09-07T11:00:00Z'),
  trade('3', 15, '2026-09-09T10:00:00Z', '2026-09-09T11:00:00Z', 2000),
]

test('a return is the net against the balance the trade was sized on', () => {
  assert.equal(returnOf(trades[1]!), 0.1)
  assert.equal(returnOf(trades[2]!), 0.0075)
})

test('the curve starts at one at midnight of the first trade\'s day, then compounds once per trade', () => {
  const curve = equityCurve(trades)
  assert.deepEqual(curve.map((p) => Number(p.growth.toFixed(6))), [1, 1.1, 1.045, 1.052838])
  assert.equal(curve[0]?.time.toISOString(), '2026-09-07T00:00:00.000Z')
  assert.equal(curve[0]?.trade, null)
  assert.deepEqual(curve.slice(1).map((p) => p.trade?.positionId), ['1', '2', '3'])
})

test('no trades means no curve', () => {
  assert.deepEqual(equityCurve([]), [])
})

test('net is gross less what the trade cost to place and hold', () => {
  const one = trades[1]!
  assert.equal(netOf(one), 100)
  assert.equal(costsOf(one), -1)
  assert.equal(stopAt(one), null)
  assert.equal(endedAs(one), 'manual')
})

test('the stop in force at the close wins over the one placed at entry', () => {
  const trailed = { ...trades[1]!, stop: { initial: 95, final: 100.5 } }
  assert.equal(stopAt(trailed), 100.5)
  assert.equal(stopAt({ ...trades[1]!, stop: { initial: 95, final: null } }), 95)
})

test('a trade closed in pieces is filed under the exit that closed most of it', () => {
  const split = trade('1', 10, '2026-09-07T10:00:00Z', '2026-09-07T11:00:00Z')
  split.exits = [
    { dealId: 'a', time: new Date('2026-09-07T11:00:00Z'), price: 101.1, volume: 0.75, reason: { kind: 'manual' } },
    { dealId: 'b', time: new Date('2026-09-07T11:00:05Z'), price: 102.3, volume: 0.25, reason: { kind: 'target', price: 102.3 } },
  ]
  assert.equal(endedAs(split), 'manual')
  // The exit price is the average weighted by volume, to the decimals the broker quotes.
  assert.equal(exitPrice(split), 101.4)
})

test('a result in R is the exit\'s distance over the stop placed with the entry, either side', () => {
  const long = { ...trade('1', 10, '2026-09-07T10:00:00Z', '2026-09-07T11:00:00Z'), stop: { initial: 98, final: 98 } }
  long.exits = [{ ...long.exits[0]!, price: 103 }]
  assert.equal(inFavour(long, 97), -3)
  assert.equal(multipleOf(long), 1.5)

  // A short that went its way is positive too.
  const short = { ...long, side: 'sell' as const, stop: { initial: 102, final: 102 }, target: { initial: 94, final: 94 } }
  short.exits = [{ ...long.exits[0]!, price: 97 }]
  assert.equal(multipleOf(short), 1.5)
  assert.equal(plannedRatio(short), 3)
})

test('what a trade risked is its gross return over its multiple, as a share of the account', () => {
  // 30 gross on 1000 for a run of 3 against a stop 2 away: 3% for 1.5R, so 1R was 2%.
  const sized = { ...trade('1', 29, '2026-09-07T10:00:00Z', '2026-09-07T11:00:00Z'), stop: { initial: 98, final: 98 } }
  sized.exits = [{ ...sized.exits[0]!, price: 103 }]
  assert.equal(riskShare(sized)?.toFixed(6), '0.020000')
  // The same trade on twice the balance risked half as much of it.
  assert.equal(riskShare({ ...sized, balanceAtEntry: 2000 })?.toFixed(6), '0.010000')

  // Without the stop it was opened with there is no R to divide by, and a
  // trade that left at its entry moved nothing to measure the size by.
  assert.equal(riskShare({ ...sized, stop: { initial: null, final: 98 } }), null)
  const scratch = { ...sized, grossProfit: 0, exits: [{ ...sized.exits[0]!, price: 100 }] }
  assert.equal(riskShare(scratch), null)
})

test('each week marks its biggest win and its biggest loss', () => {
  const week = [
    trade('small', 5, '2026-09-14T10:00:00Z', '2026-09-14T10:05:00Z'),
    trade('big', 40, '2026-09-16T10:00:00Z', '2026-09-16T10:05:00Z'),
    trade('bad', -30, '2026-09-17T10:00:00Z', '2026-09-17T10:05:00Z'),
    trade('loss', -10, '2026-09-18T10:00:00Z', '2026-09-18T10:05:00Z'),
    // Sunday belongs to the week that began on the Monday before it.
    trade('sunday', -35, '2026-09-20T10:00:00Z', '2026-09-20T10:05:00Z'),
  ]
  assert.deepEqual([...standouts(week)].sort(), [['big', 'best'], ['sunday', 'worst']])
})

test('a week of one trade, or of nothing but losses, has no biggest win', () => {
  const alone = [trade('alone', 50, '2026-09-07T10:00:00Z', '2026-09-07T10:05:00Z')]
  assert.equal(standouts(alone).size, 0)
  const red = [
    trade('a', -5, '2026-09-14T10:00:00Z', '2026-09-14T10:05:00Z'),
    trade('b', -9, '2026-09-15T10:00:00Z', '2026-09-15T10:05:00Z'),
  ]
  assert.deepEqual([...standouts(red)], [['b', 'worst']])
})

test('a stop set after entry, or trailed, is not what the trade risked', () => {
  const late = { ...trades[1]!, stop: { initial: null, final: 99 } }
  assert.equal(multipleOf(late), null)
  assert.equal(plannedRatio(late), null)
  // Trailed to breakeven: still measured against where the stop started.
  const trailed = { ...trades[1]!, stop: { initial: 98, final: 100 }, target: { initial: 104, final: 104 } }
  assert.equal(multipleOf(trailed), 0.5)
  assert.equal(plannedRatio(trailed), 2)
})
