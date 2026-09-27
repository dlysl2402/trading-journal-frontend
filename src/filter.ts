/**
 * Which trades the list shows.
 *
 * The vocabulary exists so that "1h overextended" on a Tuesday loser is the
 * same tag as on a Friday winner and a filter can find them all; this is that
 * filter. It narrows the list and nothing else — the figures above it are
 * always every trade, so a number on the page never quietly means "of the
 * ones you happen to have filtered".
 *
 * Pure, like `notes.ts`: it takes the trade, what you wrote against it and the
 * filter, and answers yes or no, so it can be tested without a page.
 */

import type { Facet } from './breakdown.ts'
import { keysOf } from './breakdown.ts'
import type { Side, Trade } from './journal.ts'
import type { Note } from './margin.ts'
import { isBlank } from './margin.ts'
import type { Kind } from './tags.ts'

export interface Filter {
  /** Words that must all appear somewhere in the trade: symbol, side, the broker's tag, your tags, your note. */
  text: string
  result: 'all' | 'win' | 'loss'
  review: 'all' | 'todo' | 'done'
  side: 'all' | Side
  /** One day on the broker's clock, YYYY-MM-DD, or null for every day. */
  day: string | null
  /** One group from the breakdown: a grade or a tag, or with a null key the written-up trades with none. */
  group: { facet: Facet; key: string | null } | null
}

export const EVERYTHING: Filter = { text: '', result: 'all', review: 'all', side: 'all', day: null, group: null }

/** A trade as the list holds it. */
export interface Entry {
  trade: Trade
  /** Net of costs, as a fraction of the account. */
  result: number
  /** The day it closed, on the broker's clock, YYYY-MM-DD. */
  day: string
}

/** What the filter needs to know about the vocabulary. */
export interface Words {
  label: (slug: string) => string
  kindOf: (slug: string) => Kind | undefined
}

/** Whether a filter narrows anything at all. */
export function narrows(filter: Filter): boolean {
  return filter.text.trim() !== '' || filter.result !== 'all' || filter.review !== 'all' ||
    filter.side !== 'all' || filter.day !== null || filter.group !== null
}

export function matches(entry: Entry, note: Note, filter: Filter, words: Words): boolean {
  const { trade, result } = entry
  if (filter.result === 'win' && !(result > 0)) return false
  if (filter.result === 'loss' && !(result < 0)) return false
  if (filter.review === 'todo' && !isBlank(note)) return false
  if (filter.review === 'done' && isBlank(note)) return false
  if (filter.side !== 'all' && trade.side !== filter.side) return false
  if (filter.day !== null && entry.day !== filter.day) return false

  if (filter.group !== null) {
    // The breakdown counts written-up trades only, so its rows filter the same way.
    if (isBlank(note)) return false
    const keys = keysOf(note, filter.group.facet, words.kindOf)
    if (filter.group.key === null ? keys.length > 0 : !keys.includes(filter.group.key)) return false
  }

  const terms = filter.text.toLowerCase().split(/\s+/).filter((term) => term !== '')
  if (terms.length === 0) return true
  const haystack = [
    trade.symbol, trade.side, trade.side === 'buy' ? 'long' : 'short', trade.tag ?? '',
    ...note.tags.map(words.label), note.text,
  ].join('\n').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}
