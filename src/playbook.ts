/**
 * One play, opened up: a setup's page in the playbook.
 *
 * What's working says which plays pay. This is where one of them is taken
 * apart. Whether it has an edge, in R, and how much of that is still luck;
 * whether it is still working; which version of it works — the A, the trend
 * day, the strong close, the first hour — and whether that is the version you
 * pressed; what running it badly costs; and every trade that ran it, the best
 * first when you want the ones to watch again.
 *
 * Everything on it is worked out by `edge.ts` from the trades that carry the
 * play's tag, and drawn again whenever its tab comes back, since a trade
 * written up in the meantime may have joined it. Every group on the page — a
 * bar of the outcomes, a row of the table, a way the trades closed — narrows
 * the play's own list of trades, the way a day on the calendar narrows the
 * overview's, and every trade on it, in the list or on the curve, opens its tab.
 */

import { h } from './dom.ts'
import type { Bin, Edge, Sample, Slice, Split } from './edge.ts'
import { binsOf, byClose, capture, costShare, curveOf, deepestDip, edgeOf, exitsOf, inBin, keysFor, outcomeOf, pastTheStop, runs, sliceBy, topTenth } from './edge.ts'
import type { Format } from './format.ts'
import { CLOSED_BY, CLOSED_HOW } from './format.ts'
import { icon } from './icons.ts'
import type { Trade } from './journal.ts'
import type { Margin } from './margin.ts'
import { drawRCurve } from './rcurve.ts'
import type { Vocabulary } from './tags.ts'
import { GRADES, GRADE_GUIDE, KINDS } from './tags.ts'
import { tipMark } from './tips.ts'
import type { Panel } from './trade.ts'
import { closedAt, endedAs, multipleOf, returnOf, riskShare } from './view.ts'

/** What the page needs from whoever is showing it. */
export interface Shelf {
  /** The plays with trades behind them, in What's working's order: the order the arrows step in. */
  plays: () => string[]
  /** Move this tab to the play that far along that order; nothing happens if there is none. */
  step: (by: number) => void
  /** Open a trade's tab. */
  open: (positionId: string) => void
  /** Show the overview, leaving this tab open. */
  home: () => void
  /** Take the page off the screen. */
  close: () => void
}

export interface PlayDrawing {
  format: Format
  margin: Margin
  vocabulary: Vocabulary
}

/** Below this many trades a group's figures are noise, and its row says so — as in What's working. */
const FEW = 3

/** How many of the latest trades say whether the play is still working. */
const RECENT = 10

/** A way to narrow the play's list: the group it came from, what its chip says, and which trades it keeps. */
interface Narrow {
  key: string
  label: string
  keeps: (sample: Sample) => boolean
}

type Order = 'newest' | 'grade' | 'best' | 'worst'

const SPLITS: readonly { split: Split; title: string; asks: string }[] = [
  { split: 'grade', title: GRADE_GUIDE.title, asks: GRADE_GUIDE.asks },
  ...KINDS.filter((k) => k.kind !== 'play').map((k) => ({ split: k.kind as Split, title: k.title, asks: k.asks })),
  { split: 'hour', title: 'Hour', asks: 'When was it opened, on the broker’s clock?' },
  { split: 'side', title: 'Side', asks: 'Long or short?' },
  { split: 'symbol', title: 'Symbol', asks: 'Which market?' },
]

const ORDERS: readonly [Order, string, string][] = [
  ['newest', 'Newest', 'Newest first'],
  ['grade', 'Grade', 'The A’s first: the play at its best, down to the versions to leave alone'],
  ['best', 'Best', 'Highest R first: the trades to watch again'],
  ['worst', 'Worst', 'Lowest R first: the ones to learn from'],
]

export function drawPlay(slug: string, trades: Trade[], shelf: Shelf, drawing: PlayDrawing): Panel {
  const { format, margin, vocabulary } = drawing
  const { day, duration, fixed, multiple, pct, plural, side, signed, time, tone, when } = format

  const panel = h('section', 'trade play')
  panel.tabIndex = -1

  // What survives the page being drawn again: how you were looking at it.
  let split: Split = 'grade'
  let order: Order = 'newest'
  let narrow: Narrow | null = null
  let entered = false
  let stopCurve = (): void => {}

  /** The trades that ran the play, newest first, with what you wrote against each. */
  const samples = (): Sample[] => trades
    .map((trade) => ({ trade, note: margin.get(trade.positionId) }))
    .filter((sample) => runs(sample.note, slug, vocabulary.kindOf))

  const r = (sample: Sample): number | null => multipleOf(sample.trade)
  const rText = (value: number | null): string => (value === null ? '—' : multiple(value))

  /** A card's heading, with the ⓘ that explains it. */
  function heading(title: string, tip: string): HTMLElement {
    const head = h('header', 'card-head')
    const name = h('h3', 'card-title', title)
    name.append(tipMark(tip))
    head.append(name)
    return head
  }

  /** Something that narrows the list when pressed, and shows when it is the one narrowing it. */
  function narrower(node: HTMLElement, by: Narrow): void {
    node.dataset.narrow = by.key
    node.addEventListener('click', () => {
      narrow = narrow?.key === by.key ? null : by
      marks()
      drawList()
      if (narrow !== null) reveal()
    })
  }

  function marks(): void {
    for (const node of panel.querySelectorAll<HTMLElement>('[data-narrow]')) {
      const on = node.dataset.narrow === narrow?.key
      node.classList.toggle('on', on)
      node.setAttribute('aria-pressed', String(on))
    }
  }

  // ── the top: the way back, and the way along ─────────────────────────────

  function top(): HTMLElement {
    const bar = h('div', 'trade-top')
    const back = h('button', 'btn ghost small back') as HTMLButtonElement
    back.type = 'button'
    back.append(icon('arrow-left'), 'Overview')
    back.addEventListener('click', shelf.home)

    const order = shelf.plays()
    const at = order.indexOf(slug)
    const stepper = h('nav', 'stepper')
    stepper.setAttribute('aria-label', 'Step through plays')
    const move = (iconName: 'chevron-left' | 'chevron-right', by: number, hint: string): HTMLElement => {
      const button = h('button', 'icon-btn bordered') as HTMLButtonElement
      button.type = 'button'
      button.dataset.tip = hint
      button.setAttribute('aria-label', hint)
      button.disabled = at < 0 || order[at + by] === undefined
      button.append(icon(iconName))
      button.addEventListener('click', () => shelf.step(by))
      return button
    }
    stepper.append(
      move('chevron-left', -1, 'Previous play (←)'),
      h('span', 'stepper-count', at < 0 ? '—' : `${at + 1} of ${order.length}`),
      move('chevron-right', 1, 'Next play (→)'))
    bar.append(back, stepper)
    return bar
  }

  // ── the head: what the play is, and what it is worth ─────────────────────

  function header(all: Sample[], edge: Edge): HTMLElement {
    const tag = vocabulary.get(slug)
    const title = h('h2', 'trade-title', vocabulary.label(slug))
    if (tag?.archived) {
      const retired = h('span', 'chip retired-play', 'Retired')
      retired.dataset.tip = 'Out of the picker, and still on every trade that carries it.'
      title.append(retired)
    }
    const identity = h('div')
    identity.append(title)
    if (tag?.description) identity.append(h('p', 'play-means', tag.description))
    const closes = all.map((sample) => closedAt(sample.trade).getTime())
    identity.append(h('p', 'trade-sub', all.length === 0 ? 'No trades yet'
      : plural(all.length, 'trade') + ' · ' + day(new Date(Math.min(...closes))) + ' – ' + day(new Date(Math.max(...closes)))))

    const worth = h('div', 'trade-result')
    const label = h('span', 'eyebrow', 'Expectancy')
    label.append(tipMark('The average R a trade of this play made: what one more is worth, in units of what it risks. Before costs.'))
    const value = edge.expectancy
    worth.append(label, h('div', 'trade-net ' + (value === null ? '' : tone(value)), rText(value)))
    if (edge.range !== null) {
      const range = h('span', 'play-range', multiple(edge.range.low) + ' to ' + multiple(edge.range.high))
      range.dataset.tip = 'Where the true average most likely sits, 95 times in 100. It narrows as trades add up, and takes twenty-five or so to mean much; while it spans zero, the edge could still be luck.'
      range.classList.toggle('unproven', edge.range.low <= 0 && edge.range.high >= 0)
      worth.append(range)
    }

    const head = h('header', 'trade-head')
    head.append(identity, worth)
    return head
  }

  // ── six figures ──────────────────────────────────────────────────────────

  function tiles(all: Sample[], edge: Edge): HTMLElement {
    const row = h('section', 'stats')
    row.setAttribute('aria-label', 'Key figures')
    const tile = (label: string, value: string, valueTone: string, note: string, tip: string, extra?: HTMLElement): void => {
      const node = h('div', 'stat card')
      const head = h('div', 'stat-label', label)
      head.append(tipMark(tip))
      node.append(head, h('div', 'stat-value ' + valueTone, value))
      if (extra !== undefined) node.append(extra)
      if (note !== '') node.append(h('div', 'stat-note', note))
      row.append(node)
    }

    const meter = h('div', 'meter')
    meter.setAttribute('aria-hidden', 'true')
    for (const [count, className] of [[edge.wins, 'up'], [edge.count - edge.wins - edge.losses, 'flat'], [edge.losses, 'down']] as const) {
      if (count === 0) continue
      const segment = h('i', className)
      segment.style.flexGrow = String(count)
      meter.append(segment)
    }
    tile('Win rate', edge.winRate === null ? '—' : Math.round(100 * edge.winRate) + '%', '',
      edge.count === 0 ? '' : edge.wins + ' of ' + plural(edge.count, 'trade'),
      'The share of the play’s trades that closed in profit, after costs. Grey on the bar is a scratch: a trade that closed where it opened, down only its costs.', edge.count ? meter : undefined)

    tile('Win / loss size', fixed(edge.payoff), edge.payoff === null ? '' : tone(edge.payoff - 1),
      edge.avgWin === null || edge.avgLoss === null ? 'Needs a win and a loss' : multiple(edge.avgWin) + ' / ' + multiple(edge.avgLoss),
      'The average winner’s R over the average loser’s. A scratch is neither, so it cannot pass for a loser cut short.')

    tile('Total', edge.count ? signed(edge.total) : '—', edge.count ? tone(edge.total) : '',
      edge.rs.length ? multiple(edge.totalR) + ' before costs' : '',
      'What the play’s trades did to the account, net of costs, added up; under it, the R they made.')

    // How hard the play was pressed, and whether the pressing followed the grade.
    const byGrade = GRADES
      .map((grade) => ({ grade, edge: edgeOf(all.filter((sample) => sample.note.grade === grade)) }))
      .filter((one) => one.edge.risk !== null)
    tile('Risk', edge.risk === null ? '—' : pct(edge.risk), '',
      byGrade.length > 1 ? byGrade.map((one) => one.grade + '\u00a0' + pct(one.edge.risk!)).join(' · ') : edge.risk === null ? '' : 'a trade, on average',
      'The share of the account a trade stood to lose at its stop, on average: how hard the play was pressed. By grade, whether the A’s were pressed harder than the C’s.')

    // How much of what the play made came from its few best trades.
    const top = topTenth(all)
    tile('Top 10%', top === null ? '—' : Math.round(100 * top.share) + '%', '',
      top === null ? 'Needs a total to share' : 'of the total, from ' + plural(top.count, 'trade'),
      'The share of the play’s total made by its best tenth of trades, net of costs. Most of a year’s profit tends to come from a few trades: the more of it sits here, the more the next one like them is worth pressing, and the dearer it is to miss.')

    const past = pastTheStop(all)
    const worst = Math.min(...past.map((sample) => r(sample)!))
    tile('Past the stop', edge.rs.length ? String(past.length) : '—', past.length ? 'warn' : '',
      past.length ? 'worst ' + multiple(worst) : edge.rs.length ? 'every loss held to its stop' : '',
      'Losses more than a tenth of an R beyond the stop the trade was opened with: a fill well past it, or a stop moved further away.')
    return row
  }

  // ── is it still working ──────────────────────────────────────────────────

  function curve(all: Sample[], edge: Edge): HTMLElement {
    const card = h('section', 'card')
    const head = heading('Cumulative R', 'The play’s R added up trade by trade, with each trade’s own R as a bar under the line. Before costs.')
    const steps = curveOf(all)
    const readout = h('dl', 'readout')
    const read = (key: string, tip: string, ...value: (string | Node)[]): void => {
      const dt = h('dt', '', key)
      dt.append(tipMark(tip))
      const dd = h('dd')
      dd.append(...value)
      readout.append(dt, dd)
    }
    // A slump shows first in the latest trades, so they are read apart from the rest.
    if (steps.length > RECENT) {
      const recent = edgeOf(steps.slice(-RECENT).map((step) => step.sample))
      read('Last ' + RECENT,
        `How often the play’s ${RECENT} latest trades won, and their average R, against ${Math.round(100 * edge.winRate!)}% and ${rText(edge.expectancy)} over all of them. A setup that has stopped working shows here first.`,
        Math.round(100 * recent.winRate!) + '% · ', h('span', tone(recent.expectancy!), multiple(recent.expectancy!)))
    }
    if (steps.length > 1) {
      const dip = deepestDip(steps)
      read('Deepest dip', 'The furthest the running total has fallen below its best: the worst slump the play has been through.',
        h('span', dip > 0 ? 'down' : '', dip > 0 ? multiple(-dip) : '0R'))
    }
    if (readout.childElementCount > 0) head.append(readout)
    card.append(head)
    if (steps.length < 2) {
      card.append(h('p', 'empty', all.length === 0 ? 'No trades yet.' : steps.length === 0 ? 'No trades with a stop yet.' : 'One trade so far.'))
      return card
    }
    const plot = h('div', 'rcurve-plot')
    card.append(plot)
    // The line draws itself in the first time the page is seen, and not again.
    stopCurve = drawRCurve(plot, steps, format, shelf.open, entered ? null : () => { entered = true })
    return card
  }

  // ── what its outcomes look like ──────────────────────────────────────────

  function outcomes(edge: Edge): HTMLElement {
    const card = h('section', 'card')
    card.append(heading('Outcomes', 'Every trade by the R it made, before costs. A stop taken in full lands in the −1R bar, and a bar left of it lost well past its stop. A bar narrows the list below to its trades.'))
    const bins = binsOf(edge.rs)
    if (bins.length === 0) {
      card.append(h('p', 'empty', edge.count === 0 ? 'No trades yet.' : 'No trades with a stop yet.'))
      return card
    }
    const tallest = Math.max(...bins.map((bin) => bin.count))
    const chart = h('div', 'bins')
    const axis = h('div', 'bins-axis')
    axis.setAttribute('aria-hidden', 'true')
    // Every bar is named while they fit; past a dozen, every other one, or every fourth, with 0R always among them.
    const every = Math.ceil(bins.length / 12)
    const named = (bin: Bin): boolean => Math.round(bin.at / bin.width) % every === 0
    const say = (value: number): string =>
      Math.abs(value) < 1e-9 ? '0R' : (value > 0 ? '+' : '−') + Number(Math.abs(value).toFixed(2)) + 'R'
    for (const bin of bins) {
      const bar = h('button', 'bin ' + tone(bin.at)) as HTMLButtonElement
      bar.type = 'button'
      const span = say(bin.at - bin.width / 2) + ' to ' + say(bin.at + bin.width / 2)
      bar.dataset.tip = plural(bin.count, 'trade') + ' · ' + span
      bar.setAttribute('aria-label', `${plural(bin.count, 'trade')} between ${span}`)
      bar.disabled = bin.count === 0
      const fill = h('i')
      fill.style.height = (100 * bin.count / tallest).toFixed(1) + '%'
      bar.append(h('b', '', bin.count ? String(bin.count) : ''), fill)
      narrower(bar, { key: 'bin:' + bin.at, label: 'Around ' + say(bin.at), keeps: (sample) => { const value = r(sample); return value !== null && inBin(value, bin) } })
      chart.append(bar)
      axis.append(h('span', '', named(bin) ? say(bin.at) : ''))
    }
    card.append(chart, axis)
    return card
  }

  // ── which version of it works ────────────────────────────────────────────

  function versions(all: Sample[]): HTMLElement {
    const card = h('section', 'card play-versions')
    const head = h('header', 'card-head')
    const control = h('div', 'seg-control')
    control.setAttribute('role', 'group')
    control.setAttribute('aria-label', 'Split by')
    const buttons = SPLITS.map((option) => {
      const button = h('button', '', option.title) as HTMLButtonElement
      button.type = 'button'
      button.dataset.tip = option.asks
      button.addEventListener('click', () => {
        split = option.split
        fill(samples())
      })
      control.append(button)
      return button
    })
    const name = h('h3', 'card-title', 'When it works')
    name.append(tipMark('The play’s trades split one way at a time, each group with what it made. Risk is how hard the group was pressed. A row narrows the list below to its trades.'))
    head.append(name, control)
    const body = h('div', 'facet-body')
    card.append(head, body)

    function fill(list: Sample[]): void {
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(SPLITS[i]!.split === split)))
      const current = SPLITS.find((option) => option.split === split)!
      const slices = sliceBy(list, split, vocabulary.kindOf)
      if (slices.length === 0) {
        body.replaceChildren(h('p', 'empty', 'No trades yet.'))
        return
      }

      // One scale for every bar, with zero wherever the groups need it to be.
      const lo = Math.min(0, ...slices.map((slice) => slice.edge.totalR))
      const hi = Math.max(0, ...slices.map((slice) => slice.edge.totalR))
      const range = hi - lo || 1e-9
      const zero = (-lo / range * 100).toFixed(2) + '%'

      const table = h('table', 'facet-table play-table') as HTMLTableElement
      const headRow = table.createTHead().insertRow()
      for (const [text, className] of [[current.title, ''], ['Trades', 'num'], ['Win rate', 'num c-some'], ['Avg R', 'num'], ['Risk', 'num c-some'], ['Total R', 'total']]) {
        const th = h('th', className!, text)
        th.setAttribute('scope', 'col')
        headRow.append(th)
      }
      const rows = table.createTBody()
      for (const slice of slices) {
        const { edge } = slice
        const row = rows.insertRow()
        row.className = 'pick' + (edge.count < FEW ? ' thin' : '')
        const choose = h('button', 'group-name') as HTMLButtonElement
        choose.type = 'button'
        const text = groupName(slice, current.title)
        choose.append(groupMark(slice, current.title))
        choose.setAttribute('aria-label', `Show the ${plural(edge.count, 'trade')} in ${text}`)
        if (edge.count < FEW) choose.dataset.tip = `Only ${plural(edge.count, 'trade')} so far — too few to read much into`
        row.insertCell().append(choose)
        const keeps = (sample: Sample): boolean => {
          const keys = keysFor(sample, split, vocabulary.kindOf)
          return slice.key === null ? keys.length === 0 : keys.includes(slice.key)
        }
        narrower(choose, { key: `split:${split}:${slice.key}`, label: slice.key === null ? text : current.title + ': ' + text, keeps })
        // The whole row is the button's to press.
        row.addEventListener('click', (event) => {
          if (!(event.target instanceof Node && choose.contains(event.target))) choose.click()
        })

        row.append(h('td', 'num', String(edge.count)))
        row.append(h('td', 'num c-some', edge.winRate === null ? '—' : Math.round(100 * edge.winRate) + '%'))
        row.append(h('td', 'num ' + (edge.expectancy === null ? '' : tone(edge.expectancy)), rText(edge.expectancy)))
        row.append(h('td', 'num c-some', edge.risk === null ? '—' : pct(edge.risk)))

        const total = h('td', 'total')
        const line = h('span', 'total-line')
        const bar = h('span', 'dbar')
        bar.style.setProperty('--zero', zero)
        const fillBar = h('i', tone(edge.totalR))
        fillBar.style.width = (100 * Math.abs(edge.totalR) / range).toFixed(2) + '%'
        bar.append(fillBar)
        line.append(bar, h('span', 'dbar-value ' + tone(edge.totalR), multiple(edge.totalR)))
        total.append(line)
        row.append(total)
      }
      body.replaceChildren(table)
      marks()
    }

    fill(all)
    return card
  }

  /** What a group is called, in words. */
  function groupName(slice: Slice, title: string): string {
    if (slice.key === null) return 'No ' + title.toLowerCase()
    if (split === 'hour') return slice.key + ':00'
    if (split === 'side') return side(slice.key as Trade['side'])
    if (split === 'grade' || split === 'symbol') return slice.key
    return vocabulary.label(slice.key)
  }

  /** What a group is called, drawn the way the rest of the page draws it: a badge, a chip, a pill. */
  function groupMark(slice: Slice, title: string): HTMLElement {
    const text = groupName(slice, title)
    if (slice.key === null) return h('span', 'none', text)
    if (split === 'grade') return h('span', 'grade-badge', text)
    if (split === 'hour') return h('span', 'hour', text)
    if (split === 'symbol') return h('span', 'sym', text)
    if (split === 'side') {
      const pill = h('span', 'side ' + slice.key)
      pill.append(icon(slice.key === 'buy' ? 'long' : 'short'), text)
      return pill
    }
    const chip = h('span', 'chip kind-' + split, text)
    if (vocabulary.get(slice.key)?.archived) chip.classList.add('retired')
    return chip
  }

  // ── how you run it ───────────────────────────────────────────────────────

  function running(all: Sample[]): HTMLElement {
    const card = h('section', 'card')
    const head = h('header', 'card-head')
    head.append(h('h3', 'card-title', 'How you run it'))
    const habits = h('div', 'habits')
    card.append(head, habits)

    const section = (title: string, tip: string): HTMLElement => {
      const node = h('section', 'habit')
      const name = h('h3', '', title)
      name.append(tipMark(tip))
      node.append(name)
      habits.append(node)
      return node
    }
    const duo = (into: HTMLElement, cells: { value: string; tone: string; note: string; by?: Narrow }[]): void => {
      const row = h('div', 'duo')
      for (const cell of cells) {
        const node = h(cell.by === undefined ? 'div' : 'button', cell.by === undefined ? '' : 'duo-pick')
        if (node instanceof HTMLButtonElement) node.type = 'button'
        node.append(h('div', 'duo-value ' + cell.tone, cell.value), h('div', 'duo-note', cell.note))
        if (cell.by !== undefined) narrower(node, cell.by)
        row.append(node)
      }
      into.append(row)
    }

    if (all.length === 0) {
      habits.append(h('p', 'empty', 'No trades yet.'))
      return card
    }

    // The play run clean against the play run with a mistake.
    const hasMistake = (sample: Sample): boolean => keysFor(sample, 'mistake', vocabulary.kindOf).length > 0
    const clean = edgeOf(all.filter((sample) => !hasMistake(sample)))
    const flawed = edgeOf(all.filter(hasMistake))
    duo(section('Run clean', 'The play’s average R on trades with no mistake tagged, and on trades with one or more. The gap is what running it badly costs.'), [
      { value: rText(clean.expectancy), tone: clean.expectancy === null ? '' : tone(clean.expectancy), note: plural(clean.count, 'trade') + ' with no mistake',
        by: { key: 'clean', label: 'No mistake', keeps: (sample) => !hasMistake(sample) } },
      { value: rText(flawed.expectancy), tone: flawed.expectancy === null ? '' : tone(flawed.expectancy), note: plural(flawed.count, 'trade') + ' with a mistake',
        by: { key: 'flawed', label: 'With a mistake', keeps: hasMistake } },
    ])

    // How they closed, and what each way came to.
    const closing = section('How trades closed', 'Whether you closed each trade yourself, or the stop or target you left with the broker did, and the average R each way made.')
    const exits = exitsOf(all)
    const bar = h('div', 'bar')
    bar.setAttribute('aria-hidden', 'true')
    const legend = h('ul', 'legend')
    for (const kind of ['manual', 'stop', 'target'] as const) {
      const edge = exits[kind]
      if (edge.count === 0) continue
      const seg = h('span', 'seg ' + kind)
      seg.style.flexGrow = String(edge.count)
      bar.append(seg)
      const item = h('li')
      const pick = h('button', 'legend-pick') as HTMLButtonElement
      pick.type = 'button'
      const name = h('span', 'legend-name')
      name.append(h('b', '', CLOSED_HOW[kind]), ' ' + plural(edge.count, 'trade'))
      pick.append(h('i', 'swatch ' + kind), name,
        h('span', 'legend-net ' + (edge.expectancy === null ? '' : tone(edge.expectancy)), rText(edge.expectancy)))
      narrower(pick, { key: 'exit:' + kind, label: CLOSED_HOW[kind], keeps: (sample) => endedAs(sample.trade) === kind })
      item.append(pick)
      legend.append(item)
    }
    closing.append(bar, legend)

    // What the winners took of what their targets planned.
    const taken = capture(all)
    if (taken !== null) {
      duo(section('Winners vs target', 'What the winners were opened for — the target’s distance over the stop’s — against the R they took. Below the plan is money left before the target; above it, a winner run past it.'), [
        { value: multiple(taken.planned).replace('+', ''), tone: '', note: 'planned' },
        { value: multiple(taken.taken), tone: '', note: `taken · ${Math.round(100 * taken.taken / taken.planned)}% of plan` },
      ])
    }

    const hold = (sample: Sample): number => closedAt(sample.trade).getTime() - sample.trade.entry.time.getTime()
    const median = (values: number[]): string => {
      if (values.length === 0) return '—'
      const sorted = values.toSorted((a, b) => a - b)
      const middle = sorted.length >> 1
      return duration(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2)
    }
    duo(section('Median hold', 'How long the middle trade was held, winners and losers apart.'), [
      { value: median(all.filter((sample) => outcomeOf(sample.trade) === 'win').map(hold)), tone: '', note: 'winners' },
      { value: median(all.filter((sample) => outcomeOf(sample.trade) === 'loss').map(hold)), tone: '', note: 'losers' },
    ])

    const costs = costShare(all)
    const costing = section('Costs', 'Commission and swap, as a share of what the play’s trades made before them. A play that takes small moves pays for them here.')
    costing.append(h('div', 'duo-value', costs === null ? '—' : pct(costs)), h('div', 'duo-note', 'of gross'))
    return card
  }

  // ── every trade that ran it ──────────────────────────────────────────────

  const listCard = h('section', 'card trades play-trades')
  const listHead = h('header', 'card-head trades-head')
  const listChips = h('div', 'active-filters')
  const listCount = h('span', 'count')
  const orderControl = h('div', 'seg-control')
  orderControl.setAttribute('role', 'group')
  orderControl.setAttribute('aria-label', 'Order')
  const orderButtons = ORDERS.map(([value, text, tip]) => {
    const button = h('button', '', text) as HTMLButtonElement
    button.type = 'button'
    button.dataset.tip = tip
    button.addEventListener('click', () => { order = value; drawList() })
    orderControl.append(button)
    return button
  })
  const listTools = h('div', 'filters')
  listTools.append(listChips, listCount, orderControl)
  listHead.append(h('h3', 'card-title', 'Trades'), listTools)
  const listTable = h('table', 'list') as HTMLTableElement
  const listScroll = h('div', 'scroll')
  listScroll.append(listTable)
  const listEmpty = h('div', 'list-empty')
  listCard.append(listHead, listScroll, listEmpty)

  function drawList(): void {
    const all = samples()
    orderButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(ORDERS[i]![0] === order)))

    listChips.replaceChildren()
    if (narrow !== null) {
      const chip = h('button', 'filter-chip') as HTMLButtonElement
      chip.type = 'button'
      chip.setAttribute('aria-label', 'Stop narrowing to ' + narrow.label)
      chip.append(icon('tag'), h('span', '', narrow.label), icon('x', 'icon x'))
      chip.addEventListener('click', () => { narrow = null; marks(); drawList() })
      listChips.append(chip)
    }

    const kept = narrow === null ? all : all.filter(narrow.keeps)
    listCount.textContent = narrow === null ? '' : `${kept.length} of ${all.length}`
    // Best and worst by R, and by the result for a trade with none; by grade,
    // A to C with the ungraded last, and the best R first within each.
    const score = (sample: Sample): number => r(sample) ?? returnOf(sample.trade) * 100
    const rank = (sample: Sample): number => sample.note.grade === null ? GRADES.length : GRADES.indexOf(sample.note.grade)
    const sorted = order === 'newest' ? kept
      : kept.toSorted((a, b) => order === 'best' ? score(b) - score(a)
        : order === 'worst' ? score(a) - score(b)
          : rank(a) - rank(b) || score(b) - score(a))

    listTable.replaceChildren()
    const head = listTable.createTHead().insertRow()
    const columns: [string, string][] = [
      ['Closed', ''], ['Symbol', ''], ['Grade', 'c-some'], ['Closed by', 'c-some'], ['Risk', 'num c-more'],
      ['R', 'num'], ['Result', 'num'], ['Mistakes', 'c-more'],
    ]
    for (const [text, className] of columns) {
      const th = h('th', className, text)
      th.setAttribute('scope', 'col')
      head.append(th)
    }
    const body = listTable.createTBody()
    for (const sample of sorted) {
      const { trade, note } = sample
      const row = body.insertRow()
      row.className = 'open'
      row.tabIndex = 0
      const result = returnOf(trade), multipleR = r(sample)
      row.setAttribute('aria-label', `${trade.symbol} ${side(trade.side).toLowerCase()}, closed ${when(closedAt(trade))}, ${rText(multipleR)}, ${signed(result)}`)

      const link = h('a', 'trade-link', day(closedAt(trade)) + ' ' + time(closedAt(trade))) as HTMLAnchorElement
      link.href = '#trade/' + encodeURIComponent(trade.positionId)
      link.tabIndex = -1
      link.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        event.preventDefault()
        shelf.open(trade.positionId)
      })
      row.insertCell().append(link)

      const symbol = row.insertCell()
      symbol.append(h('span', 'sym', trade.symbol), icon(trade.side === 'buy' ? 'long' : 'short', 'icon sym-side play-side'))

      const grade = h('td', 'c-some')
      if (note.grade !== null) grade.append(h('span', 'grade-badge', note.grade))
      row.append(grade)

      const kind = endedAs(trade)
      const by = h('td', 'c-some')
      const how = h('span', 'closed-by')
      how.append(h('i', 'dot ' + kind), CLOSED_BY[kind])
      by.append(how)
      row.append(by)

      const risk = riskShare(trade)
      row.append(h('td', 'num c-more', risk === null ? '—' : pct(risk)))
      row.append(h('td', 'num play-r ' + (multipleR === null ? '' : tone(multipleR)), rText(multipleR)))
      const cell = h('td', 'num')
      cell.append(h('span', 'result ' + tone(result), signed(result)))
      row.append(cell)

      const mistakes = h('td', 'c-more')
      const slugs = note.tags.filter((one) => vocabulary.kindOf(one) === 'mistake')
      if (slugs.length > 0) {
        const chips = h('span', 'marks')
        for (const one of slugs) chips.append(h('span', 'chip kind-mistake', vocabulary.label(one)))
        mistakes.append(chips)
      }
      row.append(mistakes)

      row.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('a') !== null) return
        shelf.open(trade.positionId)
      })
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target === row) { event.preventDefault(); shelf.open(trade.positionId) }
      })
    }

    listScroll.hidden = sorted.length === 0
    listEmpty.hidden = sorted.length > 0
    listEmpty.replaceChildren(h('p', '', all.length === 0 ? 'No trades with this play yet.' : 'No trades in this group.'))
  }

  /** Bring the list into view, as the thing a group pressed above it just changed. */
  function reveal(): void {
    const at = listCard.getBoundingClientRect().top
    if (at > innerHeight * 0.6 || at < 0) listCard.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  // ── the page ─────────────────────────────────────────────────────────────

  function draw(): void {
    stopCurve()
    const all = samples()
    const edge = edgeOf(all)
    panel.setAttribute('aria-label', vocabulary.label(slug) + ', play')
    // A group narrowing the list may have emptied since: a tag taken off its trades.
    if (narrow !== null && !all.some(narrow.keeps)) narrow = null

    // Which version works leads, grades first: whether the A's beat the rest,
    // and were pressed harder, is the question a playbook is kept to answer.
    // Then whether it is still working and what its outcomes look like, beside
    // how you run it; then the trades.
    const history = h('div', 'trade-col')
    history.append(curve(all.toSorted(byClose), edge), outcomes(edge))
    const conduct = h('div', 'trade-col')
    conduct.append(running(all))
    const body = h('div', 'trade-body')
    body.append(history, conduct)
    panel.replaceChildren(top(), header(all, edge), tiles(all, edge), versions(all), body, listCard)
    drawList()
    marks()
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') { shelf.close(); return }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); shelf.step(-1) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); shelf.step(1) }
  }
  panel.addEventListener('keydown', onKey)

  draw()
  return {
    node: panel,
    settled: async () => true,
    refresh: draw,
    pause: () => {},
    key: onKey,
  }
}
