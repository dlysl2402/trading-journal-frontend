/**
 * One trade, opened up — and the place you write about it.
 *
 * The list answers "what happened"; this answers "what happened, exactly, and
 * what did I think of it". It holds the facts the list has no room for — the
 * plan drawn against the outcome, each exit with the level that fired it and
 * how far off the fill was, a stop shown as it was placed *and* as it ended —
 * and beside them the margin: your grade, your tags and your note.
 *
 * Two columns on a wide screen, the broker's side on the left and yours on the
 * right, so the trade stays in view while you write about it; one column, the
 * same order, on a narrow one.
 *
 * Nothing here has a save button you have to press. A grade or a tag is a
 * click, and the click is the save. The note saves when you leave it, and the
 * button under it is there for saving without leaving, and for being sure.
 *
 * This draws one panel and knows nothing about where it is shown; `tabs.ts`
 * gives each open trade its own tab and asks here for the panel to put in it.
 */

import { h } from './dom.ts'
import type { Format } from './format.ts'
import { CLOSED_BY, CLOSED_HOW } from './format.ts'
import { icon } from './icons.ts'
import type { ExitFill, Level, Trade } from './journal.ts'
import type { Margin, Note, Written } from './margin.ts'
import { isBlank } from './margin.ts'
import { createEditor } from './editor.ts'
import type { Kind, Vocabulary } from './tags.ts'
import { GRADES, GRADE_GUIDE, KINDS, toggled } from './tags.ts'
import { tipMark } from './tips.ts'
import { closedAt, endedAs, exitPrice, inFavour, multipleOf, plannedRatio, returnOf } from './view.ts'

const PROMPT = 'What did you see, why did you take it, and what would you do again?'

/** Prices are decimals; a fill that landed on its level lands on it exactly. */
const SAME = 1e-9

/** The modifier key the keyboard hints name. */
const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'

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
  /** Where this trade sits in the list's order, and how long that order is. */
  index: number
  count: number
  /** Move this panel's tab to the next trade in that order; nothing happens if there is none that way. */
  step: (by: number) => void
  /** Move this panel's tab to the next trade with nothing written against it. */
  next: () => void
  /** How many trades other than this one have nothing written against them. */
  unwritten: () => number
  /** Show the overview, leaving this tab open. */
  home: () => void
  /** Take the panel off the page. */
  close: () => void
}

/** The shared pieces every panel is drawn with. */
export interface Drawing {
  format: Format
  margin: Margin
  vocabulary: Vocabulary
  /** Called after a write, so the overview can mark the row. */
  saved: (positionId: string) => void
}

/** One trade drawn out in full, with the margin beside it. */
export function drawTrade(trade: Trade, place: Place, drawing: Drawing): Panel {
  const { format, margin, vocabulary, saved } = drawing
  const { clock, dateOf, duration, justNow, multiple, price, side, signed, time, tone, weekday, when, wrote } = format

  const panel = h('section', 'trade')
  panel.tabIndex = -1
  panel.setAttribute('aria-label', `${trade.symbol} ${side(trade.side).toLowerCase()}`)

  let inFlight: Promise<boolean> | null = null

  async function settled(): Promise<boolean> {
    const pending = inFlight
    inFlight = null
    return pending === null ? true : pending
  }

  let refresh = (): void => {}

  // ── the plan, and what became of it ──────────────────────────────────────

  /**
   * A stop or a target across the life of the trade.
   *
   * Shown as both ends when they differ, because that is the whole reason
   * `journal.ts` keeps them apart: a stop trailed to breakeven and a stop
   * placed at breakeven are the same number and completely different trades.
   */
  function levelText(level: Level): { value: string; note?: string } {
    if (level.initial === null && level.final === null) return { value: 'None' }
    if (level.initial === null) return { value: price.format(level.final!), note: 'set after entry' }
    if (level.final === null) return { value: price.format(level.initial), note: 'taken off' }
    if (Math.abs(level.initial - level.final) < SAME) return { value: price.format(level.final) }
    return { value: price.format(level.final), note: 'moved from ' + price.format(level.initial) }
  }

  /** How far a fill landed from the level that fired it, in the trade's favour or against it. */
  function slipOf(exit: ExitFill): { text: string; tone: string } | null {
    if (exit.reason.kind === 'manual') return null
    // A long exits by selling, so a fill below its level is the worse one; a
    // short exits by buying, and the sign turns over.
    const better = (exit.price - exit.reason.price) * (trade.side === 'buy' ? 1 : -1)
    if (Math.abs(better) <= SAME) return null
    const gap = price.format(Math.abs(better))
    return better > 0 ? { text: gap + ' better fill', tone: 'up' } : { text: gap + ' slippage', tone: 'down' }
  }

  /** Why an exit fired, and how far the fill landed from the level that fired it. */
  function exitRow(exit: ExitFill): HTMLElement {
    const row = h('li')
    row.append(
      h('span', 'exit-at', clock(exit.time)),
      h('span', 'exit-lots', exit.volume + ' lots @ ' + price.format(exit.price)))
    const why = h('span', 'closed-by')
    why.append(h('i', 'dot ' + exit.reason.kind), CLOSED_BY[exit.reason.kind] +
      (exit.reason.kind === 'manual' ? '' : ' ' + price.format(exit.reason.price)))
    row.append(why)
    const slip = slipOf(exit)
    if (slip !== null) row.append(h('span', 'exit-slip ' + slip.tone, slip.text))
    return row
  }

  /**
   * The plan as a line: the stop at one end, the target at the other, the
   * entry between them and a dot where the trade actually left. Laid out in
   * the trade's own direction — the stop always to the left — so every trade
   * reads the same way, long or short: how far along the plan did it get?
   */
  function ladder(): HTMLElement | null {
    const stop = trade.stop.initial ?? trade.stop.final
    const target = trade.target.initial ?? trade.target.final
    if (stop === null && target === null) return null

    const at = (p: number) => inFavour(trade, p)
    const out = at(exitPrice(trade))
    const marks = [0, out]
    for (const p of [stop, target, trade.stop.final, trade.target.final]) if (p !== null) marks.push(at(p))
    const lo = Math.min(...marks), hi = Math.max(...marks)
    const x = (v: number) => (hi === lo ? 50 : (v - lo) / (hi - lo) * 100)

    const root = h('div', 'ladder')
    root.setAttribute('role', 'img')
    const track = h('div', 'ladder-track')
    root.append(track)

    const span = (className: string, from: number, to: number): void => {
      const node = h('span', className)
      node.style.left = Math.min(from, to) + '%'
      node.style.width = Math.abs(to - from) + '%'
      track.append(node)
    }
    const mark = (className: string, v: number, tip?: string): void => {
      const node = h('span', 'lmark ' + className)
      node.style.left = x(v) + '%'
      if (tip !== undefined) node.dataset.tip = tip
      track.append(node)
    }
    /** A label under or over the line, turned inward near either end so it stays on the card. */
    const label = (text: string, v: number, row: 'over' | 'under', className = '', tip?: string): void => {
      const node = h('span', `llabel ${row} ${className}`)
      node.append(text)
      if (tip !== undefined) node.dataset.tip = tip
      const left = x(v)
      node.style.left = left + '%'
      node.classList.add(left < 12 ? 'start' : left > 88 ? 'end' : 'mid')
      track.append(node)
    }

    if (stop !== null && at(stop) < 0) span('zone risk', x(at(stop)), x(0))
    if (target !== null && at(target) > 0) span('zone reward', x(0), x(at(target)))
    span('run ' + tone(out), x(Math.min(0, out)), x(Math.max(0, out)))

    const moved = (level: Level): number | null =>
      level.initial !== null && level.final !== null && Math.abs(level.initial - level.final) > SAME ? level.final : null
    const stopMoved = moved(trade.stop), targetMoved = moved(trade.target)
    if (stopMoved !== null) mark('moved', at(stopMoved), 'Stop moved to ' + price.format(stopMoved))
    if (targetMoved !== null) mark('moved', at(targetMoved), 'Target moved to ' + price.format(targetMoved))
    if (stop !== null) mark('stop', at(stop), 'Stop ' + price.format(stop))
    if (target !== null) mark('target', at(target), 'Target ' + price.format(target))
    mark('entry', 0, 'Entry ' + price.format(trade.entry.price))
    mark('exit ' + tone(out), out, 'Exit ' + price.format(exitPrice(trade)))

    const r = multipleOf(trade)
    label(r === null ? 'Exit' : 'Exit ' + multiple(r), out, 'over', 'exit',
      r === null ? undefined : 'How far price went your way, in units of the stop at entry. Before costs.')
    if (stop !== null) label('Stop', at(stop), 'under')
    if (target !== null) label('Target', at(target), 'under')
    // The entry's label only where there is room for it between the other two.
    const crowded = [stop, target].some((p) => p !== null && Math.abs(x(at(p)) - x(0)) < 16)
    if (!crowded) label('Entry', 0, 'under')

    root.setAttribute('aria-label', [
      stop !== null ? 'stop ' + price.format(stop) : null,
      'entry ' + price.format(trade.entry.price),
      target !== null ? 'target ' + price.format(target) : null,
      'exit ' + price.format(exitPrice(trade)),
    ].filter((part) => part !== null).join(', '))
    return root
  }

  /** The ladder, the four prices and — for a trade closed in pieces — each piece. */
  function plan(): HTMLElement {
    const card = h('section', 'card plan')
    const head = h('header', 'card-head')
    head.append(h('h3', '', 'Plan vs outcome'))
    card.append(head)

    const line = ladder()
    if (line !== null) card.append(line)

    const figures = h('dl', 'plan-figures')
    const figure = (key: string, value: string, className = '', tip?: string): void => {
      const pair = h('div', 'plan-figure')
      if (tip !== undefined) pair.dataset.tip = tip
      pair.append(h('dt', '', key), h('dd', className, value))
      figures.append(pair)
    }
    const ratio = plannedRatio(trade)
    if (ratio !== null) figure('Planned', '1 : ' + ratio.toFixed(2), '', 'Risk to reward, from the stop and target the entry order carried.')
    if (figures.childElementCount > 0) card.append(figures)

    const grid = h('div', 'facts')
    const fact = (label: string, value: string, className = '', note?: string, noteTone = ''): void => {
      const cell = h('div', 'fact')
      cell.append(h('span', 'fact-label', label), h('span', 'fact-value ' + className, value))
      if (note !== undefined) cell.append(h('span', 'fact-note ' + noteTone, note))
      grid.append(cell)
    }
    fact('Entry', price.format(trade.entry.price))
    // A single exit at a level says here how far the fill landed from it;
    // several exits get the list below instead.
    const only = trade.exits.length === 1 ? trade.exits[0]! : null
    const slip = only === null ? null : slipOf(only)
    fact('Exit', price.format(exitPrice(trade)), '',
      trade.exits.length > 1 ? 'average of ' + trade.exits.length : slip?.text, slip?.tone)
    const stop = levelText(trade.stop), target = levelText(trade.target)
    fact('Stop', stop.value, stop.value === 'None' ? 'warn' : '', stop.note)
    fact('Target', target.value, '', target.note)
    card.append(grid)

    // Only a trade closed in pieces needs each piece listed; one exit is the
    // Exit figure above.
    if (trade.exits.length > 1) {
      const exits = h('div', 'exits')
      exits.append(h('h4', '', 'Closed in ' + trade.exits.length + ' pieces'))
      const list = h('ul', 'exit-list')
      for (const exit of trade.exits) list.append(exitRow(exit))
      exits.append(list)
      card.append(exits)
    }
    return card
  }

  // ── the margin ───────────────────────────────────────────────────────────

  function margins(): HTMLElement {
    const section = h('section', 'card margin')
    const status = h('span', 'saved')
    status.setAttribute('role', 'status')
    const note = (): Note => margin.get(trade.positionId)

    const say = (state: 'idle' | 'working' | 'done' | 'failed', text: string): void => {
      status.className = 'saved ' + state
      status.replaceChildren()
      if (state === 'working') status.append(h('span', 'pulse'))
      if (state === 'done') status.append(icon('check'))
      if (state === 'failed') status.append(icon('alert'))
      status.append(text)
    }

    /**
     * One write of this trade's margin, narrated on the status line.
     *
     * Every field lives in the same row, so a change to any one of them writes
     * all of them — which is why each change is applied to the note as it
     * stands rather than to what is on the screen next to it. Writes go one at
     * a time, each starting from what the one before it kept: two clicks
     * quicker than the record answers would otherwise both start from the
     * same note, and the second would write the first away.
     */
    function persist(edit: (current: Note) => Written): Promise<boolean> {
      const write = queue.then(() => send(edit(note())))
      queue = write
      return write
    }
    let queue: Promise<unknown> = Promise.resolve()

    async function send(written: Written): Promise<boolean> {
      say('working', 'Saving…')
      try {
        await margin.save(trade.positionId, written)
        saved(trade.positionId)
        say('done', 'Saved ' + justNow(new Date()))
        drawNext()
        return true
      } catch (error) {
        say('failed', 'Not saved. ' + (error instanceof Error ? error.message : String(error)))
        return false
      }
    }

    /**
     * A click on a grade or a tag is the save; the tab waits for it before
     * moving on. The chips are redrawn once the record has answered, so what
     * is lit is what was kept — and a refused save leaves them as they were.
     */
    const change = (edit: (current: Note) => Written): void => { inFlight = persist(edit).finally(redraw) }

    const head = h('header', 'card-head')
    head.append(h('h3', '', 'Your review'), status)
    section.append(head)

    /**
     * Each kind of thing you can mark is one row: its name, and a hover away
     * on the mark beside it the question it answers and how to tell it from
     * the others. The Tags dialog keeps all of it in one place.
     */
    const group = (title: string, asks: string, means: string): { row: HTMLElement; head: HTMLElement } => {
      const row = h('div', 'mark')
      const top = h('div', 'mark-head')
      top.append(h('span', 'mark-label', title), tipMark(asks + ' ' + means, 'About ' + title.toLowerCase()))
      row.append(top)
      return { row, head: top }
    }

    const redraws: (() => void)[] = []
    const redraw = (): void => { for (const draw of redraws) draw() }
    refresh = redraw

    // Grade: three letters, one lit. The lit one clicked again clears it.
    const grading = group('Setup grade', GRADE_GUIDE.asks, GRADE_GUIDE.means)
    const letters = h('div', 'grades')
    letters.setAttribute('role', 'group')
    letters.setAttribute('aria-label', 'Setup grade')
    for (const grade of GRADES) {
      const button = h('button', 'grade', grade) as HTMLButtonElement
      button.type = 'button'
      button.addEventListener('click', () => {
        change((current) => ({ ...current, grade: current.grade === grade ? null : grade }))
      })
      redraws.push(() => {
        const on = note().grade === grade
        button.classList.toggle('on', on)
        button.setAttribute('aria-pressed', String(on))
      })
      letters.append(button)
    }
    grading.row.append(letters)
    section.append(grading.row)

    // Tags: every word in the vocabulary, by kind, lit when the trade carries it.
    for (const guide of KINDS) {
      const box = group(guide.title, guide.asks, guide.means)
      const chips = h('div', 'chips kind-' + guide.kind)
      const drawChips = (): void => {
        const carried = note().tags
        chips.replaceChildren()
        for (const tag of vocabulary.of(guide.kind)) {
          const chip = h('button', 'chip', tag.label) as HTMLButtonElement
          chip.type = 'button'
          if (tag.description) chip.dataset.tip = tag.description
          const on = carried.includes(tag.slug)
          chip.classList.toggle('on', on)
          chip.setAttribute('aria-pressed', String(on))
          chip.addEventListener('click', () => {
            change((current) => ({ ...current, tags: toggled(current.tags, tag, vocabulary.kindOf) }))
          })
          chips.append(chip)
        }
        chips.append(adder(guide.kind))
      }
      redraws.push(drawChips)
      box.row.append(chips)
      section.append(box.row)
    }

    /*
     * A tag the trade carries that the vocabulary no longer names — typed in
     * before there was a vocabulary, or removed by hand in a SQL client. Shown
     * so it is not silently lost, and a click takes it off.
     */
    const strays = group('Unknown tags', 'Not in your vocabulary.',
      'Tags this trade carries that your vocabulary no longer names. Click one to take it off.')
    strays.row.classList.add('strays')
    const strayChips = h('div', 'chips')
    strays.row.append(strayChips)
    redraws.push(() => {
      const unknown = note().tags.filter((slug) => vocabulary.get(slug) === undefined)
      strays.row.hidden = unknown.length === 0
      strayChips.replaceChildren(...unknown.map((slug) => {
        const chip = h('button', 'chip stray on') as HTMLButtonElement
        chip.type = 'button'
        chip.dataset.tip = 'Take this tag off'
        chip.append(slug, icon('x'))
        chip.addEventListener('click', () => {
          change((current) => ({ ...current, tags: current.tags.filter((other) => other !== slug) }))
        })
        return chip
      }))
    })
    section.append(strays.row)

    /**
     * The way a new word gets into the vocabulary without leaving the trade: a
     * dashed chip that turns into a line to type on. Enter or leaving it
     * creates the tag and puts it on this trade; Escape puts the chip back.
     */
    function adder(kind: Kind): HTMLElement {
      const add = h('button', 'chip add') as HTMLButtonElement
      add.type = 'button'
      add.setAttribute('aria-label', 'Add a new ' + kind + ' tag')
      add.append(icon('plus'), 'New')
      add.addEventListener('click', () => {
        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'chip-input'
        input.placeholder = 'Name the new tag'
        input.setAttribute('aria-label', 'New ' + kind + ' tag')
        let done = false
        const finish = async (create: boolean): Promise<boolean> => {
          if (done) return true
          done = true
          const label = input.value.trim()
          if (!create || label === '') { redraw(); return true }
          try {
            const tag = await vocabulary.add(kind, label)
            return await persist((current) => ({ ...current, tags: toggled(current.tags, tag, vocabulary.kindOf) }))
          } catch (error) {
            say('failed', 'Not added. ' + (error instanceof Error ? error.message : String(error)))
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
    const writing = h('div', 'mark notes')
    const notesHead = h('div', 'mark-head')
    notesHead.append(h('span', 'mark-label', 'Notes'))
    writing.append(notesHead)
    const editor = createEditor(PROMPT)
    editor.set(note().text)

    // Leaving the note saves it; this is for saving without leaving, and for
    // being sure. It keeps the caret where it was, so you can write on.
    const foot = h('div', 'note-foot')
    const save = h('button', 'btn secondary small', 'Save note') as HTMLButtonElement
    save.type = 'button'
    save.dataset.tip = `It also saves when you click away, or with ${MOD}↵`
    save.addEventListener('mousedown', (event) => { event.preventDefault() })
    save.addEventListener('click', () => { inFlight = commitNote() })
    foot.append(save)
    writing.append(editor.node, foot)
    section.append(writing)

    /**
     * Write the note if it differs from what was kept. A save already in the
     * air does not swallow this one: it queues behind it, carrying the words
     * as they are now.
     */
    function commitNote(): Promise<boolean> {
      const text = editor.value()
      // Reading a note is not editing it: the text comes back through the same
      // normalising that wrote it, so an untouched note matches exactly.
      if (text === note().text) return Promise.resolve(true)
      return persist((current) => ({ ...current, text }))
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
    if (at !== null && !isBlank(note())) say('idle', 'Saved ' + wrote(at))
    else say('idle', '')
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
   * Adding one is a single request carrying the whole file, with a bar that
   * fills as it goes, because a long recording on a home uplink takes
   * minutes. It is not waited for the way a save is: closing the tab or
   * stepping to the next trade stops showing it, not sending it, and the
   * clip is there the next time this trade is opened.
   */
  function tape(): HTMLElement {
    const section = h('section', 'card tape')
    const head = h('header', 'card-head')
    const reel = h('div', 'reel')
    const status = h('div', 'upload')
    status.hidden = true
    const bar = h('div', 'progress')
    const fillBar = h('i')
    bar.append(fillBar)
    const words = h('span', 'saved')

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/mp4'
    input.hidden = true
    const add = h('button', 'btn secondary small') as HTMLButtonElement
    add.type = 'button'
    add.dataset.tip = 'An MP4 of this trade, from your screen recording'
    add.append(icon('upload'), 'Add recording')
    add.addEventListener('click', () => input.click())

    const failed = (error: unknown): void => {
      status.hidden = false
      bar.hidden = true
      words.className = 'saved failed'
      words.replaceChildren(icon('alert'), error instanceof Error ? error.message : String(error))
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
      status.hidden = false
      bar.hidden = false
      fillBar.style.width = '0%'
      words.className = 'saved working'
      words.replaceChildren('Uploading ' + file.name + '…')
      margin.addClip(trade.positionId, file, (fraction) => {
        fillBar.style.width = Math.floor(fraction * 100) + '%'
        words.replaceChildren(`Uploading ${file.name}… ${Math.floor(fraction * 100)}%`)
      })
        .then(fill)
        .then(() => {
          bar.hidden = true
          words.className = 'saved done'
          words.replaceChildren(icon('check'), 'Added ' + file.name)
        })
        .catch(failed)
        .finally(() => { add.disabled = false })
    })

    fill().catch(failed)
    head.append(h('h3', '', 'Recordings'), add)
    status.append(bar, words)
    section.append(head, reel, status, input)
    return section
  }

  // ── what comes next ──────────────────────────────────────────────────────

  /**
   * The way on from here: the next trade still waiting for a review, so that
   * writing up a session is one pass rather than forty trips back to the list.
   */
  const onward = h('div', 'onward')
  function drawNext(): void {
    const left = place.unwritten()
    onward.replaceChildren()
    if (left === 0) {
      const done = h('div', 'onward-text')
      done.append(icon('check-circle'), isBlank(margin.get(trade.positionId)) ? 'Last one' : 'All caught up')
      const back = h('button', 'btn secondary', 'Back to overview') as HTMLButtonElement
      back.type = 'button'
      back.addEventListener('click', place.home)
      onward.append(done, back)
      return
    }
    const next = h('button', 'btn primary') as HTMLButtonElement
    next.type = 'button'
    next.dataset.tip = 'Or press N'
    next.append('Next to review', icon('arrow-right'))
    next.addEventListener('click', place.next)
    onward.append(h('span', 'onward-text', left + ' left'), next)
  }
  drawNext()

  // ── the panel ────────────────────────────────────────────────────────────

  const net = returnOf(trade)

  const top = h('div', 'trade-top')
  const back = h('button', 'btn ghost small back') as HTMLButtonElement
  back.type = 'button'
  back.append(icon('arrow-left'), 'Overview')
  back.addEventListener('click', place.home)

  const stepper = h('nav', 'stepper')
  stepper.setAttribute('aria-label', 'Step through trades')
  const move = (iconName: 'chevron-left' | 'chevron-right', by: number, hint: string): HTMLElement => {
    const button = h('button', 'icon-btn bordered') as HTMLButtonElement
    button.type = 'button'
    button.dataset.tip = hint
    button.setAttribute('aria-label', hint)
    button.disabled = place.index + by < 0 || place.index + by >= place.count
    button.append(icon(iconName))
    button.addEventListener('click', () => place.step(by))
    return button
  }
  stepper.append(
    move('chevron-left', -1, 'Newer trade (←)'),
    h('span', 'stepper-count', `${place.index + 1} of ${place.count}`),
    move('chevron-right', 1, 'Older trade (→)'))
  top.append(back, stepper)

  const title = h('h2', 'trade-title')
  const sidePill = h('span', 'side ' + trade.side)
  sidePill.append(icon(trade.side === 'buy' ? 'long' : 'short'), side(trade.side))
  title.append(trade.symbol, sidePill)
  if (trade.tag !== null) title.append(h('span', 'broker-tag', trade.tag))

  const opened = trade.entry.time, closed = closedAt(trade)
  const span = dateOf(opened) === dateOf(closed)
    ? weekday(opened) + ' · ' + time(opened) + ' → ' + time(closed)
    : when(opened) + ' → ' + when(closed)
  const identity = h('div')
  identity.append(title, h('p', 'trade-sub', [
    span,
    duration(closed.getTime() - opened.getTime()),
    trade.entry.volume + ' lots',
    CLOSED_HOW[endedAs(trade)],
  ].join(' · ')))

  // One figure, net of costs: what the trade did to the account.
  const result = h('div', 'trade-result')
  result.append(h('div', 'trade-net ' + tone(net), signed(net)))
  const header = h('header', 'trade-head')
  header.append(identity, result)

  const facts = h('div', 'trade-col')
  facts.append(plan(), tape())
  const yours = h('div', 'trade-col')
  yours.append(margins(), onward)
  const body = h('div', 'trade-body')
  body.append(facts, yours)

  // The broker's side, then yours.
  panel.append(top, header, body)

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { place.close(); return }
    // Arrow keys belong to whatever is being typed in — a note, a new tag —
    // and only move between trades from everywhere else.
    const target = event.target
    const typing = target instanceof HTMLElement &&
      (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); place.step(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); place.step(1) }
    if (event.key === 'n' || event.key === 'N') { event.preventDefault(); if (place.unwritten() > 0) place.next() }
  })

  return { node: panel, settled, refresh: () => refresh() }
}
