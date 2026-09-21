import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Kind, Tag } from './tags.ts'
import { slugify, toggled } from './tags.ts'

const tag = (slug: string, kind: Kind): Tag =>
  ({ slug, kind, label: slug, description: null, sort: 0, archived: false })

const kinds: Record<string, Kind> = {
  'break-and-continue': 'play', 'retrace-and-push': 'play', '1h-overextended': 'context',
}
const kindOf = (slug: string): Kind | undefined => kinds[slug]

test('a label becomes one slug, whatever its spacing and case', () => {
  assert.equal(slugify('Strong close  below Support'), 'strong-close-below-support')
  assert.equal(slugify('  1h / 30m overextended! '), '1h-30m-overextended')
  assert.equal(slugify('***'), '')
})

test('toggling a tag the trade carries takes it off', () => {
  assert.deepEqual(toggled(['1h-overextended', 'chased'], tag('chased', 'mistake'), kindOf), ['1h-overextended'])
})

test('toggling a tag the trade lacks puts it on the end', () => {
  assert.deepEqual(toggled(['1h-overextended'], tag('chased', 'mistake'), kindOf), ['1h-overextended', 'chased'])
})

test('a trade runs one play, so a second play replaces the first', () => {
  assert.deepEqual(
    toggled(['break-and-continue', '1h-overextended'], tag('retrace-and-push', 'play'), kindOf),
    ['1h-overextended', 'retrace-and-push'])
})

test('context and mistakes stack', () => {
  const on = toggled(['1h-overextended'], tag('trend-day', 'context'), kindOf)
  assert.deepEqual(on, ['1h-overextended', 'trend-day'])
})
