/**
 * Layer 4 — the margin: what you write next to a trade.
 *
 * The first layer that is yours rather than the broker's, and so the first
 * that is *kept* rather than derived. Layers 2 and 3 are rebuilt from the
 * record on every load precisely so they cannot drift from it; a note has
 * nothing to drift from, and losing it on reload would defeat the point.
 *
 * It is held in memory for the life of the page and written through to
 * Supabase on every save, so the page never has to ask again. A save that
 * fails leaves the remembered note alone and throws, which is what lets the
 * editor keep your words on the screen rather than replacing them with a
 * stale copy of what the record still holds.
 */

import { saveAnnotation } from './store.ts'
import type { RawAnnotation } from './rows.ts'

/** What you wrote against one trade. */
export interface Note {
  /** Plain text, as typed. `notes.ts` reads the formatting back out of it. */
  text: string
  tags: string[]
  /** When it was last saved, or null if nothing has been written yet. */
  updatedAt: Date | null
}

const NOTHING: Note = { text: '', tags: [], updatedAt: null }

/** Whether a trade has been written up at all. */
export function isBlank(note: Note): boolean {
  return note.text.trim() === '' && note.tags.length === 0
}

export interface Margin {
  /** What you wrote against a trade — an empty note if you have not yet. */
  get: (positionId: string) => Note
  /** Write it through to the record. Throws if the record refuses. */
  save: (positionId: string, text: string, tags: string[]) => Promise<Note>
  /** How many trades have something written against them. */
  written: () => number
}

export function openMargin(accountId: string, rows: RawAnnotation[]): Margin {
  const notes = new Map<string, Note>(rows.map((row) => [row.position_id, {
    text: row.note ?? '',
    tags: row.tags,
    updatedAt: new Date(row.updated_at),
  }]))

  const get = (positionId: string): Note => notes.get(positionId) ?? NOTHING

  return {
    get,

    async save(positionId, text, tags) {
      const updatedAt = await saveAnnotation(accountId, positionId, text, tags)
      const note: Note = { text, tags, updatedAt }
      // An emptied note stays as a row rather than being deleted: the record
      // should show that you went back and rubbed it out, not that you were
      // never there.
      notes.set(positionId, note)
      return note
    },

    written() {
      let count = 0
      for (const note of notes.values()) if (!isBlank(note)) count++
      return count
    },
  }
}
