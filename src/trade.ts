/**
 * One trade, opened up — and the place you review it.
 *
 * The list answers "what happened"; this answers "what happened, exactly, and
 * what did I think of it". The recording leads: it is the trade as it
 * happened, so it takes the top of the tab, and the note can point into it
 * moment by moment — see `tape.ts`. Under it are the facts the list has no room for — the plan
 * drawn against the outcome, each exit with the level that fired it and how
 * far off the fill was, a stop shown as it was placed *and* as it ended —
 * and beside them the margin: your grade, your tags and your notes, in the
 * order a review asks for them. The grade first, for the setup as it looked
 * before the result was known; then why this trade, why then, what shape;
 * then what you would take back; then the trade in words — before, during
 * and after.
 *
 * Two columns on a wide screen, the tape and the broker's side on the left
 * and yours on the right; one column, the same order, on a narrow one.
 *
 * Nothing here has a save button you have to press. A grade or a tag is a
 * click, and the click is the save. The note saves when you leave it, and the
 * button under it is there for saving without leaving, and for being sure.
 * Every one of those is a key as well, so a review can be done without the
 * mouse: A, B or C grades, M marks the tape, N moves on.
 *
 * This draws one panel and knows nothing about where it is shown; `tabs.ts`
 * gives each open trade its own tab and asks here for the panel to put in it.
 */

import { h } from './dom.ts'
import type { Editor } from './editor.ts'
import { createEditor } from './editor.ts'
import type { Format } from './format.ts'
import { CLOSED_BY, CLOSED_HOW } from './format.ts'
import { icon } from './icons.ts'
import type { ExitFill, Level, Trade } from './journal.ts'
import type { Margin, Note, Written } from './margin.ts'
import { isBlank } from './margin.ts'
import type { Grade, Kind, Vocabulary } from './tags.ts'
import { GRADES, GRADE_GUIDE, KINDS, toggled } from './tags.ts'
import { createTape } from './tape.ts'
import { tipMark } from './tips.ts'
import type { Standing } from './view.ts'
import { closedAt, endedAs, exitPrice, inFavour, multipleOf, plannedRatio, returnOf } from './view.ts'

type Phase = 'preTrade' | 'inTrade' | 'postTrade'

/** The three notes, in the order the trade happened, each with the question it answers. */
const NOTES: readonly { phase: Phase; title: string; prompt: string }[] = [
  { phase: 'preTrade', title: 'Pre-trade', prompt: 'What did you see, and why did you take it?' },
  { phase: 'inTrade', title: 'In-trade', prompt: 'What happened while you were in, and what did you do about it?' },
  { phase: 'postTrade', title: 'Post-trade', prompt: 'What would you do again, and what would you change?' },
]

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
  /** Stop the tape, because the panel is going out of sight. */
  pause: () => void
  /** A key pressed with nothing focused, handled as if the panel had it. */
  key: (event: KeyboardEvent) => void
}

/** What the panel needs from whoever is showing it. */
export interface Place {
  /** Where this trade sits in the list's order, and how long that order is. */
  index: number
  count: number
  /** Whether it was its week's biggest win or loss, the trades worth the deepest review. */
  standing: Standing | null
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
  /** Set a grade from the keyboard, as its button would. */
  let grade = (_: Grade): void => {}

  // ── the tape, and the notes that point into it ───────────────────────────

  // Each needs the other: marking the tape writes in a note, and a moment in
  // any note plays the tape. The notes are made with the margin, below. A
  // mark goes into the note you were last in — the in-trade one until then.
  const editors: Editor[] = []
  let marking: Editor | null = null
  const tape = createTape({
    clips: () => margin.clips(trade.positionId),
    addClip: (file, progress) => margin.addClip(trade.positionId, file, progress),
    mark: (seconds, quiet) => { marking?.addMoment(seconds, !quiet) },
    at: (seconds) => {
      for (const editor of editors) {
        editor.light(seconds)
        editor.tapeReady(seconds !== null)
      }
    },
  })

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
     * the others. The Tags dialog keeps all of it in one place. The name sits
     * beside what you pick from where there is room, so the whole review fits
     * next to the tape.
     */
    const group = (title: string, asks: string, means: string): { row: HTMLElement; head: HTMLElement } => {
      const row = h('div', 'mark row')
      const top = h('div', 'mark-head')
      top.append(h('span', 'mark-label', title), tipMark(asks + ' ' + means, 'About ' + title.toLowerCase()))
      row.append(top)
      return { row, head: top }
    }

    const redraws: (() => void)[] = []
    const redraw = (): void => { for (const draw of redraws) draw() }
    refresh = redraw
    /** Whether the review has been drawn once, since the first drawing only shows what was kept. */
    let drawn = false

    // Grade: three letters, one lit. The lit one clicked again clears it, and
    // so does its key pressed again.
    const setGrade = (letter: Grade): void => {
      change((current) => ({ ...current, grade: current.grade === letter ? null : letter }))
    }
    grade = setGrade
    const grading = group('Setup grade', GRADE_GUIDE.asks, GRADE_GUIDE.means)
    grading.row.classList.add('grading')
    const letters = h('div', 'grades')
    letters.setAttribute('role', 'group')
    letters.setAttribute('aria-label', 'Setup grade')
    for (const letter of GRADES) {
      const button = h('button', 'grade', letter) as HTMLButtonElement
      button.type = 'button'
      button.dataset.tip = 'Or press ' + letter
      button.addEventListener('click', () => { setGrade(letter) })
      redraws.push(() => {
        const on = note().grade === letter
        // Only a grade just given lands with a flourish, not one the trade opened with.
        button.classList.toggle('fresh', on && drawn && !button.classList.contains('on'))
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
      // What was lit before this drawing, so only a tag just put on lands with
      // a flourish; null until the first drawing, which lights without one.
      let lit: Set<string> | null = null
      const drawChips = (): void => {
        const carried = note().tags
        chips.replaceChildren()
        for (const tag of vocabulary.of(guide.kind)) {
          const chip = h('button', 'chip', tag.label) as HTMLButtonElement
          chip.type = 'button'
          if (tag.description) chip.dataset.tip = tag.description
          const on = carried.includes(tag.slug)
          chip.classList.toggle('on', on)
          chip.classList.toggle('fresh', on && lit !== null && !lit.has(tag.slug))
          chip.setAttribute('aria-pressed', String(on))
          chip.addEventListener('click', () => {
            change((current) => ({ ...current, tags: toggled(current.tags, tag, vocabulary.kindOf) }))
          })
          chips.append(chip)
        }
        chips.append(adder(guide.kind))
        lit = new Set(carried)
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
      add.dataset.tip = 'New ' + kind + ' tag'
      add.append(icon('plus'))
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

    // The notes: each always the editor, never a box you switch into, and
    // each a place the tape is written about — a moment in any of them is a
    // mark on the scrubber.
    const writing = h('div', 'mark notes')
    const writers = NOTES.map(({ phase, title, prompt }) => {
      const writer = createEditor(prompt, {
        now: tape.now,
        seek: tape.seek,
        changed: () => { tape.moments(editors.flatMap((one) => one.moments())) },
      })
      editors.push(writer)
      if (phase === 'inTrade') marking = writer
      const head = h('div', 'mark-head')
      head.append(h('span', 'mark-label', title))
      const part = h('div', 'phase-note')
      part.append(head, writer.node)
      writing.append(part)
      return { phase, writer }
    })
    for (const { phase, writer } of writers) writer.set(note()[phase])

    // Leaving a note saves it; this is for saving without leaving, and for
    // being sure. It keeps the caret where it was, so you can write on.
    const foot = h('div', 'note-foot')
    const save = h('button', 'btn secondary small', 'Save notes') as HTMLButtonElement
    save.type = 'button'
    save.dataset.tip = `They also save when you click away, or with ${MOD}↵`
    save.addEventListener('mousedown', (event) => { event.preventDefault() })
    save.addEventListener('click', () => { inFlight = commitNotes() })
    foot.append(save)
    writing.append(foot)
    section.append(writing)

    /**
     * Write whichever notes differ from what was kept, in one write, since
     * they share a row. A save already in the air does not swallow this one:
     * it queues behind it, carrying the words as they are now.
     */
    function commitNotes(): Promise<boolean> {
      const typed: Partial<Record<Phase, string>> = {}
      for (const { phase, writer } of writers) {
        const text = writer.value()
        // Reading a note is not editing it: the text comes back through the
        // same normalising that wrote it, so an untouched note matches exactly.
        if (text !== note()[phase]) typed[phase] = text
      }
      if (Object.keys(typed).length === 0) return Promise.resolve(true)
      return persist((current) => ({ ...current, ...typed }))
    }

    for (const { writer } of writers) {
      writer.node.addEventListener('focusin', () => { marking = writer })
      writer.node.addEventListener('focusout', (event) => {
        // Moving between a note's toolbar and its writing is not leaving it.
        const to = event.relatedTarget
        if (to instanceof Node && writer.node.contains(to)) return
        inFlight = commitNotes()
      })
      writer.node.addEventListener('keydown', (event) => {
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
    }

    redraw()
    drawn = true
    const at = note().updatedAt
    if (at !== null && !isBlank(note())) say('idle', 'Saved ' + wrote(at))
    else say('idle', '')
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

  // One figure, net of costs: what the trade did to the account — and, for the
  // week's biggest either way, a word that this is one to take apart.
  const result = h('div', 'trade-result')
  result.append(h('div', 'trade-net ' + tone(net), signed(net)))
  if (place.standing !== null) {
    const standout = h('span', 'standout ' + place.standing,
      place.standing === 'best' ? 'Week’s biggest win' : 'Week’s biggest loss')
    standout.dataset.tip = 'The trades that moved the account most are the ones worth reviewing moment by moment.'
    result.append(standout)
  }
  const header = h('header', 'trade-head')
  header.append(identity, result)

  // The tape and the broker's side, then yours.
  const facts = h('div', 'trade-col')
  facts.append(tape.node, plan())
  const yours = h('div', 'trade-col')
  yours.append(margins(), onward)
  const body = h('div', 'trade-body')
  body.append(facts, yours)

  panel.append(top, header, body)

  function onKey(event: KeyboardEvent): void {
    // Escape leaves full screen before it closes anything.
    if (event.key === 'Escape') { if (document.fullscreenElement === null) place.close(); return }
    // Keys belong to whatever is being typed in — a note, a new tag — and
    // only move the tab or the tape from everywhere else.
    const target = event.target
    const typing = target instanceof HTMLElement &&
      (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return
    // A button pressed with the mouse keeps the focus, and space would press
    // it again: space is the tape's, unless the button was reached by keyboard.
    if (event.key === ' ' && target instanceof HTMLButtonElement && target.matches(':focus-visible')) return
    const letter = GRADES.find((one) => one === event.key.toUpperCase())
    if (event.key === 'ArrowLeft') { event.preventDefault(); place.step(-1) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); place.step(1) }
    else if (event.key === 'n' || event.key === 'N') { event.preventDefault(); if (place.unwritten() > 0) place.next() }
    else if (letter !== undefined) { event.preventDefault(); grade(letter) }
    else if (tape.key(event)) event.preventDefault()
  }
  panel.addEventListener('keydown', onKey)

  /*
   * A recording dragged onto the tab goes on its tape, wherever it is let go:
   * the whole tab is the target, so there is no small box to aim for, and a
   * file dropped beside the tape is not opened by the browser in its place.
   */
  let over = 0
  const carriesFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') ?? false
  panel.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return
    over++
    panel.classList.add('dropping')
  })
  panel.addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return
    over = Math.max(0, over - 1)
    if (over === 0) panel.classList.remove('dropping')
  })
  panel.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    event.dataTransfer!.dropEffect = 'copy'
  })
  panel.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    over = 0
    panel.classList.remove('dropping')
    const file = event.dataTransfer?.files[0]
    if (file !== undefined) tape.add(file)
  })

  return { node: panel, settled, refresh: () => refresh(), pause: tape.pause, key: onKey }
}
