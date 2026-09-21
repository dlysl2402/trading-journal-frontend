/**
 * A note as elements, and back again.
 *
 * One half of the hinge that lets the record keep plain text while the screen
 * shows formatting. `notes.ts` is the other half and knows nothing about a
 * browser: text ↔ blocks, pure and tested in Node. This is blocks ↔ elements,
 * which needs a DOM and so cannot be.
 *
 * Together they are the whole cost of storing prose rather than markup, and
 * they are deliberately the only two files that pay it. Nothing else in the
 * app knows a note has a format: `editor.ts` asks for elements and hands back
 * elements, `margin.ts` carries a string, and the column holds that string. If
 * the storage decision is ever revisited, these two files are the change.
 */

import { h } from './dom.ts'
import type { Block, Inline } from './notes.ts'

/** Which tags mean which mark, on the way back from elements to runs. */
const BOLD = new Set(['B', 'STRONG'])
const ITALIC = new Set(['I', 'EM'])
const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

/**
 * Elements that end a line wherever they turn up.
 *
 * The browser's own commands do not always produce tidy HTML: asking Chrome to
 * make a list out of a paragraph gives back `<p><ul><li>…</li></ul></p>`, a
 * list nested inside a paragraph, which nothing may contain. Reading only the
 * top level would see the paragraph, flatten the list into its text, and store
 * a note that had visibly been a list a moment earlier. So the shape is read
 * rather than trusted, at whatever depth it was built.
 */
const BLOCKY = new Set([...HEADINGS, 'P', 'DIV', 'UL', 'OL', 'LI', 'BLOCKQUOTE'])

interface Marks { bold: boolean; italic: boolean; code: boolean }

function kindOf(marks: Marks): Inline['kind'] {
  // Code is verbatim, so it cannot also be bold — the mark that changes what
  // the characters *mean* wins over the ones that change how they look.
  if (marks.code) return 'code'
  if (marks.bold && marks.italic) return 'bold-italic'
  if (marks.bold) return 'bold'
  if (marks.italic) return 'italic'
  return 'text'
}

// ── elements → runs ─────────────────────────────────────────────────────────

/**
 * One block's lines, reading the marks off the elements that carry them.
 *
 * Tolerant on purpose. A browser left to itself will nest `<b>` inside `<i>`,
 * split a word across two text nodes after an undo, and leave a trailing
 * `<br>` in a block it thinks is empty. None of that is worth fighting, so it
 * is read rather than prevented: anything unrecognised contributes its text
 * and nothing else.
 */
function readLines(from: Element): Inline[][] {
  const lines: Inline[][] = [[]]

  const walk = (node: Node, marks: Marks): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        // A contenteditable pads with non-breaking spaces; they are spaces.
        const text = (child.textContent ?? '').replaceAll('\u00a0', ' ')
        if (text === '') continue
        const kind = kindOf(marks)
        const line = lines[lines.length - 1]!
        const last = line[line.length - 1]
        // Runs of the same mark merge, so an undo cannot leave a word split
        // into three identical runs that write out as three sets of stars.
        if (last !== undefined && last.kind === kind) last.text += text
        else line.push({ kind, text } as Inline)
        continue
      }
      if (!(child instanceof HTMLElement)) continue
      if (child.tagName === 'BR') { lines.push([]); continue }
      // A block inside a block is a new line, so two paragraphs wrapped in a
      // quote do not come back as one run-on sentence.
      if (BLOCKY.has(child.tagName) && lines[lines.length - 1]!.length > 0) lines.push([])
      walk(child, {
        bold: marks.bold || BOLD.has(child.tagName),
        italic: marks.italic || ITALIC.has(child.tagName),
        code: marks.code || child.tagName === 'CODE',
      })
    }
  }

  walk(from, { bold: false, italic: false, code: false })
  // The filler `<br>` a browser leaves in an empty block is not a line.
  while (lines.length > 1 && lines[lines.length - 1]!.length === 0) lines.pop()
  return lines
}

/** Lines flattened to one, for the blocks that cannot hold a break. */
function oneLine(lines: Inline[][]): Inline[] {
  return lines.flat()
}

/** Whether an element wraps other blocks rather than holding a line of text. */
function wraps(element: Element): boolean {
  for (const child of element.children) if (BLOCKY.has(child.tagName)) return true
  return false
}

/** The document as blocks, whatever the browser actually built. */
export function readBlocks(root: HTMLElement): Block[] {
  const blocks: Block[] = []
  collect(root, blocks)
  return blocks
}

function collect(root: Node, blocks: Block[]): void {
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // A bare text node at the top, from a paste or a stripped block.
      const text = (node.textContent ?? '').replaceAll('\u00a0', ' ')
      if (text.trim() !== '') blocks.push({ kind: 'paragraph', lines: [[{ kind: 'text', text }]] })
      continue
    }
    if (!(node instanceof HTMLElement) || node.tagName === 'BR') continue

    if (node.tagName === 'UL' || node.tagName === 'OL') {
      const items = [...node.children]
        .filter((child) => child.tagName === 'LI')
        .map((item) => oneLine(readLines(item)))
        .filter((item) => item.length > 0)
      if (items.length > 0) blocks.push({ kind: 'list', ordered: node.tagName === 'OL', items })
      continue
    }

    if (HEADINGS.has(node.tagName)) {
      const inlines = oneLine(readLines(node))
      if (inlines.length > 0) blocks.push({ kind: 'heading', inlines })
      continue
    }

    if (node.tagName === 'BLOCKQUOTE') {
      const lines = readLines(node)
      if (lines.some((line) => line.length > 0)) blocks.push({ kind: 'quote', lines })
      continue
    }

    // A paragraph that turned out to be holding blocks is a wrapper, not a
    // paragraph; what matters is what is inside it.
    if (wraps(node)) { collect(node, blocks); continue }

    const lines = readLines(node)
    if (lines.some((line) => line.length > 0)) blocks.push({ kind: 'paragraph', lines })
  }
}

// ── runs → elements ─────────────────────────────────────────────────────────

const TAGS: Record<Inline['kind'], string[]> = {
  text: [], bold: ['strong'], italic: ['em'], 'bold-italic': ['strong', 'em'], code: ['code'],
}

/** Runs as elements, with the text always set through `textContent`. */
function writeInlines(inlines: Inline[], into: HTMLElement): void {
  for (const run of inlines) {
    const tags = TAGS[run.kind]
    if (tags.length === 0) { into.append(run.text); continue }
    // Built outside in, so bold-italic is <strong><em>, and the text lands in
    // the innermost one.
    const outer = h(tags[0]!)
    const inner = tags.length > 1 ? h(tags[1]!) : outer
    if (inner !== outer) outer.append(inner)
    inner.textContent = run.text
    into.append(outer)
  }
}

function writeLines(lines: Inline[][], into: HTMLElement): void {
  lines.forEach((line, index) => {
    if (index > 0) into.append(document.createElement('br'))
    writeInlines(line, into)
  })
}

/** The blocks as the elements you edit. */
export function writeBlocks(blocks: Block[], root: HTMLElement): void {
  root.replaceChildren()
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const node = h('h4')
      writeInlines(block.inlines, node)
      root.append(node)
    } else if (block.kind === 'list') {
      const list = h(block.ordered ? 'ol' : 'ul')
      for (const item of block.items) {
        const row = h('li')
        writeInlines(item, row)
        list.append(row)
      }
      root.append(list)
    } else {
      const node = h(block.kind === 'quote' ? 'blockquote' : 'p')
      writeLines(block.lines, node)
      root.append(node)
    }
  }
  // A contenteditable with no block in it has nowhere to put the caret, and
  // the first keystroke would land in a bare text node.
  if (root.childNodes.length === 0) {
    const first = h('p')
    first.append(document.createElement('br'))
    root.append(first)
  }
}

