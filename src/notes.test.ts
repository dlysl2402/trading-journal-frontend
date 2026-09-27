import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInlines, parseNote, timecode, toMarkdown } from './notes.ts'

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

// ── Moments on the tape ─────────────────────────────────────────────────────

test('a time in brackets is a moment on the tape', () => {
  assert.deepEqual(parseInlines('[0:26] Entry on the close'), [
    { kind: 'moment', text: '0:26', seconds: 26 },
    { kind: 'text', text: ' Entry on the close' },
  ])
})

test('a moment can sit anywhere in a line, and hours count', () => {
  assert.deepEqual(parseInlines('the retest at [1:02:05] failed').filter((run) => run.kind === 'moment'),
    [{ kind: 'moment', text: '1:02:05', seconds: 3725 }])
})

test('a moment is its own run in a list of them', () => {
  const [block] = parseNote('- [0:26] in\n- [0:34] out')
  assert.equal(block?.kind, 'list')
  assert.deepEqual(block?.kind === 'list' && block.items.map((item) => item[0]),
    [{ kind: 'moment', text: '0:26', seconds: 26 }, { kind: 'moment', text: '0:34', seconds: 34 }])
})

test('a clock time without brackets, or not a time at all, is text', () => {
  for (const line of ['entered at 14:30', '[0:60]', '[1:2]', '[a:bc]', '[0:26', '`[0:26]`']) {
    assert.ok(parseInlines(line).every((run) => run.kind !== 'moment'), line)
  }
})

test('a line marked on the tape and left empty keeps no trailing space', () => {
  const marked = [{ kind: 'list' as const, ordered: false, items: [[
    { kind: 'moment' as const, text: '0:26', seconds: 26 }, { kind: 'text' as const, text: ' ' },
  ]] }]
  assert.equal(toMarkdown(marked), '- [0:26]')
  assert.equal(toMarkdown(parseNote(toMarkdown(marked))), '- [0:26]')
})

test('a moment is written back in its shortest spelling', () => {
  assert.equal(toMarkdown(parseNote('[00:26]')), '[0:26]')
  assert.equal(toMarkdown(parseNote('[75:00] and [0:01:05]')), '[1:15:00] and [1:05]')
})

test('the tape and the note write a time the same way', () => {
  assert.equal(timecode(0), '0:00')
  assert.equal(timecode(26.9), '0:26')
  assert.equal(timecode(605), '10:05')
  assert.equal(timecode(3725), '1:02:05')
  assert.equal(timecode(-3), '0:00')
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
  '- [0:26] Entry on the strong close\n- [0:34] Took most of it at **the level**\n\nThe retest at [0:31] held.',
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
