/**
 * The note editor: bold looks bold, not `**bold**`.
 *
 * What you edit is the rendered note itself — one surface, not a box you type
 * marks into and a preview that shows what they meant. There is no read state
 * and no write state, because with the formatting drawn live the two would
 * look the same and swapping between them would be ceremony for nothing.
 *
 * The record underneath is unchanged: `annotations.note` still holds plain
 * text. This module is the hinge — `parseNote` turns that text into elements
 * on the way in, and `toMarkdown` turns the elements back into text on the way
 * out. Nothing about the editor reaches the database, so a note stays readable
 * in a SQL client, exportable anywhere, and safe to draw, and losing this file
 * would cost you the toolbar rather than the writing.
 *
 * The one rule the surface enforces is that the document stays inside the
 * shape `notes.ts` can describe: six kinds of run, four kinds of block.
 * Anything pasted in is reduced to that on the way through, which is why paste
 * is taken as plain text rather than as whatever markup came with it.
 *
 * One of those runs is a moment on the tape, and the note is where the tape
 * gets written about, so this is also where moments go in: a line of their
 * own, in time order, when the tape is marked; at the caret from the toolbar;
 * or typed as `[0:26]`, which turns into one on the closing bracket. A moment
 * in the note plays the tape from there when clicked, and the one the tape
 * has reached is lit as it plays.
 *
 * The translating itself lives in `prose.ts`. What is left here is only the
 * surface: a toolbar, the caret, and the browser's own editing commands.
 */

import { h } from './dom.ts'
import type { IconName } from './icons.ts'
import { icon } from './icons.ts'
import { parseInlines, parseNote, toMarkdown } from './notes.ts'
import { momentChip, readBlocks, secondsAt, writeBlocks } from './prose.ts'
import type { Moment } from './tape.ts'

// ── the surface ─────────────────────────────────────────────────────────────

/** How the note reaches the tape it is written about. */
export interface TapeLink {
  /** Where the tape is, or null with nothing loaded. */
  now: () => number | null
  /** Play from a moment clicked in the note. */
  seek: (seconds: number) => void
  /** The note's moments changed, so the marks on the scrubber should too. */
  changed: () => void
}

export interface Editor {
  /** The toolbar and the writing surface together. */
  node: HTMLElement
  /** The note as the text the record keeps. */
  value: () => string
  /** Draw a note into it, replacing whatever is there. */
  set: (text: string) => void
  focus: () => void
  /**
   * A moment as a line of its own, among the others in time order — or, if
   * the note already has a line for that second, that line. With `caret`,
   * the caret goes to the end of it, ready for what you saw.
   */
  addMoment: (seconds: number, caret: boolean) => void
  /** The moments the note points at, each with the words on its line. */
  moments: () => Moment[]
  /** Light the moment the tape has reached. */
  light: (seconds: number | null) => void
  /** Whether the tape has a recording to take a time from. */
  tapeReady: (ready: boolean) => void
}

interface Command {
  icon: IconName
  title: string
  run: () => void
  active: () => boolean
  /** Whether a small gap sets this button apart from the one before it. */
  group?: boolean
}

/** What is left of a line once its moments are taken out, as the label for their marks. */
function wordsOf(line: Element): string {
  const copy = line.cloneNode(true) as Element
  for (const chip of copy.querySelectorAll('.moment')) chip.remove()
  return (copy.textContent ?? '').replaceAll('\u00a0', ' ').replace(/\s+/g, ' ').trim()
    // "[0:26] — Entry" reads as "Entry" on the mark.
    .replace(/^[-–—:·]+\s*/, '')
}

/** A typed moment, just closed, at the end of the text before the caret. */
const TYPED = /\[\d{1,3}(?::[0-5]\d){1,2}\]$/

export function createEditor(placeholder: string, tape: TapeLink): Editor {
  const root = h('div', 'writing')
  root.contentEditable = 'true'
  root.spellcheck = true
  root.setAttribute('role', 'textbox')
  root.setAttribute('aria-multiline', 'true')
  root.dataset.placeholder = placeholder

  /** The nearest ancestor of the caret with this tag, inside the editor. */
  const within = (tag: string): HTMLElement | null => {
    let node: Node | null = window.getSelection()?.anchorNode ?? null
    while (node !== null && node !== root) {
      if (node instanceof HTMLElement && node.tagName === tag) return node
      node = node.parentNode
    }
    return null
  }

  const holds = (): boolean => {
    const anchor = window.getSelection()?.anchorNode
    return anchor !== null && anchor !== undefined && root.contains(anchor)
  }

  /*
   * `execCommand` is deprecated and still the only thing every browser
   * implements for this. The alternative is hand-rolled Range surgery for
   * bold, lists and block types, which is a great deal of code to arrive at
   * worse undo behaviour — the browser's own commands stay on the native undo
   * stack, and a reimplementation would not.
   */
  const exec = (command: string, value?: string): void => { document.execCommand(command, false, value) }

  /** Turn a block into `tag`, or back into a paragraph if it already is one. */
  const asBlock = (tag: string): void => {
    exec('formatBlock', within(tag) !== null ? '<p>' : `<${tag.toLowerCase()}>`)
  }

  /** Code has no command of its own, so the element is placed by hand. */
  const toggleCode = (): void => {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) return

    const existing = within('CODE')
    if (existing !== null) {
      const parent = existing.parentNode
      if (parent === null) return
      while (existing.firstChild !== null) parent.insertBefore(existing.firstChild, existing)
      parent.removeChild(existing)
      return
    }

    const range = selection.getRangeAt(0)
    if (range.collapsed) return
    const code = h('code')
    try {
      range.surroundContents(code)
    } catch {
      // Thrown when the selection starts in one element and ends in another;
      // the text is what was wanted anyway.
      code.textContent = range.toString()
      range.deleteContents()
      range.insertNode(code)
    }
    const after = document.createRange()
    after.selectNodeContents(code)
    selection.removeAllRanges()
    selection.addRange(after)
  }

  const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'
  const COMMANDS: Command[] = [
    { icon: 'bold', title: `Bold (${mod}B)`, run: () => exec('bold'), active: () => document.queryCommandState('bold') },
    { icon: 'italic', title: `Italic (${mod}I)`, run: () => exec('italic'), active: () => document.queryCommandState('italic') },
    { icon: 'code', title: 'Code', run: toggleCode, active: () => within('CODE') !== null },
    { icon: 'heading', title: 'Heading (## )', run: () => asBlock('H4'), active: () => within('H4') !== null, group: true },
    { icon: 'list', title: 'Bulleted list (- )', run: () => exec('insertUnorderedList'), active: () => within('UL') !== null },
    { icon: 'list-ordered', title: 'Numbered list (1. )', run: () => exec('insertOrderedList'), active: () => within('OL') !== null },
    { icon: 'quote', title: 'Quote (> )', run: () => asBlock('BLOCKQUOTE'), active: () => within('BLOCKQUOTE') !== null },
  ]

  const toolbar = h('div', 'toolbar')
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Formatting')
  const buttons = COMMANDS.map((command) => {
    const button = h('button', 'tool' + (command.group ? ' group' : '')) as HTMLButtonElement
    button.type = 'button'
    button.dataset.tip = command.title
    button.setAttribute('aria-label', command.title)
    button.append(icon(command.icon))
    // Without this the button takes focus on the way down, the selection is
    // gone before the click lands, and the editor blurs into a save.
    button.addEventListener('mousedown', (event) => { event.preventDefault() })
    button.addEventListener('click', () => {
      root.focus()
      command.run()
      refresh()
    })
    toolbar.append(button)
    return button
  })

  // The tape's time at the caret — or, with no caret in the note, as a line of its own.
  const stamp = h('button', 'tool group') as HTMLButtonElement
  stamp.type = 'button'
  stamp.dataset.tip = 'Insert the tape’s time'
  stamp.setAttribute('aria-label', 'Insert the tape’s time')
  stamp.append(icon('clock'))
  stamp.hidden = true
  stamp.addEventListener('mousedown', (event) => { event.preventDefault() })
  stamp.addEventListener('click', () => {
    const seconds = tape.now()
    if (seconds === null) return
    if (holds()) atCaret(momentChip(seconds), true)
    else addMoment(seconds, true)
    changed()
  })
  toolbar.append(stamp)

  const refresh = (): void => {
    root.classList.toggle('vacant', readBlocks(root).length === 0)
    if (!holds()) return
    buttons.forEach((button, index) => {
      const on = COMMANDS[index]!.active()
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', String(on))
    })
  }

  /*
   * The toolbar follows the caret, which only `selectionchange` reports — it
   * is a document-level event, so it takes itself off again once the panel
   * this editor belonged to has been replaced.
   */
  const onSelectionChange = (): void => {
    if (!root.isConnected) { document.removeEventListener('selectionchange', onSelectionChange); return }
    if (holds()) refresh()
  }
  document.addEventListener('selectionchange', onSelectionChange)

  /*
   * Markup pasted from a chart site or a broker's page would be flattened by
   * `readBlocks` on the next save anyway; taking it as text means what you see
   * the moment you paste is already what will be kept.
   */
  root.addEventListener('paste', (event) => {
    event.preventDefault()
    exec('insertText', event.clipboardData?.getData('text/plain') ?? '')
  })
  root.addEventListener('drop', (event) => { event.preventDefault() })

  root.addEventListener('input', (event) => {
    if (event instanceof InputEvent && event.inputType === 'insertText' && event.data === ']') typed()
    refresh()
    changed()
  })

  // A moment in the note plays the tape from there. Pressing one is not
  // putting the caret there: the focus stays where it was, in the note or out
  // of it, so the keys that were driving the tape still drive it.
  root.addEventListener('mousedown', (event) => {
    if (event.target instanceof Element && event.target.closest('.moment') !== null) event.preventDefault()
  })
  root.addEventListener('click', (event) => {
    const chip = event.target instanceof Element ? event.target.closest('.moment') : null
    const seconds = chip === null ? null : secondsAt(chip)
    if (seconds !== null) tape.seek(seconds)
  })

  // ── moments ────────────────────────────────────────────────────────────────

  const changed = (): void => { tape.changed() }

  /** Every moment chip in the note, in the order they are written. */
  const chips = (): { chip: HTMLElement; seconds: number }[] =>
    [...root.querySelectorAll<HTMLElement>('.moment')].flatMap((chip) => {
      const seconds = secondsAt(chip)
      return seconds === null ? [] : [{ chip, seconds }]
    })

  /** The list items that open with a moment: the lines a marked tape writes. */
  function momentLines(): { item: HTMLElement; seconds: number }[] {
    const lines: { item: HTMLElement; seconds: number }[] = []
    for (const item of root.querySelectorAll<HTMLElement>('li')) {
      const lead = [...item.childNodes].find((child) =>
        child.nodeType !== Node.TEXT_NODE || (child.textContent ?? '').trim() !== '')
      const seconds = lead === undefined ? null : secondsAt(lead)
      if (seconds !== null) lines.push({ item, seconds })
    }
    return lines
  }

  /**
   * Put the caret at the end of a line, and bring it into view if it is not —
   * by as little as it takes, so the tape above stays where it was on the
   * screen as far as it can.
   */
  function caretAtEnd(line: HTMLElement): void {
    root.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(line)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    line.scrollIntoView({ block: 'nearest' })
  }

  /** Put a chip where the caret is, with the caret after it. */
  function atCaret(chip: HTMLElement, spaced: boolean): void {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    // The space after it is somewhere for the caret to stand: a caret beside
    // an element it cannot enter has nowhere to go at the end of a line.
    const after = document.createTextNode(spaced ? '\u00a0' : '\u200b')
    range.insertNode(after)
    range.insertNode(chip)
    const caret = document.createRange()
    caret.setStart(after, after.length)
    caret.collapse(true)
    selection.removeAllRanges()
    selection.addRange(caret)
  }

  /** `[0:26]` typed out turns into a moment on the closing bracket, as it would read on the next load. */
  function typed(): void {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    const text = range.startContainer
    if (!range.collapsed || text.nodeType !== Node.TEXT_NODE || text.parentElement?.closest('code')) return
    const before = (text.textContent ?? '').slice(0, range.startOffset)
    const match = TYPED.exec(before)
    const [run] = match === null ? [] : parseInlines(match[0])
    if (match === null || run?.kind !== 'moment') return
    const written = document.createRange()
    written.setStart(text, range.startOffset - match[0].length)
    written.setEnd(text, range.startOffset)
    selection.removeAllRanges()
    selection.addRange(written)
    atCaret(momentChip(run.seconds), false)
  }

  function addMoment(at: number, caret: boolean): void {
    const seconds = Math.floor(at)
    const lines = momentLines()
    const same = lines.find((line) => line.seconds === seconds)
    if (same !== undefined) {
      if (caret) {
        // Somewhere to write on from what the line already says, a space on
        // from it — and never flush against the time. A line's end space is
        // not kept, so looking and leaving is still not an edit.
        if (same.item.lastChild instanceof HTMLBRElement) same.item.lastChild.remove()
        if (!/\s$/.test((same.item.textContent ?? '').replaceAll('\u00a0', ' '))) same.item.append('\u00a0')
        caretAtEnd(same.item)
      }
      // Its mark on the tape answers, the same as a new one would.
      changed()
      return
    }
    const item = h('li')
    item.append(momentChip(seconds), '\u00a0')
    const later = lines.find((line) => line.seconds > seconds)
    if (later !== undefined) later.item.before(item)
    else if (lines.length > 0) lines[lines.length - 1]!.item.after(item)
    else {
      // The first moment starts a list at the end of the note — in place of
      // the empty paragraph a blank note holds for the caret.
      const list = h('ul')
      list.append(item)
      if (readBlocks(root).length === 0) root.replaceChildren(list)
      else root.append(list)
    }
    refresh()
    changed()
    if (caret) caretAtEnd(item)
  }

  const node = h('div', 'editor')
  node.append(toolbar, root)

  return {
    node,
    value: () => toMarkdown(readBlocks(root)),
    set(text) {
      writeBlocks(parseNote(text), root)
      refresh()
      changed()
    },
    focus: () => { root.focus() },
    addMoment,

    moments: () => chips().map(({ chip, seconds }) => {
      const line = chip.closest('li, p, h4, blockquote')
      return { seconds, label: line !== null && root.contains(line) ? wordsOf(line) : '' }
    }),

    light(at) {
      // Every mention of the latest moment reached, since a note may name one twice.
      const all = chips()
      const lit = at === null ? -1 : Math.max(-1, ...all.map((c) => c.seconds).filter((s) => s <= at + 0.25))
      for (const { chip, seconds } of all) chip.classList.toggle('now', seconds === lit)
    },

    tapeReady(ready) { stamp.hidden = !ready },
  }
}
