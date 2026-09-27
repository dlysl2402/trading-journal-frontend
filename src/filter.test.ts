import assert from 'node:assert/strict'
import test from 'node:test'
import type { Entry, Filter, Words } from './filter.ts'
import { EVERYTHING, matches, narrows } from './filter.ts'
import type { Trade } from './journal.ts'
import type { Note } from './margin.ts'
import type { Kind } from './tags.ts'

function entry(over: Partial<Trade> = {}, result = 0.01, day = '2026-09-21'): Entry {
  const trade: Trade = {
    positionId: '1', symbol: 'XAUUSD', side: 'buy', tag: 'RiskManager',
    entry: { dealId: '1', time: new Date('2026-09-21T10:00:00Z'), price: 100, volume: 1 },
    exits: [{ dealId: '2', time: new Date('2026-09-21T11:00:00Z'), price: 101, volume: 1, reason: { kind: 'manual' } }],
    stop: { initial: 99, final: 99 }, target: { initial: 102, final: 102 },
    grossProfit: 10, commission: 0, swap: 0, balanceAtEntry: 1000,
    ...over,
  }
  return { trade, result, day }
}

const kinds: Record<string, Kind> = { 'break-and-continue': 'play', chased: 'mistake' }
const words: Words = {
  kindOf: (slug) => kinds[slug],
  label: (slug) => ({ 'break-and-continue': 'Break and continue', chased: 'Chased' })[slug] ?? slug,
}

const blank: Note = { text: '', tags: [], grade: null, updatedAt: null }
const written: Note = { text: 'Waited for the **close**.', tags: ['break-and-continue'], grade: 'A', updatedAt: new Date() }
const only = (over: Partial<Filter>): Filter => ({ ...EVERYTHING, ...over })

test('the empty filter lets everything through and narrows nothing', () => {
  assert.equal(narrows(EVERYTHING), false)
  assert.equal(matches(entry(), blank, EVERYTHING, words), true)
  assert.equal(narrows(only({ text: '  ' })), false)
  assert.equal(narrows(only({ day: '2026-09-21' })), true)
})

test('wins and losses are split on the result, and a scratch is neither', () => {
  assert.equal(matches(entry({}, 0.01), blank, only({ result: 'win' }), words), true)
  assert.equal(matches(entry({}, -0.01), blank, only({ result: 'win' }), words), false)
  assert.equal(matches(entry({}, 0), blank, only({ result: 'win' }), words), false)
  assert.equal(matches(entry({}, 0), blank, only({ result: 'loss' }), words), false)
})

test('the review filter reads whether anything is written, not what', () => {
  assert.equal(matches(entry(), blank, only({ review: 'todo' }), words), true)
  assert.equal(matches(entry(), written, only({ review: 'todo' }), words), false)
  assert.equal(matches(entry(), { ...blank, grade: 'C' }, only({ review: 'done' }), words), true)
})

test('side and day narrow to exactly one', () => {
  assert.equal(matches(entry({ side: 'sell' }), blank, only({ side: 'buy' }), words), false)
  assert.equal(matches(entry(), blank, only({ day: '2026-09-22' }), words), false)
  assert.equal(matches(entry(), blank, only({ day: '2026-09-21', side: 'buy' }), words), true)
})

test('search finds every word somewhere in the trade, your tags by their label and your note', () => {
  assert.equal(matches(entry(), written, only({ text: 'xau break' }), words), true)
  assert.equal(matches(entry(), written, only({ text: 'close long' }), words), true)
  assert.equal(matches(entry(), written, only({ text: 'riskmanager' }), words), true)
  assert.equal(matches(entry(), written, only({ text: 'xau chased' }), words), false)
})

test('a breakdown row narrows to the written-up trades in that group', () => {
  const play = only({ group: { facet: 'play', key: 'break-and-continue' } })
  assert.equal(matches(entry(), written, play, words), true)
  assert.equal(matches(entry(), blank, play, words), false)

  const noMistake = only({ group: { facet: 'mistake', key: null } })
  assert.equal(matches(entry(), written, noMistake, words), true)
  assert.equal(matches(entry(), { ...written, tags: ['chased'] }, noMistake, words), false)
  // Nothing written is not the same as no mistake.
  assert.equal(matches(entry(), blank, noMistake, words), false)
})
