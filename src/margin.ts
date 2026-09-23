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
 *
 * The clips you record of a trade are the margin's too, yours and not the
 * broker's, but they are not held here: the bucket that keeps them is the
 * record of which trades have one, and it is asked each time a trade is
 * opened, so nothing on this side has to be kept in step with it.
 */

import { readClips, saveAnnotation, uploadClip } from './store.ts'
import type { Clip } from './store.ts'
import type { RawAnnotation } from './rows.ts'
import type { Grade } from './tags.ts'

/** What you wrote against one trade. */
export interface Note {
  /** Plain text, as typed. `notes.ts` reads the formatting back out of it. */
  text: string
  /** Slugs from the vocabulary in `tags.ts`. */
  tags: string[]
  /** The setup at entry, or null until you grade it. */
  grade: Grade | null
  /** When it was last saved, or null if nothing has been written yet. */
  updatedAt: Date | null
}

/** A note's fields you write, without the timestamp the save supplies. */
export type Written = Omit<Note, 'updatedAt'>

const NOTHING: Note = { text: '', tags: [], grade: null, updatedAt: null }

/** Whether a trade has been written up at all. */
export function isBlank(note: Note): boolean {
  return note.text.trim() === '' && note.tags.length === 0 && note.grade === null
}

export interface Margin {
  /** What you wrote against a trade — an empty note if you have not yet. */
  get: (positionId: string) => Note
  /** Write it through to the record. Throws if the record refuses. */
  save: (positionId: string, written: Written) => Promise<Note>
  /** How many trades have something written against them. */
  written: () => number
  /** The clips recorded against a trade, signed and ready to play. */
  clips: (positionId: string) => Promise<Clip[]>
  /** Put a clip in a trade's folder, saying how far along it is. */
  addClip: (positionId: string, file: File, progress: (fraction: number) => void) => Promise<void>
}

export function openMargin(accountId: string, rows: RawAnnotation[]): Margin {
  const notes = new Map<string, Note>(rows.map((row) => [row.position_id, {
    text: row.note ?? '',
    tags: row.tags,
    grade: row.grade,
    updatedAt: new Date(row.updated_at),
  }]))

  const get = (positionId: string): Note => notes.get(positionId) ?? NOTHING

  return {
    get,

    async save(positionId, written) {
      const updatedAt = await saveAnnotation(accountId, positionId,
        { note: written.text, tags: written.tags, grade: written.grade })
      const note: Note = { ...written, updatedAt }
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

    clips: (positionId) => readClips(accountId, positionId),
    addClip: (positionId, file, progress) => uploadClip(accountId, positionId, file, progress),
  }
}
