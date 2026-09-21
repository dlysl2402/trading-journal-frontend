/**
 * Layer 4's vocabulary: the words a trade may be tagged with, and what each
 * kind of word is for.
 *
 * Tags are split into four kinds because they answer four different questions
 * about a trade, and the point of a journal is to be able to ask them apart
 * later: was it the conditions, the entry, the plan, or the trader? The kinds
 * are fixed here; the tags inside them are rows in the record that you add,
 * rename, describe and retire from the page.
 *
 * The one rule the vocabulary enforces is that a trade runs one play. Context
 * and triggers stack, mistakes stack, but the shape of the trade is a single
 * thing, and a trade you cannot name the play for is left without one — which
 * is itself worth knowing.
 */

import type { RawAnnotation, RawTag } from './rows.ts'
import { saveTag } from './store.ts'

export type Kind = RawTag['kind']
export type Grade = NonNullable<RawAnnotation['grade']>
export type Tag = RawTag

/**
 * What each kind is, in the words the page shows beside it. Written down here
 * rather than remembered, because the line between context and trigger is
 * easy to hold on a Tuesday and gone by Friday.
 */
export interface KindGuide {
  kind: Kind
  title: string
  /** The question a tag of this kind answers. */
  asks: string
  /** How to tell it from the others. */
  means: string
  /** Whether a trade carries at most one. */
  single: boolean
}

export const KINDS: readonly KindGuide[] = [
  {
    kind: 'context', title: 'Context', asks: 'Why this trade at all?',
    means: 'Already true while you were still deciding, and true whether or not you clicked: the 1h stretched, into a daily level, a trend day, the first hour.',
    single: false,
  },
  {
    kind: 'trigger', title: 'Trigger', asks: 'Why now, not five minutes ago?',
    means: 'The event on the entry bar, or the one before it, that ended the deciding. Quality belongs in the tag: a strong close and a weak close are two triggers.',
    single: false,
  },
  {
    kind: 'play', title: 'Play', asks: 'What shape was the trade?',
    means: 'The template you were running. One per trade, and none if you cannot name it: that is information too.',
    single: true,
  },
  {
    kind: 'mistake', title: 'Mistake', asks: 'What would you take back?',
    means: 'The process, never the result. Chased, sized wrong, cut early. A loser run well has none.',
    single: false,
  },
]

export const GRADES: readonly Grade[] = ['A', 'B', 'C']

/** What a grade is, in the same voice. */
export const GRADE_GUIDE = {
  title: 'Grade',
  asks: 'How good was the setup at entry?',
  means: 'Marked as it looked before you knew how it ended. The result already has a column.',
}

const ORDER: Record<Kind, number> = { context: 0, trigger: 1, play: 2, mistake: 3 }

/** "Strong close below support" → "strong-close-below-support". */
export function slugify(label: string): string {
  return label.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A trade's tags with one toggled.
 *
 * Off if it was on. On otherwise — and if it is a play, in place of whichever
 * play was there, because a trade runs one. Order is kept as it was, with the
 * new tag on the end; the page groups by kind when it draws them anyway.
 */
export function toggled(tags: string[], tag: Tag, kindOf: (slug: string) => Kind | undefined): string[] {
  if (tags.includes(tag.slug)) return tags.filter((slug) => slug !== tag.slug)
  const kept = tag.kind === 'play' ? tags.filter((slug) => kindOf(slug) !== 'play') : tags
  return [...kept, tag.slug]
}

export interface Vocabulary {
  /** Every tag, archived ones included, in the order the page shows them. */
  all: () => Tag[]
  /** The live tags of one kind, in order. */
  of: (kind: Kind) => Tag[]
  get: (slug: string) => Tag | undefined
  /** What to call a slug on the page: its label, or the slug itself if it is not in the vocabulary. */
  label: (slug: string) => string
  kindOf: (slug: string) => Kind | undefined
  /** A new tag of this kind, from its label, placed last. Throws if the slug is taken. */
  add: (kind: Kind, label: string) => Promise<Tag>
  /** Write a changed tag through to the record. */
  save: (tag: Tag) => Promise<Tag>
}

export function openVocabulary(rows: RawTag[]): Vocabulary {
  const tags = new Map<string, Tag>(rows.map((row) => [row.slug, row]))

  const sorted = (): Tag[] => [...tags.values()].sort((a, b) =>
    ORDER[a.kind] - ORDER[b.kind] || a.sort - b.sort || a.label.localeCompare(b.label))

  const save = async (tag: Tag): Promise<Tag> => {
    await saveTag(tag)
    tags.set(tag.slug, tag)
    return tag
  }

  return {
    all: sorted,
    of: (kind) => sorted().filter((tag) => tag.kind === kind && !tag.archived),
    get: (slug) => tags.get(slug),
    label: (slug) => tags.get(slug)?.label ?? slug,
    kindOf: (slug) => tags.get(slug)?.kind,
    save,

    add(kind, label) {
      const trimmed = label.trim().replace(/\s+/g, ' ')
      const slug = slugify(trimmed)
      if (slug === '') throw new Error('A tag needs a name.')
      const taken = tags.get(slug)
      if (taken !== undefined) {
        throw new Error(`"${taken.label}" is already a ${taken.kind} tag${taken.archived ? ', retired' : ''}.`)
      }
      const last = Math.max(0, ...[...tags.values()].filter((tag) => tag.kind === kind).map((tag) => tag.sort))
      return save({ slug, kind, label: trimmed, description: null, sort: last + 1, archived: false })
    },
  }
}
