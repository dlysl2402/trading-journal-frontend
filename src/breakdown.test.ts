import assert from 'node:assert/strict'
import test from 'node:test'
import { breakdown, keysOf } from './breakdown.ts'
import type { Note } from './margin.ts'
import type { Kind } from './tags.ts'

const kinds: Record<string, Kind> = {
  'break-and-continue': 'play', 'failed-breakout': 'play',
  'trend-day': 'context', 'first-hour': 'context', chased: 'mistake',
}
const kindOf = (slug: string): Kind | undefined => kinds[slug]

const note = (grade: Note['grade'], tags: string[] = [], text = ''): Note =>
  ({ text, tags, grade, updatedAt: new Date('2026-09-20T00:00:00Z') })
const blank: Note = { text: '', tags: [], grade: null, updatedAt: null }

test('a note files under its grade, or under its tags of one kind', () => {
  const written = note('A', ['trend-day', 'break-and-continue', 'first-hour'])
  assert.deepEqual(keysOf(written, 'grade', kindOf), ['A'])
  assert.deepEqual(keysOf(written, 'context', kindOf), ['trend-day', 'first-hour'])
  assert.deepEqual(keysOf(written, 'mistake', kindOf), [])
  assert.deepEqual(keysOf(note(null), 'grade', kindOf), [])
})

test('grades come out in their own order, summed, with the ungraded last', () => {
  const groups = breakdown([
    { result: -0.01, note: note('C') },
    { result: 0.02, note: note('A') },
    { result: 0.01, note: note(null, [], 'no grade, but written up') },
    { result: 0.03, note: note('A') },
    { result: -0.005, note: note('B') },
  ], 'grade', kindOf)
  assert.deepEqual(groups.map((g) => g.key), ['A', 'B', 'C', null])
  const a = groups[0]!
  assert.equal(a.count, 2)
  assert.equal(a.wins, 2)
  assert.equal(Number(a.total.toFixed(6)), 0.05)
})

test('tags come out best total first, and a trade with two of a kind counts in both', () => {
  const groups = breakdown([
    { result: 0.01, note: note('A', ['trend-day', 'first-hour']) },
    { result: 0.02, note: note('B', ['first-hour']) },
    { result: -0.01, note: note('C', ['break-and-continue']) },
  ], 'context', kindOf)
  assert.deepEqual(groups.map((g) => [g.key, g.count]), [['first-hour', 2], ['trend-day', 1], [null, 1]])
})

test('a trade nobody has written up is left out, rather than counted as having none', () => {
  const groups = breakdown([
    { result: 0.01, note: blank },
    { result: -0.02, note: note('B') },
  ], 'play', kindOf)
  assert.deepEqual(groups, [{ key: null, count: 1, wins: 0, total: -0.02 }])
})
