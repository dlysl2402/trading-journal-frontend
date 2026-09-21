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
 * shape `notes.ts` can describe: five kinds of run, four kinds of block.
 * Anything pasted in is reduced to that on the way through, which is why paste
 * is taken as plain text rather than as whatever markup came with it.
 *
 * The translating itself lives in `prose.ts`. What is left here is only the
 * surface: a toolbar, the caret, and the browser's own editing commands.
 */

import { h } from './dom.ts'
import { parseNote, toMarkdown } from './notes.ts'
import { readBlocks, writeBlocks } from './prose.ts'

// ── the surface ─────────────────────────────────────────────────────────────

interface Editor {
  /** The toolbar and the writing surface together. */
  node: HTMLElement
  /** The note as the text the record keeps. */
  value: () => string
  /** Draw a note into it, replacing whatever is there. */
  set: (text: string) => void
  focus: () => void
}

interface Command {
  label: string
  title: string
  run: () => void
  active: () => boolean
}

export function createEditor(placeholder: string): Editor {
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

  const COMMANDS: Command[] = [
    { label: 'B', title: 'Bold  ⌘B', run: () => exec('bold'), active: () => document.queryCommandState('bold') },
    { label: 'I', title: 'Italic  ⌘I', run: () => exec('italic'), active: () => document.queryCommandState('italic') },
    { label: '</>', title: 'Code', run: toggleCode, active: () => within('CODE') !== null },
    { label: 'H', title: 'Heading', run: () => asBlock('H4'), active: () => within('H4') !== null },
    { label: '•', title: 'Bulleted list', run: () => exec('insertUnorderedList'), active: () => within('UL') !== null },
    { label: '1.', title: 'Numbered list', run: () => exec('insertOrderedList'), active: () => within('OL') !== null },
    { label: '“', title: 'Quote', run: () => asBlock('BLOCKQUOTE'), active: () => within('BLOCKQUOTE') !== null },
  ]

  const toolbar = h('div', 'toolbar')
  const buttons = COMMANDS.map((command) => {
    const button = h('button', 'tool', command.label) as HTMLButtonElement
    button.type = 'button'
    button.title = command.title
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

  const refresh = (): void => {
    root.classList.toggle('vacant', readBlocks(root).length === 0)
    if (!holds()) return
    buttons.forEach((button, index) => {
      button.classList.toggle('on', COMMANDS[index]!.active())
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

  root.addEventListener('input', refresh)

  const node = h('div', 'editor')
  node.append(toolbar, root)

  return {
    node,
    value: () => toMarkdown(readBlocks(root)),
    set(text) {
      writeBlocks(parseNote(text), root)
      refresh()
    },
    focus: () => { root.focus() },
  }
}
