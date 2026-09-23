/**
 * One trade, opened up — and the place you write about it.
 *
 * The table answers "what happened"; this answers "what happened, exactly, and
 * what did I think of it". It holds the facts the table has no room for — each
 * exit with the level that fired it and how far off the fill was, a stop shown
 * as it was placed *and* as it ended — and beside them the margin: your grade,
 * your tags and your note.
 *
 * Nothing here has a save button. A grade or a tag is a click, and the click
 * is the save. The note saves when you leave it. There is no state in which
 * you would want to press anything else — you are either reading a trade or
 * writing it up, and stepping away from it means you are done.
 *
 * This draws one panel and knows nothing about where it is shown; `tabs.ts`
 * gives each open trade its own tab and asks here for the panel to put in it.
 */

import { h } from './dom.ts'
import type { Format } from './format.ts'
import type { ExitFill, Level, Trade } from './journal.ts'
import type { Margin, Note, Written } from './margin.ts'
import { isBlank } from './margin.ts'
import { createEditor } from './editor.ts'
import type { Kind, Vocabulary } from './tags.ts'
import { GRADES, GRADE_GUIDE, KINDS, toggled } from './tags.ts'
import { closedAt, endedAs, exitPrice, returnOf } from './view.ts'

const ENDED: Record<string, string> = { manual: 'By hand', stop: 'Stop', target: 'Target' }

const PROMPT = 'What did you see, why did you take it, and what would you do again?'

/** Prices are decimals; a fill that landed on its level lands on it exactly. */
const SAME = 1e-9

export interface Panel {
  /** The panel itself, focusable so the arrow keys and Escape have a home. */
  node: HTMLElement
  /**
   * Wait for a save still in the air, if there is one.
   *
   * Taking the panel off the page fires no `blur` on a focused editor — so
   * anything that takes it away waits for the write to land first. A refused
   * one answers false once, with the reason on the screen; ask again and it
   * lets you go.
   */
  settled: () => Promise<boolean>
  /** Redraw the grade and the chips, after the vocabulary changed under them. */
  refresh: () => void
}

/** What the panel needs from whoever is showing it. */
export interface Place {
  /** Where this trade sits in the table's order, and how long that order is. */
  index: number
  count: number
  /** Move this panel's tab to the next trade in that order; false if there is none that way. */
  step: (by: number) => void
  /** Take the panel off the page. */
  close: () => void
}

/** The shared pieces every panel is drawn with. */
export interface Drawing {
  format: Format
  margin: Margin
  vocabulary: Vocabulary
  /** Called after a write, so the table can mark the row. */
  saved: (positionId: string) => void
}

/** One trade drawn out in full, with the margin beside it. */
export function drawTrade(trade: Trade, place: Place, drawing: Drawing): Panel {
  const { format, margin, vocabulary, saved } = drawing
  const { clock, day, dateOf, duration, justNow, price, signed, time, tone, when, wrote } = format

  const panel = h('section', 'trade')
  panel.tabIndex = -1
  panel.setAttribute('aria-label', 'Trade')

  let inFlight: Promise<boolean> | null = null

  async function settled(): Promise<boolean> {
    const pending = inFlight
    inFlight = null
    return pending === null ? true : pending
  }

  let refresh = (): void => {}

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

  /**
   * The four prices. Everything else the old list carried — when, how long,
   * how many lots, how it ended, the result — is in the header already, once.
   */
  function facts(trade: Trade): HTMLElement {
    const grid = h('div', 'facts')
    const fact = (label: string, value: string, className = '', note?: string): void => {
      const cell = h('div', 'fact')
      cell.append(h('span', 'fact-label', label), h('span', 'fact-value ' + className, value))
      if (note !== undefined) cell.append(h('span', 'fact-note', note))
      grid.append(cell)
    }
    fact('Entry', price.format(trade.entry.price))

    // A single exit at a level says here how far the fill landed from it;
    // several exits get the list below instead.
    const only = trade.exits.length === 1 ? trade.exits[0]! : null
    let slip: string | undefined
    if (only !== null && only.reason.kind !== 'manual') {
      const better = (only.price - only.reason.price) * (trade.side === 'buy' ? 1 : -1)
      if (Math.abs(better) > SAME) slip = price.format(Math.abs(better)) + (better > 0 ? ' better than the level' : ' past the level')
    }
    fact('Exit', price.format(exitPrice(trade)) + (trade.exits.length > 1 ? ' avg' : ''), '', slip)

    const naked = trade.stop.final === null && trade.stop.initial === null
    fact('Stop', levelText(trade.stop), naked ? 'warn' : '')
    fact('Target', levelText(trade.target))
    return grid
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

    /** A click on a grade or a tag is the save; the tab waits for it before moving on. */
    const change = (written: Written): void => { inFlight = persist(written) }

    section.append(status)

    /**
     * Each kind of thing you can mark is one row: its name down the left and
     * the choices beside it. The question it answers and how to tell it from
     * the others are a hover away here, and written out in full in the Tags
     * dialog, which is where the words are kept.
     */
    const group = (title: string, asks: string, means: string): HTMLElement => {
      const row = h('div', 'mark')
      const label = h('span', 'mark-label', title)
      label.title = asks + ' ' + means
      row.append(label)
      return row
    }

    const redraws: (() => void)[] = []
    const redraw = (): void => { for (const draw of redraws) draw() }
    refresh = redraw

    // Grade: three letters, one lit. The lit one clicked again clears it.
    const grading = group(GRADE_GUIDE.title, GRADE_GUIDE.asks, GRADE_GUIDE.means)
    const letters = h('div', 'grades chips')
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
    const strays = h('div', 'mark strays')
    const strayChips = h('div', 'chips')
    const strayLabel = h('span', 'mark-label', 'Unknown')
    strayLabel.title = 'Tags this trade carries that are not in your vocabulary. Click one to take it off.'
    strays.append(strayLabel, strayChips)
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
      const add = h('button', 'chip add', '+') as HTMLButtonElement
      add.type = 'button'
      add.title = 'A new word for this kind'
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

  // ── the tape ─────────────────────────────────────────────────────────────

  /**
   * The clips recorded against this trade, streamed from the record, and the
   * way a new one gets in.
   *
   * Asked for as the panel is drawn, not as the page loads: a trade you never
   * open never costs a request, and a signed URL outlives any tab. The player
   * fetches only what it plays, enough to learn the length and then the
   * stretches you watch or scrub to, so a long recording opens at once and
   * is never downloaded whole.
   *
   * Adding one is a single request carrying the whole file, narrated on the
   * status line as it goes, because a long recording on a home uplink takes
   * minutes. It is not waited for the way a save is: closing the tab or
   * stepping to the next trade stops showing it, not sending it, and the
   * clip is there the next time this trade is opened.
   */
  function tape(trade: Trade): HTMLElement {
    const section = h('section', 'tape')
    const reel = h('div', 'reel')
    const foot = h('div', 'tape-foot')
    const status = h('span', 'saved')

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/mp4'
    input.hidden = true
    const add = h('button', 'quiet add-clip', '+ Add clip') as HTMLButtonElement
    add.type = 'button'
    add.title = 'An MP4 of this trade, from your recording'
    add.addEventListener('click', () => input.click())

    const failed = (error: unknown): void => {
      status.className = 'saved failed'
      status.textContent = error instanceof Error ? error.message : String(error)
    }

    /** Draw every clip the folder holds now. */
    async function fill(): Promise<void> {
      const clips = await margin.clips(trade.positionId)
      reel.replaceChildren(...clips.map((clip) => {
        const figure = h('figure', 'clip')
        const video = document.createElement('video')
        video.controls = true
        video.preload = 'metadata'
        video.src = clip.url
        figure.append(video, h('figcaption', '', clip.name))
        return figure
      }))
    }

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      // Cleared so the same file, picked again after a refusal, counts as a pick.
      input.value = ''
      if (file === undefined) return
      add.disabled = true
      status.className = 'saved working'
      status.textContent = 'Uploading…'
      margin.addClip(trade.positionId, file, (fraction) => {
        status.textContent = `Uploading… ${Math.floor(fraction * 100)}%`
      })
        .then(fill)
        .then(() => {
          status.className = 'saved'
          status.textContent = 'Added ' + file.name
        })
        .catch(failed)
        .finally(() => { add.disabled = false })
    })

    fill().catch(failed)
    foot.append(add, status, input)
    section.append(reel, foot)
    return section
  }

  // ── the panel ────────────────────────────────────────────────────────────

  const net = returnOf(trade)

  const title = h('h2', 'trade-title')
  title.append(trade.symbol, h('span', 'side', trade.side))
  if (trade.tag !== null) title.append(h('span', 'tag', trade.tag))

  const opened = trade.entry.time, closed = closedAt(trade)
  const span = dateOf(opened) === dateOf(closed)
    ? day(opened) + ' · ' + time(opened) + ' – ' + time(closed)
    : when(opened) + ' – ' + when(closed)
  const heading = h('div')
  heading.append(title, h('p', 'trade-sub', [
    span,
    duration(closed.getTime() - opened.getTime()),
    trade.entry.volume + ' lots',
    ENDED[endedAs(trade)]?.toLowerCase(),
  ].join(' · ')))

  const nav = h('nav', 'trade-nav')
  const move = (label: string, by: number, hint: string): HTMLElement => {
    const button = h('button', 'quiet', label) as HTMLButtonElement
    button.title = hint
    button.type = 'button'
    button.disabled = place.index + by < 0 || place.index + by >= place.count
    button.addEventListener('click', () => place.step(by))
    return button
  }
  nav.append(
    move('←', -1, 'Newer trade'),
    h('span', 'trade-count', place.index + 1 + ' / ' + place.count),
    move('→', 1, 'Older trade'))

  // One figure, net of costs: what the trade did to the account.
  const result = h('div', 'trade-result')
  result.append(h('div', 'trade-net ' + tone(net), signed(net)))
  const identity = h('div', 'trade-id')
  identity.append(heading, result)
  const header = h('header', 'trade-head')
  header.append(nav, identity)

  const record = h('div', 'trade-record')
  record.append(facts(trade))
  // Only a trade closed in pieces needs each piece listed; one exit is the
  // Exit figure above.
  if (trade.exits.length > 1) {
    const exits = h('div', 'exits')
    exits.append(h('h3', '', 'Closed in ' + trade.exits.length + ' pieces'))
    const list = h('ul', 'exit-list')
    for (const exit of trade.exits) list.append(exitRow(exit, trade))
    exits.append(list)
    record.append(exits)
  }
  // The broker's side, then the tape, then yours.
  panel.append(header, record, tape(trade), margins(trade))

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { place.close(); return }
    const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement
    if (typing) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); place.step(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); place.step(1) }
  })

  return { node: panel, settled, refresh: () => refresh() }
}
