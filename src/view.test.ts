import assert from 'node:assert/strict'
import test from 'node:test'
import type { Trade } from './journal.ts'
import { costsOf, endedAs, equityCurve, exitPrice, netOf, returnOf, stopAt } from './view.ts'

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

test('the curve starts at one when the first trade opened, then compounds once per trade', () => {
  const curve = equityCurve(trades)
  assert.deepEqual(curve.map((p) => Number(p.growth.toFixed(6))), [1, 1.1, 1.045, 1.052838])
  assert.equal(curve[0]?.time.toISOString(), '2026-09-07T10:00:00.000Z')
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
