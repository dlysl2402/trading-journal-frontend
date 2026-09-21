/**
 * One trade, opened up — and the place you write about it.
 *
 * The table answers "what happened"; this answers "what happened, exactly, and
 * what did I think of it". It holds the facts the table has no room for — each
 * exit with the level that fired it and how far off the fill was, a stop shown
 * as it was placed *and* as it ended — and under them the margin: your tags
 * and your note.
 *
 * Both fields work the same way: what you wrote is shown, you click it to
 * edit, and leaving it saves. There is no save button because there is no
 * state in which you would want one — you are either reading the note or
 * writing it, and stepping away from it means you are done.
 */

import { h, must } from './dom.ts'
import type { Format } from './format.ts'
import type { ExitFill, Level, Trade } from './journal.ts'
import type { Margin, Note } from './margin.ts'
import { isBlank } from './margin.ts'
import { createEditor } from './editor.ts'
import { formatTags, parseTags } from './notes.ts'
import { closedAt, costsOf, endedAs, exitPrice, netOf } from './view.ts'

const ENDED: Record<string, string> = { manual: 'By hand', stop: 'Stop', target: 'Target' }

const PROMPT = 'What did you see, why did you take it, and what would you do again?'

/** Prices are decimals; a fill that landed on its level lands on it exactly. */
const SAME = 1e-9

interface Drawer {
  /** Show a trade, by the position id the table keyed its row by. */
  open: (positionId: string) => void
}

/**
 * @param trades in the order the table shows them, so stepping forward in the
 *   drawer goes the same way as reading down the page.
 * @param saved called after a write, so the table can mark the row.
 */
export function createDrawer(
  trades: Trade[], format: Format, margin: Margin, saved: (positionId: string) => void,
): Drawer {
  const backdrop = must('drawer-backdrop')
  const panel = must('drawer')
  const inner = must('drawer-inner')

  const { clock, duration, justNow, price, signed, tone, when, wrote } = format

  /** The row that opened the drawer, so closing it puts focus back. */
  let opener: Element | null = null
  let at = -1

  /**
   * A save still in the air, if there is one.
   *
   * Stepping to the next trade replaces the panel, and removing a focused
   * textarea from the page fires no `blur` — so anything that takes the drawer
   * away waits for the write to land first. A refused one holds you on the
   * trade once, with the reason on the screen; press again and it lets you go.
   */
  let inFlight: Promise<boolean> | null = null

  async function settled(): Promise<boolean> {
    const pending = inFlight
    inFlight = null
    return pending === null ? true : pending
  }

  async function close(): Promise<void> {
    if (!(await settled())) return
    panel.hidden = backdrop.hidden = true
    document.body.classList.remove('locked')
    at = -1
    if (opener instanceof HTMLElement) opener.focus()
    opener = null
  }

  async function step(by: number): Promise<void> {
    if (!(await settled())) return
    const next = at + by
    if (next >= 0 && next < trades.length) show(next)
  }

  function show(index: number): void {
    at = index
    const trade = trades[index]
    if (trade === undefined) return
    // Rebuilt rather than refilled, so the body of the next trade starts at
    // the top instead of wherever the last one was left scrolled to.
    inner.replaceChildren(...draw(trade, index))
    panel.focus()
  }

  // ── the facts ────────────────────────────────────────────────────────────

  /**
   * A stop or a target across the life of the trade.
   *
   * Shown as both ends when they differ, because that is the whole reason
   * `journal.ts` keeps them apart: a stop trailed to breakeven and a stop
   * placed at breakeven are the same number and completely different trades.
   */
  function levelText(level: Level): string {
    if (level.initial === null && level.final === null) return 'none'
    if (level.initial === null) return price.format(level.final!) + ' · set after entry'
    if (level.final === null) return price.format(level.initial) + ' · taken off'
    if (Math.abs(level.initial - level.final) < SAME) return price.format(level.final)
    return price.format(level.initial) + ' → ' + price.format(level.final)
  }

  /** Why an exit fired, and how far the fill landed from the level that fired it. */
  function exitRow(exit: ExitFill, trade: Trade): HTMLElement {
    const row = h('li')
    row.append(
      h('span', 'exit-at', clock(exit.time)),
      h('span', 'exit-lots', exit.volume + ' @ ' + price.format(exit.price)))

    if (exit.reason.kind === 'manual') {
      row.append(h('span', 'exit-why', 'by hand'))
      return row
    }

    const level = exit.reason.price
    row.append(h('span', 'exit-why',
      (exit.reason.kind === 'stop' ? 'stop ' : 'target ') + price.format(level)))

    // A long exits by selling, so a fill below its level is the worse one; a
    // short exits by buying, and the sign turns over.
    const better = (exit.price - level) * (trade.side === 'buy' ? 1 : -1)
    if (Math.abs(better) > SAME) {
      const gap = price.format(Math.abs(better))
      row.append(h('span', 'exit-slip ' + (better > 0 ? 'up' : 'down'),
        better > 0 ? gap + ' better' : gap + ' past it'))
    }
    return row
  }

  function facts(trade: Trade): HTMLElement {
    const net = netOf(trade)
    const held = closedAt(trade).getTime() - trade.entry.time.getTime()

    const list = h('dl', 'facts')
    const add = (label: string, value: string, className = ''): void => {
      list.append(h('dt', '', label), h('dd', className, value))
    }
    add('Opened', when(trade.entry.time))
    add('Closed', when(closedAt(trade)))
    add('Held', duration(held))
    add('Lots', String(trade.entry.volume))
    add('Entry', price.format(trade.entry.price))
    add('Exit', price.format(exitPrice(trade)) + (trade.exits.length > 1 ? ' avg' : ''))
    add('Stop', levelText(trade.stop), trade.stop.final === null && trade.stop.initial === null ? 'warn' : '')
    add('Target', levelText(trade.target))
    add('Ended', ENDED[endedAs(trade)] ?? '—')
    add('Gross', signed(trade.grossProfit))
    add('Costs', signed(costsOf(trade)))
    add('Net', signed(net), 'strong ' + tone(net))
    return list
  }

  // ── the margin ───────────────────────────────────────────────────────────


  function margins(trade: Trade): HTMLElement {
    const section = h('section', 'margin')
    const status = h('span', 'saved')
    const note = (): Note => margin.get(trade.positionId)

    /**
     * One write of this trade's margin, narrated on the status line.
     *
     * Both fields live in the same row, so either one saves both columns —
     * which is why each reads the other's current value rather than trusting
     * what is on the screen next to it.
     */
    async function persist(text: string, tags: string[]): Promise<boolean> {
      status.className = 'saved working'
      status.textContent = 'Saving…'
      try {
        await margin.save(trade.positionId, text, tags)
        saved(trade.positionId)
        status.className = 'saved'
        status.textContent = 'Saved ' + justNow(new Date())
        return true
      } catch (error) {
        status.className = 'saved failed'
        status.textContent = error instanceof Error ? error.message : String(error)
        return false
      }
    }

    const head = h('div', 'margin-head')
    head.append(h('h3', '', 'Your tags'), status)
    section.append(head)

    // Tags: chips you click to edit as a line, because that is what they are.
    const chips = h('div', 'chips')
    const chipInput = document.createElement('input')
    chipInput.type = 'text'
    chipInput.className = 'tag-input'
    chipInput.placeholder = 'breakout, too early, news'
    chipInput.hidden = true
    const drawChips = (): void => {
      const tags = note().tags
      chips.replaceChildren(...tags.length > 0
        ? tags.map((tag) => h('span', 'chip', tag))
        : [h('span', 'chip-empty', 'Add tags')])
    }

    /*
     * Tags are the one field with two states worth having: chips to read, a
     * line of text to write. The note has no equivalent — its editor draws the
     * formatting live, so reading and writing it look the same.
     */
    const showChips = (): void => { chipInput.hidden = true; chips.hidden = false; drawChips() }
    const editTags = (): void => {
      chipInput.value = formatTags(note().tags)
      chips.hidden = true
      chipInput.hidden = false
      chipInput.focus()
    }

    let savingTags = false
    async function commitTags(): Promise<boolean> {
      if (savingTags) return true
      if (chipInput.value === formatTags(note().tags)) { showChips(); return true }
      savingTags = true
      try {
        // A refused write leaves the line open with the words in it; the
        // status beside it says why.
        const ok = await persist(note().text, parseTags(chipInput.value))
        if (ok) showChips()
        return ok
      } finally {
        savingTags = false
      }
    }

    chips.tabIndex = 0
    chips.setAttribute('role', 'button')
    chips.addEventListener('click', editTags)
    chips.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editTags() }
    })
    chipInput.addEventListener('blur', () => { inFlight = commitTags() })
    chipInput.addEventListener('keydown', (event) => {
      // Escape belongs to the field before the drawer, so the first press puts
      // the pen down and the second closes the trade. It saves rather than
      // discards, because every other way out of the field saves and a key
      // that quietly threw the writing away would be the one exception.
      if (event.key === 'Escape') { event.stopPropagation(); chipInput.blur(); panel.focus(); return }
      if (event.key === 'Enter') { event.preventDefault(); chipInput.blur() }
    })
    section.append(chips, chipInput)

    // The note: always the editor, never a box you switch into.
    section.append(h('h3', '', 'Note'))
    const editor = createEditor(PROMPT)
    editor.set(note().text)
    section.append(editor.node)

    let writing = false
    async function commitNote(): Promise<boolean> {
      if (writing) return true
      const text = editor.value()
      // Reading a note is not editing it: the text comes back through the same
      // normalising that wrote it, so an untouched note matches exactly.
      if (text === note().text) return true
      writing = true
      try {
        return await persist(text, note().tags)
      } finally {
        writing = false
      }
    }

    editor.node.addEventListener('focusout', (event) => {
      // Moving between the toolbar and the writing is not leaving the note.
      const to = event.relatedTarget
      if (to instanceof Node && editor.node.contains(to)) return
      inFlight = commitNote()
    })
    editor.node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        panel.focus()
        return
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        panel.focus()
      }
    })

    drawChips()
    const at = note().updatedAt
    if (at !== null && !isBlank(note())) status.textContent = 'Saved ' + wrote(at)
    return section
  }


  // ── the panel ────────────────────────────────────────────────────────────

  function draw(trade: Trade, index: number): HTMLElement[] {
    const net = netOf(trade)

    const title = h('h2', 'drawer-title')
    title.append(trade.symbol, h('span', 'side', trade.side))
    if (trade.tag !== null) title.append(h('span', 'tag', trade.tag))

    const heading = h('div')
    heading.append(title, h('p', 'drawer-sub',
      when(closedAt(trade)) + ' · ' + trade.entry.volume + ' lots · ' +
      ENDED[endedAs(trade)]?.toLowerCase()))

    const nav = h('nav', 'drawer-nav')
    const move = (label: string, by: number, title: string): HTMLElement => {
      const button = h('button', 'quiet', label)
      button.title = title
      ;(button as HTMLButtonElement).type = 'button'
      ;(button as HTMLButtonElement).disabled = index + by < 0 || index + by >= trades.length
      button.addEventListener('click', () => { void step(by) })
      return button
    }
    nav.append(
      move('←', -1, 'Newer trade'),
      h('span', 'drawer-count', index + 1 + ' / ' + trades.length),
      move('→', 1, 'Older trade'))
    const shut = h('button', 'quiet', 'Close')
    ;(shut as HTMLButtonElement).type = 'button'
    shut.addEventListener('click', () => { void close() })
    nav.append(shut)

    const identity = h('div', 'drawer-id')
    identity.append(heading, h('div', 'drawer-net ' + tone(net), signed(net)))
    const header = h('header', 'drawer-head')
    header.append(nav, identity)

    const exits = h('div', 'exits')
    exits.append(h('h3', '', trade.exits.length > 1 ? 'Closed in ' + trade.exits.length + ' pieces' : 'Closed'))
    const list = h('ul', 'exit-list')
    for (const exit of trade.exits) list.append(exitRow(exit, trade))
    exits.append(list)

    const body = h('div', 'drawer-body')
    body.append(facts(trade), exits, margins(trade))
    return [header, body]
  }

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { void close(); return }
    const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement
    if (typing) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); void step(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); void step(1) }
  })
  backdrop.addEventListener('click', () => { void close() })

  return {
    open(positionId) {
      const index = trades.findIndex((trade) => trade.positionId === positionId)
      if (index < 0) return
      opener = document.activeElement
      panel.hidden = backdrop.hidden = false
      document.body.classList.add('locked')
      show(index)
    },
  }
}
