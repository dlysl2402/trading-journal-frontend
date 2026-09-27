/**
 * What you wrote, set against what the trades did.
 *
 * The reason to grade and tag a trade at all: once enough of them carry a
 * play, "which of my plays pay?" has an answer, and so do "do my A setups
 * beat my C setups?" and "what does chasing cost me?". This groups the trades
 * you have written up by one facet — the grade, or one kind of tag — and sums
 * each group the way the calendar sums a day.
 *
 * Only trades with something written against them count. A trade nobody has
 * looked at yet has no play because nobody has said, not because it had
 * none, and folding it into "no play" would blur the one row that is
 * information: the trades you reviewed and could not name a play for.
 */

import type { Note } from './margin.ts'
import { isBlank } from './margin.ts'
import type { Kind } from './tags.ts'
import { GRADES } from './tags.ts'

/** A way to split the trades: by grade, or by one kind of tag. */
export type Facet = 'grade' | Kind

/** One group of trades, and what they did. */
export interface Group {
  /** The grade, or the tag's slug; null for the reviewed trades that have none. */
  key: string | null
  count: number
  wins: number
  /** Their returns summed, the way the calendar sums a day. */
  total: number
}

/** The keys a note files under for a facet: its grade, or its tags of that kind. Empty if it has none. */
export function keysOf(note: Note, facet: Facet, kindOf: (slug: string) => Kind | undefined): string[] {
  if (facet === 'grade') return note.grade === null ? [] : [note.grade]
  return note.tags.filter((slug) => kindOf(slug) === facet)
}

/**
 * The written-up trades, grouped by one facet.
 *
 * A trade with two tags of a kind counts in both groups, since context and
 * mistakes stack. Grades come out A, B, C, because that order means
 * something; tags come out best total first. The trades with none of the
 * facet come last, whatever they did.
 */
export function breakdown(
  entries: Iterable<{ result: number; note: Note }>, facet: Facet,
  kindOf: (slug: string) => Kind | undefined,
): Group[] {
  const groups = new Map<string | null, Group>()
  for (const { result, note } of entries) {
    if (isBlank(note)) continue
    const keys = keysOf(note, facet, kindOf)
    for (const key of keys.length === 0 ? [null] : keys) {
      const group = groups.get(key) ?? { key, count: 0, wins: 0, total: 0 }
      group.count++
      if (result > 0) group.wins++
      group.total += result
      groups.set(key, group)
    }
  }

  const rank = (key: string): number => (GRADES as readonly string[]).indexOf(key)
  return [...groups.values()].sort((a, b) => {
    if (a.key === null || b.key === null) return (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0)
    return facet === 'grade' ? rank(a.key) - rank(b.key) : b.total - a.total
  })
}
