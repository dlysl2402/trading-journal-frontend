import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTags, parseInlines, parseNote, parseTags, toMarkdown } from './notes.ts'

/** The text of a block, ignoring which runs are bold — for the structural tests. */
function text(block: { lines: { text: string }[][] } | { items: { text: string }[][] }): string[] {
  const rows = 'lines' in block ? block.lines : block.items
  return rows.map((row) => row.map((run) => run.text).join(''))
}

test('a plain line is a paragraph', () => {
  assert.deepEqual(parseNote('Took the London open.'), [
    { kind: 'paragraph', lines: [[{ kind: 'text', text: 'Took the London open.' }]] },
  ])
})

test('a single newline is a line break, and a blank line is a new paragraph', () => {
  const blocks = parseNote('one\ntwo\n\nthree')
  assert.equal(blocks.length, 2)
  assert.deepEqual(text(blocks[0] as never), ['one', 'two'])
  assert.deepEqual(text(blocks[1] as never), ['three'])
})

test('consecutive dashes are one list, and a blank line starts another', () => {
  const blocks = parseNote('- first\n- second\n\n- third')
  assert.equal(blocks.length, 2)
  assert.deepEqual(text(blocks[0] as never), ['first', 'second'])
  assert.deepEqual(text(blocks[1] as never), ['third'])
})

test('numbers and dashes are different lists even when they touch', () => {
  const blocks = parseNote('- a\n1. b')
  assert.deepEqual(blocks.map((b) => b.kind === 'list' && b.ordered), [false, true])
})

test('a star at the start of a line is a bullet, not an italic', () => {
  const [block] = parseNote('* held it too long')
  assert.equal(block?.kind, 'list')
  assert.deepEqual(text(block as never), ['held it too long'])
})

test('quoted lines gather into one quote', () => {
  const blocks = parseNote('> wait for the retest\n> every time')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.kind, 'quote')
  assert.deepEqual(text(blocks[0] as never), ['wait for the retest', 'every time'])
})

test('a heading stands alone and does not swallow the line under it', () => {
  const blocks = parseNote('## What I saw\nA clean break.')
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'paragraph'])
})

test('bold, italic and code, and the text between them', () => {
  assert.deepEqual(parseInlines('a **b** c *d* `e`'), [
    { kind: 'text', text: 'a ' },
    { kind: 'bold', text: 'b' },
    { kind: 'text', text: ' c ' },
    { kind: 'italic', text: 'd' },
    { kind: 'text', text: ' ' },
    { kind: 'code', text: 'e' },
  ])
})

test('two bold runs on one line stay two runs', () => {
  assert.deepEqual(parseInlines('**one** and **two**').filter((run) => run.kind === 'bold'),
    [{ kind: 'bold', text: 'one' }, { kind: 'bold', text: 'two' }])
})

test('a star inside backticks is a star', () => {
  assert.deepEqual(parseInlines('`a * b`'), [{ kind: 'code', text: 'a * b' }])
})

test('an underscore is not an italic, because symbols carry them', () => {
  assert.deepEqual(parseInlines('EURUSD_raw'), [{ kind: 'text', text: 'EURUSD_raw' }])
})

test('an unclosed star is just a star', () => {
  assert.deepEqual(parseInlines('2 * 3'), [{ kind: 'text', text: '2 * 3' }])
})

test('markup in a note is text, never markup', () => {
  assert.deepEqual(parseInlines('<script>alert(1)</script>'),
    [{ kind: 'text', text: '<script>alert(1)</script>' }])
})

test('nothing but whitespace parses to nothing', () => {
  assert.deepEqual(parseNote('   \n  \n'), [])
})

test('tags split on commas, keeping the first spelling and dropping repeats', () => {
  assert.deepEqual(parseTags(' breakout , ICT ,ict,  , breakout'), ['breakout', 'ICT'])
})

test('tags keep the order they were named in', () => {
  assert.deepEqual(parseTags('zebra, apple'), ['zebra', 'apple'])
})

test('tags survive a round trip through the editor', () => {
  const tags = ['news fade', 'B setup']
  assert.deepEqual(parseTags(formatTags(tags)), tags)
})

// ── Writing it back down ────────────────────────────────────────────────────
// The editor shows formatting rather than the marks that make it, so every
// save turns elements back into text. These are the properties that keeps
// honest: what goes in comes out, and looking at a note is not an edit.

test('bold and italic together survive being written down', () => {
  assert.deepEqual(parseInlines('***both***'), [{ kind: 'bold-italic', text: 'both' }])
  assert.equal(toMarkdown(parseNote('***both***')), '***both***')
})

test('bold is still bold beside the pair', () => {
  assert.deepEqual(parseInlines('**b** and ***both***'),
    [{ kind: 'bold', text: 'b' }, { kind: 'text', text: ' and ' }, { kind: 'bold-italic', text: 'both' }])
})

/** Text already in the one spelling the editor writes comes back untouched. */
const SETTLED = [
  'A plain line.',
  'Two lines\nin one paragraph.',
  'One paragraph.\n\nThen another.',
  '## What I saw\n\nA clean break.',
  '- first\n- second',
  '1. first\n2. second',
  '> wait for the retest\n> every time',
  'Some **bold**, some *italic*, some `code`, some ***both***.',
  '## Heading\n\nText.\n\n- a\n- b\n\n> quoted\n\nLast word.',
]

for (const text of SETTLED) {
  test(`round trip: ${JSON.stringify(text.slice(0, 32))}`, () => {
    assert.equal(toMarkdown(parseNote(text)), text)
  })
}

test('a heading written any depth comes back as one', () => {
  assert.equal(toMarkdown(parseNote('# One')), '## One')
  assert.equal(toMarkdown(parseNote('### Three')), '## Three')
})

test('stars and brackets as bullets come back as dashes', () => {
  assert.equal(toMarkdown(parseNote('* a\n* b')), '- a\n- b')
  assert.equal(toMarkdown(parseNote('1) a\n2) b')), '1. a\n2. b')
})

test('a numbered list is renumbered from one', () => {
  assert.equal(toMarkdown(parseNote('7. a\n9. b')), '1. a\n2. b')
})

test('writing it down twice changes nothing the second time', () => {
  const messy = '# Title\n* one\n* two\n\n> said\n\n5) go\n6) again\n\nplain'
  const once = toMarkdown(parseNote(messy))
  assert.equal(toMarkdown(parseNote(once)), once)
})

test('an empty note writes nothing', () => {
  assert.equal(toMarkdown(parseNote('')), '')
})
