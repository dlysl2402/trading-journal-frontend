/**
 * Layer 4's little language: the formatting a note is allowed to use.
 *
 * A note is kept as the plain text you typed. That is what the record holds
 * and what you would get back if this module were deleted tomorrow — the
 * formatting is a reading of the text, never a second copy of it.
 *
 * What comes out is blocks and runs, not HTML. `prose.ts` turns them into
 * elements with `textContent`, so a note that happens to contain a tag or a
 * quote mark is text on the page and can never be markup. That is the reason
 * this is a parser rather than a handful of replacements.
 *
 * The subset is the part of Markdown a trade write-up actually reaches for and
 * stops there. Anything else is the characters you typed.
 */

/**
 * A run of text within a line.
 *
 * Bold and italic together are their own kind rather than a set of marks. The
 * editor lets you press both, so the pair has to survive being written down —
 * but nothing else combines (code is verbatim by definition), and a list of
 * five kinds stays simpler to read than a bag of booleans on every run.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'bold-italic'; text: string }
  | { kind: 'code'; text: string }

/**
 * A paragraph and a quote hold lines rather than one run of text: a single
 * newline in a note is a line break, because that is what someone typing one
 * means by it. Markdown would fold those lines into a paragraph, and a list of
 * three things typed on three lines would come back as one.
 */
export type Block =
  | { kind: 'heading'; inlines: Inline[] }
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'quote'; lines: Inline[][] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }

const HEADING = /^#{1,3}\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const NUMBER = /^\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

/**
 * Code first, so a star inside backticks stays a star; then the longest run of
 * stars down to the shortest, so `***` is read as both marks rather than as a
 * bold that starts with an empty italic. All are lazy, so two bold runs on one
 * line are two runs rather than everything between the first and the last.
 *
 * Underscores are not italics here. They turn up in symbol names often enough
 * that `EURUSD_raw` would come back with a word missing.
 */
const INLINE = /`([^`]+)`|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g

/** One line, split into its runs. */
export function parseInlines(line: string): Inline[] {
  const inlines: Inline[] = []
  let at = 0
  for (const match of line.matchAll(INLINE)) {
    const [whole, code, both, bold, italic] = match
    if (match.index > at) inlines.push({ kind: 'text', text: line.slice(at, match.index) })
    if (code !== undefined) inlines.push({ kind: 'code', text: code })
    else if (both !== undefined) inlines.push({ kind: 'bold-italic', text: both })
    else if (bold !== undefined) inlines.push({ kind: 'bold', text: bold })
    else if (italic !== undefined) inlines.push({ kind: 'italic', text: italic })
    at = match.index + whole.length
  }
  if (at < line.length) inlines.push({ kind: 'text', text: line.slice(at) })
  return inlines
}

/**
 * A note, as blocks to draw.
 *
 * A blank line ends whatever was open, which is the only structure worth
 * insisting on: it is how you get a second paragraph, and how two lists end up
 * as two lists rather than one.
 */
export function parseNote(text: string): Block[] {
  const blocks: Block[] = []
  // Whether the line before this one can be continued — false after a blank.
  let joinable = false

  for (const raw of text.replaceAll('\r\n', '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === '') { joinable = false; continue }
    const last = joinable ? blocks.at(-1) : undefined

    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', inlines: parseInlines(heading[1]) })
      // A heading is a line of its own; the line under it starts something new.
      joinable = false
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = bullet === null ? NUMBER.exec(line) : null
    const item = bullet ?? numbered
    if (item !== null) {
      const ordered = numbered !== null
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(parseInlines(item[1]))
      else blocks.push({ kind: 'list', ordered, items: [parseInlines(item[1])] })
      joinable = true
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote !== null) {
      if (last?.kind === 'quote') last.lines.push(parseInlines(quote[1]))
      else blocks.push({ kind: 'quote', lines: [parseInlines(quote[1])] })
      joinable = true
      continue
    }

    if (last?.kind === 'paragraph') last.lines.push(parseInlines(line))
    else blocks.push({ kind: 'paragraph', lines: [parseInlines(line)] })
    joinable = true
  }

  return blocks
}

const MARKS: Record<Inline['kind'], string> = {
  text: '', bold: '**', italic: '*', 'bold-italic': '***', code: '`',
}

/** One line's runs, back as the text that would parse into them. */
function fromInlines(inlines: Inline[]): string {
  return inlines.map((run) => MARKS[run.kind] + run.text + MARKS[run.kind]).join('')
}

/**
 * Blocks back as the plain text the record keeps.
 *
 * The other direction from `parseNote`, and the half the editor needs: what
 * you see on the screen is a tree of elements, and this is how it becomes the
 * one string stored in `annotations.note`.
 *
 * It writes one spelling of each thing — `##` for every heading, `-` for every
 * bullet, `1.` counting up — so text that came in written another way comes
 * back normalised. Running it on its own output changes nothing, which is what
 * keeps the editor from reporting an edit every time you look at a note.
 */
export function toMarkdown(blocks: Block[]): string {
  return blocks.map((block) => {
    switch (block.kind) {
      case 'heading': return '## ' + fromInlines(block.inlines)
      case 'paragraph': return block.lines.map(fromInlines).join('\n')
      case 'quote': return block.lines.map((line) => '> ' + fromInlines(line)).join('\n')
      case 'list': return block.items
        .map((item, i) => (block.ordered ? i + 1 + '. ' : '- ') + fromInlines(item))
        .join('\n')
    }
  }).join('\n\n')
}
