/**
 * One trade, opened up — and the place you write about it.
 *
 * The table answers "what happened"; this answers "what happened, exactly, and
 * what did I think of it". It holds the facts the table has no room for — each
 * exit with the level that fired it and how far off the fill was, a stop shown
 * as it was placed *and* as it ended — and under them the margin: your grade,
 * your tags and your note.
 *
 * Nothing here has a save button. A grade or a tag is a click, and the click
 * is the save. The note saves when you leave it. There is no state in which
 * you would want to press anything else — you are either reading a trade or
 * writing it up, and stepping away from it means you are done.
 */

import { h, must } from './dom.ts'
import type { Format } from './format.ts'
import type { ExitFill, Level, Trade } from './journal.ts'
import type { Margin, Note, Written } from './margin.ts'
import { isBlank } from './margin.ts'
import { createEditor } from './editor.ts'
import type { Kind, Vocabulary } from './tags.ts'
import { GRADES, GRADE_GUIDE, KINDS, toggled } from './tags.ts'
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
  trades: Trade[], format: Format, margin: Margin, vocabulary: Vocabulary,
  saved: (positionId: string) => void,
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
     * Every field lives in the same row, so a change to any one of them writes
     * all of them — which is why each change starts from the note as it stands
     * rather than from what is on the screen next to it.
     */
    async function persist(written: Written): Promise<boolean> {
      status.className = 'saved working'
      status.textContent = 'Saving…'
      try {
        await margin.save(trade.positionId, written)
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

    /** A click on a grade or a tag is the save; the drawer waits for it before moving on. */
    const change = (written: Written): void => { inFlight = persist(written) }

    const head = h('div', 'margin-head')
    head.append(h('h3', '', 'Your read of it'), status)
    section.append(head)

    /**
     * Each kind of thing you can mark is drawn the same way: a title, the
     * question it answers, and — always on the page, not in a tooltip — how to
     * tell it from the others. The words are what keep "context" meaning the
     * same thing next month as it does today.
     */
    const group = (title: string, asks: string, means: string): HTMLElement => {
      const box = h('div', 'pick')
      const label = h('div', 'pick-head')
      label.append(h('h4', '', title), h('span', 'pick-asks', asks))
      box.append(label, h('p', 'pick-means', means))
      return box
    }

    const redraws: (() => void)[] = []
    const redraw = (): void => { for (const draw of redraws) draw() }

    // Grade: three letters, one lit. The lit one clicked again clears it.
    const grading = group(GRADE_GUIDE.title, GRADE_GUIDE.asks, GRADE_GUIDE.means)
    const letters = h('div', 'grades')
    for (const grade of GRADES) {
      const button = h('button', 'grade', grade) as HTMLButtonElement
      button.type = 'button'
      button.addEventListener('click', () => {
        const current = note()
        change({ ...current, grade: current.grade === grade ? null : grade })
        redraw()
      })
      redraws.push(() => button.classList.toggle('on', note().grade === grade))
      letters.append(button)
    }
    grading.append(letters)
    section.append(grading)

    // Tags: every word in the vocabulary, by kind, lit when the trade carries it.
    for (const guide of KINDS) {
      const box = group(guide.title, guide.asks, guide.means)
      const chips = h('div', 'chips')
      const drawChips = (): void => {
        const carried = note().tags
        chips.replaceChildren()
        for (const tag of vocabulary.of(guide.kind)) {
          const chip = h('button', 'chip', tag.label) as HTMLButtonElement
          chip.type = 'button'
          if (tag.description) chip.title = tag.description
          chip.classList.toggle('on', carried.includes(tag.slug))
          chip.addEventListener('click', () => {
            const current = note()
            change({ ...current, tags: toggled(current.tags, tag, vocabulary.kindOf) })
            redraw()
          })
          chips.append(chip)
        }
        chips.append(adder(guide.kind, chips))
      }
      redraws.push(drawChips)
      box.append(chips)
      section.append(box)
    }

    /*
     * A tag the trade carries that the vocabulary no longer names — typed in
     * before there was a vocabulary, or removed by hand in a SQL client. Shown
     * so it is not silently lost, and a click takes it off.
     */
    const strays = h('div', 'pick strays')
    const strayChips = h('div', 'chips')
    strays.append(h('p', 'pick-means', 'Not in your vocabulary. Click one to take it off the trade.'), strayChips)
    redraws.push(() => {
      const unknown = note().tags.filter((slug) => vocabulary.get(slug) === undefined)
      strays.hidden = unknown.length === 0
      strayChips.replaceChildren(...unknown.map((slug) => {
        const chip = h('button', 'chip stray on', slug) as HTMLButtonElement
        chip.type = 'button'
        chip.addEventListener('click', () => {
          const current = note()
          change({ ...current, tags: current.tags.filter((other) => other !== slug) })
          redraw()
        })
        return chip
      }))
    })
    section.append(strays)

    /**
     * The way a new word gets into the vocabulary without leaving the trade: a
     * dashed chip that turns into a line to type on. Enter or leaving it
     * creates the tag and puts it on this trade; Escape puts the chip back.
     */
    function adder(kind: Kind, chips: HTMLElement): HTMLElement {
      const add = h('button', 'chip add', '+ new') as HTMLButtonElement
      add.type = 'button'
      add.addEventListener('click', () => {
        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'chip-input'
        input.placeholder = 'Name it'
        let done = false
        const finish = async (create: boolean): Promise<boolean> => {
          if (done) return true
          done = true
          const label = input.value.trim()
          if (!create || label === '') { redraw(); return true }
          try {
            const tag = await vocabulary.add(kind, label)
            const current = note()
            return await persist({ ...current, tags: toggled(current.tags, tag, vocabulary.kindOf) })
          } catch (error) {
            status.className = 'saved failed'
            status.textContent = error instanceof Error ? error.message : String(error)
            return false
          } finally {
            redraw()
          }
        }
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); inFlight = finish(true) }
          if (event.key === 'Escape') { event.stopPropagation(); void finish(false); panel.focus() }
        })
        input.addEventListener('blur', () => { inFlight = finish(true) })
        add.replaceWith(input)
        input.focus()
      })
      return add
    }

    // The note: always the editor, never a box you switch into.
    section.append(h('h3', 'note-head', 'Note'))
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
        return await persist({ ...note(), text })
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

    redraw()
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
