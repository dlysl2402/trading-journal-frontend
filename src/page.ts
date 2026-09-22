/**
 * Draws the journal into the page.
 *
 * This was an inline script inside a template string that the backend filled
 * in and wrote to disk. It is the same code, now a module the browser loads,
 * which is why it reads as a script that runs once rather than as components:
 * it is handed every closed trade and works the figures out itself — win rate,
 * profit factor, drawdown, the calendar. Nothing is stored, so nothing can
 * drift from the record.
 *
 * It takes the `Journal` as it stands in memory. There is no JSON in between:
 * the page used to be a string the backend substituted data into, and the flat
 * row that fed it was a shape that only existed to survive that trip.
 *
 * The margin comes in beside it rather than inside it. Layers 2 and 3 are
 * rebuilt from the record every load so they cannot drift from it; what you
 * wrote is the one thing on the page that is kept rather than derived, and
 * keeping it out of the `Journal` is what stops the two being confused.
 * `tabs.ts` owns the tab a row opens, and `trade.ts` what is drawn in it.
 */

import { h, must } from './dom.ts'
import { createTabs } from './tabs.ts'
import { formatters } from './format.ts'
import type { ExitReason, Journal, Trade } from './journal.ts'
import type { Margin } from './margin.ts'
import { isBlank } from './margin.ts'
import { createSettings } from './settings.ts'
import type { Vocabulary } from './tags.ts'
import type { EquityPoint } from './view.ts'
import { costsOf, endedAs, equityCurve, exitPrice, returnOf, stopAt } from './view.ts'

/** A point that is a closed trade, rather than the zero the curve starts on. */
type ClosedPoint = EquityPoint & { trade: Trade }

interface Day {
  date: string
  net: number
  count: number
}

export function drawPage(journal: Journal, margin: Margin, vocabulary: Vocabulary): void {
  // Formatting, made once and handed to the trade panels so both write a
  // figure the same way.
  const format = formatters()
  const { day, dateOf, duration, fixed, pct, plural, price, signed, tone, utc, when } = format

  // The figures, all worked out from the trades on the page.
  const points = equityCurve(journal.trades)
  const first = points[0], last = points[points.length - 1]
  const trades = points.filter((p): p is ClosedPoint => p.trade !== null)
  const sum = <T>(list: T[], pick: (item: T) => number) =>
    list.reduce((total, item) => total + pick(item), 0)
  // Every figure is a return: what a trade did to the account it was sized
  // against, as a fraction. Money appears nowhere on the page.
  const result = (p: ClosedPoint) => returnOf(p.trade)
  const ratio = (a: number, b: number) => (b === 0 ? null : a / b)
  const median = (values: number[]): number | null => {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const middle = sorted.length >> 1
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
  }

  const winners = trades.filter((p) => result(p) > 0)
  const losers = trades.filter((p) => result(p) < 0)
  // Where the account stands: every return compounded, as the curve draws it.
  const net = (last?.growth ?? 1) - 1
  const won = sum(winners, result), lost = -sum(losers, result)
  const winRate = ratio(winners.length, trades.length)
  const profitFactor = ratio(won, lost)
  const avgWin = ratio(won, winners.length), avgLoss = ratio(lost, losers.length)
  const payoff = avgWin !== null && avgLoss !== null ? ratio(avgWin, avgLoss) : null
  const expectancy = ratio(sum(trades, result), trades.length)
  // The one place costs are named: what share of gross P&L they took, in
  // total. Per trade the same figure only says how small the move was.
  const gross = sum(trades, (p) => p.trade.grossProfit)
  const costShare = ratio(-sum(trades, (p) => costsOf(p.trade)), Math.abs(gross))

  const days: Day[] = [...Map.groupBy(trades, (p) => dateOf(p.time))]
    .map(([date, list]) => ({ date, net: sum(list, result), count: list.length }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const greenDays = days.filter((d) => d.net > 0).length

  // Deepest fall from a high on the curve, as a share of that high.
  let peak = 1, peakAt = first?.time ?? new Date(0)
  let drawdown = { amount: 0, from: peakAt, to: peakAt }
  for (const p of points) {
    if (p.growth > peak) { peak = p.growth; peakAt = p.time }
    const fall = 1 - p.growth / peak
    if (fall > drawdown.amount) drawdown = { amount: fall, from: peakAt, to: p.time }
  }

  let streak: { kind: 'win' | 'loss'; length: number } | null = null
  let longestWin = 0, longestLoss = 0
  for (const p of trades) {
    const value = result(p)
    const kind = value > 0 ? 'win' : value < 0 ? 'loss' : null
    if (kind === null) { streak = null; continue }
    streak = streak && streak.kind === kind ? { kind, length: streak.length + 1 } : { kind, length: 1 }
    if (kind === 'win') longestWin = Math.max(longestWin, streak.length)
    else longestLoss = Math.max(longestLoss, streak.length)
  }

  const hold = (p: ClosedPoint) => p.time.getTime() - p.trade.entry.time.getTime()

  // Header.
  must('sub').textContent = [
    journal.account.id, journal.account.broker, journal.account.currency,
    trades.length ? day(first!.time) + ' – ' + day(last!.time) + ' · server time ' + utc(journal.serverUtcOffsetMinutes) : 'no closed trades yet',
  ].join(' · ')

  // Hero: where the account stands, from trading alone.
  const tiles = must('tiles')
  const hero = h('div', 'tile hero')
  const heroText = h('div')
  heroText.append(h('div', 'label', 'Net'), h('div', 'value ' + tone(net), signed(net)))
  hero.append(heroText)
  const readout = h('dl', 'readout')
  for (const [key, text] of [
    ['Trades', trades.length + ' over ' + plural(days.length, 'day')],
    ['Costs', costShare === null ? '—' : pct(costShare) + ' of gross'],
  ]) readout.append(h('dt', '', key), h('dd', '', text))
  hero.append(readout)
  tiles.append(hero)

  // Six figures, each with the plain-words version underneath.
  const tile = (label: string, value: string, valueTone: string, note: string) => {
    const node = h('div', 'tile')
    node.append(h('div', 'label', label), h('div', 'value ' + valueTone, value), h('div', 'note', note))
    return node
  }
  const figures: [string, string, string, string][] = [
    ['Win rate',
      winRate === null ? '—' : Math.round(100 * winRate) + '%', 'flat',
      plural(winners.length, 'win') + ' of ' + plural(trades.length, 'trade') + ' · ' + greenDays + ' of ' + plural(days.length, 'day') + ' green'],
    ['Profit factor',
      fixed(profitFactor), profitFactor === null ? 'flat' : tone(profitFactor - 1),
      profitFactor === null ? 'needs a win and a loss' : pct(won) + ' won for ' + pct(lost) + ' lost'],
    ['Avg win / loss',
      fixed(payoff), payoff === null ? 'flat' : tone(payoff - 1),
      payoff === null ? 'needs a win and a loss' : signed(avgWin!) + ' against ' + signed(-avgLoss!)],
    ['Expectancy',
      expectancy === null ? '—' : signed(expectancy), expectancy === null ? 'flat' : tone(expectancy),
      'per trade, after costs'],
    ['Max drawdown',
      drawdown.amount ? '−' + pct(drawdown.amount) : pct(0), drawdown.amount ? 'down' : 'flat',
      drawdown.amount ? 'from the high · ' + day(drawdown.from) + ' – ' + day(drawdown.to) : 'no high given back yet'],
    ['Streak',
      streak ? plural(streak.length, streak.kind, streak.kind === 'win' ? 'wins' : 'losses') : '—',
      streak ? (streak.kind === 'win' ? 'up' : 'down') : 'flat',
      'longest run: ' + plural(longestWin, 'win') + ', ' + plural(longestLoss, 'loss', 'losses')],
  ]
  for (const [label, value, valueTone, note] of figures) tiles.append(tile(label, value, valueTone, note))

  // The chart: growth against time, one point per closed trade, on a log
  // axis so that equal heights are equal percentages wherever they fall.
  // Everything is worked in percent from the start, which the axis is
  // labelled in; `y` takes the log on the way to a pixel.
  const W = 880, H = 320, M = { top: 16, right: 96, bottom: 32, left: 64 }
  const svg = must<SVGSVGElement>('chart')
  const NS = 'http://www.w3.org/2000/svg'
  const el = <K extends keyof SVGElementTagNameMap>(
    name: K, attrs: Record<string, string | number> = {}, parent: Element = svg,
  ): SVGElementTagNameMap[K] => {
    const node = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
    parent.append(node)
    return node
  }

  if (points.length > 1) {
    const t0 = first!.time.getTime(), t1 = last!.time.getTime()
    const from = (p: EquityPoint) => p.growth - 1
    const lo = Math.min(0, ...points.map(from))
    const hi = Math.max(0, ...points.map(from))
    const step = niceStep((hi - lo) / 4)
    const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step
    const ln = (v: number) => Math.log(1 + v)
    const x = (t: number) => M.left + (t - t0) / (t1 - t0) * (W - M.left - M.right)
    const y = (v: number) => H - M.bottom - (ln(v) - ln(yMin)) / (ln(yMax) - ln(yMin)) * (H - M.top - M.bottom)

    // A wash under the line that fades to nothing at the baseline, in either direction.
    const defs = el('defs')
    const gradient = el('linearGradient', { id: 'wash', x1: 0, x2: 0, y1: y(yMax), y2: y(yMin), gradientUnits: 'userSpaceOnUse' }, defs)
    const at = (y(0) - y(yMax)) / (y(yMin) - y(yMax))
    el('stop', { offset: 0, 'stop-color': 'var(--series)', 'stop-opacity': 0.22 }, gradient)
    el('stop', { offset: at, 'stop-color': 'var(--series)', 'stop-opacity': 0.02 }, gradient)
    el('stop', { offset: 1, 'stop-color': 'var(--series)', 'stop-opacity': 0.14 }, gradient)

    const grid = el('g', { class: 'grid' })
    for (let v = yMin; v <= yMax + step / 2; v += step) {
      if (Math.abs(v) > step / 2) el('line', { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v) }, grid)
      el('text', { class: 'tick', x: M.left - 10, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = signed(v)
    }
    el('line', { class: 'baseline', x1: M.left, x2: W - M.right, y1: y(0), y2: y(0) })

    const dayCount = Math.max(1, Math.round((t1 - t0) / 86400000))
    const every = Math.ceil(dayCount / 6)
    for (let d = 0; d <= dayCount; d += every) {
      const t = t0 + d * 86400000
      el('text', { class: 'tick', x: x(t), y: H - M.bottom + 20, 'text-anchor': 'middle' }).textContent = day(new Date(t))
    }

    const path = points.map((p, i) => (i ? 'L' : 'M') + x(p.time.getTime()).toFixed(1) + ' ' + y(from(p)).toFixed(1)).join(' ')
    el('path', { class: 'area draw', fill: 'url(#wash)', d: path + ' L' + x(t1).toFixed(1) + ' ' + y(0).toFixed(1) + ' L' + x(t0).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z' })
    const line = el('path', { class: 'line draw', d: path })
    line.style.setProperty('--length', String(line.getTotalLength()))
    el('circle', { class: 'halo draw', cx: x(t1), cy: y(from(last!)), r: 9 })
    el('circle', { class: 'end draw', cx: x(t1), cy: y(from(last!)), r: 4.5 })
    el('text', { class: 'end-label draw', x: x(t1) + 14, y: y(from(last!)) + 4 }).textContent = signed(from(last!))

    // Hover: a crosshair that snaps to the nearest closed trade.
    const crosshair = el('line', { class: 'crosshair', y1: M.top, y2: H - M.bottom })
    const focus = el('circle', { class: 'focus', r: 4.5 })
    const tooltip = must<HTMLElement>('tooltip')
    const card = svg.parentElement!

    const show = (p: EquityPoint): void => {
      const px = x(p.time.getTime()), py = y(from(p))
      crosshair.setAttribute('x1', String(px)); crosshair.setAttribute('x2', String(px))
      focus.setAttribute('cx', String(px)); focus.setAttribute('cy', String(py))
      crosshair.style.display = focus.style.display = 'block'

      tooltip.replaceChildren(h('b', '', signed(from(p))))
      if (p.trade) {
        const detail = h('span', '', when(p.time) + ' · ' + p.trade.symbol + ' ' + p.trade.side + ' ')
        detail.append(h('span', 'net ' + tone(returnOf(p.trade)), signed(returnOf(p.trade))))
        tooltip.append(detail)
      } else {
        tooltip.append(h('span', '', when(p.time) + ' · first trade opened'))
      }
      tooltip.style.display = 'block'

      // SVG elements have no offsetLeft/offsetTop, so place it from bounding rects.
      const rect = svg.getBoundingClientRect(), cardRect = card.getBoundingClientRect()
      const scale = rect.width / W
      const left = rect.left - cardRect.left + px * scale
      const top = rect.top - cardRect.top + py * scale
      const flip = left > cardRect.width * 0.7
      tooltip.style.left = flip ? 'auto' : (left + 14) + 'px'
      tooltip.style.right = flip ? (cardRect.width - left + 14) + 'px' : 'auto'
      tooltip.style.top = (top - 12) + 'px'
    }
    const hide = (): void => {
      crosshair.style.display = focus.style.display = tooltip.style.display = 'none'
    }

    svg.addEventListener('pointermove', (event) => {
      const rect = svg.getBoundingClientRect()
      const t = t0 + ((event.clientX - rect.left) / rect.width * W - M.left) / (W - M.left - M.right) * (t1 - t0)
      let nearest = points[0]!
      for (const p of points) {
        if (Math.abs(p.time.getTime() - t) < Math.abs(nearest.time.getTime() - t)) nearest = p
      }
      show(nearest)
    })
    svg.addEventListener('pointerleave', hide)
  } else {
    svg.replaceWith(h('div', 'empty', 'The curve starts with the first closed trade.'))
  }

  // The calendar: one grid per month, Monday first, each week totalled on the right.
  const calendar = must('calendar')
  if (days.length === 0) {
    calendar.append(h('div', 'empty', 'Days fill in as trades close.'))
  } else {
    const byDate = new Map(days.map((d) => [d.date, d]))
    const dayCell = (d: Day | undefined) => {
      const cell = h('div', 'cal-cell ' + (d ? tone(d.net) : 'idle'))
      if (d) {
        cell.append(h('span', 'cal-n', signed(d.net)), h('span', 'cal-c', plural(d.count, 'trade')))
      }
      return cell
    }
    const weekCell = (week: { net: number; count: number }) => {
      const cell = h('div', 'cal-cell week ' + (week.count ? tone(week.net) : 'idle'))
      if (week.count) cell.append(h('span', 'cal-n', signed(week.net)), h('span', 'cal-c', plural(week.count, 'trade')))
      return cell
    }

    const start = new Date(days[0]!.date), end = new Date(days[days.length - 1]!.date)
    for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
         cursor <= end;
         cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
      const year = cursor.getUTCFullYear(), month = cursor.getUTCMonth()
      const inMonth = days.filter((d) => d.date.startsWith(cursor.toISOString().slice(0, 7)))

      const heading = h('div', 'month')
      heading.append(h('h3', '', cursor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })))
      heading.append(h('span', '', signed(sum(inMonth, (d) => d.net)) + ' · ' + plural(sum(inMonth, (d) => d.count), 'trade') + ' · ' +
        inMonth.filter((d) => d.net > 0).length + ' of ' + plural(inMonth.length, 'day') + ' green'))
      calendar.append(heading)

      const grid = h('div', 'cal')
      for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week']) grid.append(h('div', 'cal-head', name))

      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      let column = (cursor.getUTCDay() + 6) % 7
      let week = { net: 0, count: 0 }
      for (let i = 0; i < column; i++) grid.append(h('div', 'cal-cell blank'))
      for (let date = 1; date <= daysInMonth; date++) {
        const d = byDate.get(dateOf(new Date(Date.UTC(year, month, date))))
        const cell = dayCell(d)
        cell.prepend(h('span', 'cal-d', String(date)))
        grid.append(cell)
        if (d) { week.net += d.net; week.count += d.count }
        if (++column === 7) { grid.append(weekCell(week)); week = { net: 0, count: 0 }; column = 0 }
      }
      if (column > 0) {
        for (; column < 7; column++) grid.append(h('div', 'cal-cell blank'))
        grid.append(weekCell(week))
      }
      calendar.append(grid)
    }
  }

  // Habits: what the broker's own fields say about how the trades were run.
  const habits = must('habits')
  const bucket = (list: ClosedPoint[]) =>
    ({ count: list.length, net: sum(list, result), wins: list.filter((p) => result(p) > 0).length })
  const pair = (label: string, a: [string, string, string], b: [string, string, string]) => {
    const node = h('div', 'tile')
    node.append(h('div', 'label', label))
    const row = h('div', 'pair')
    for (const [value, valueTone, note] of [a, b]) {
      const cell = h('div')
      cell.append(h('div', 'value ' + valueTone, value), h('div', 'note', note))
      row.append(cell)
    }
    node.append(row)
    return node
  }

  const ended: Record<ExitReason['kind'], string> = { manual: 'By hand', stop: 'Stop', target: 'Target' }
  const exits = h('div', 'tile wide')
  exits.append(h('div', 'label', 'How trades ended'))
  const bar = h('div', 'bar'), legend = h('ul', 'legend')
  for (const kind of ['manual', 'stop', 'target'] as const) {
    const b = bucket(trades.filter((p) => endedAs(p.trade) === kind))
    if (b.count === 0) continue
    const seg = h('span', 'seg ' + kind)
    seg.style.flex = String(b.count)
    bar.append(seg)
    const item = h('li')
    item.append(h('i', 'seg ' + kind), h('b', '', ended[kind]), h('span', '', plural(b.count, 'trade') + ', ' + plural(b.wins, 'win')))
    item.append(h('span', 'net ' + tone(b.net), signed(b.net)))
    legend.append(item)
  }
  exits.append(bar, legend)
  if (trades.length === 0) exits.append(h('div', 'note', 'Fills in as trades close.'))
  habits.append(exits)

  const naked = bucket(trades.filter((p) => stopAt(p.trade) === null))
  const covered = bucket(trades.filter((p) => stopAt(p.trade) !== null))
  habits.append(pair('Stop in place',
    [String(covered.count), 'flat', 'with a stop · ' + signed(covered.net)],
    [String(naked.count), naked.count ? 'warn' : 'flat', 'without · ' + signed(naked.net)]))

  habits.append(pair('Hold time, median',
    [winners.length ? duration(median(winners.map(hold))!) : '—', 'flat', 'winners'],
    [losers.length ? duration(median(losers.map(hold))!) : '—', 'flat', 'losers']))

  const longs = bucket(trades.filter((p) => p.trade.side === 'buy'))
  const shorts = bucket(trades.filter((p) => p.trade.side === 'sell'))
  const sides = pair('Long / short',
    [signed(longs.net), tone(longs.net), plural(longs.count, 'long') + ', ' + plural(longs.wins, 'win')],
    [signed(shorts.net), tone(shorts.net), plural(shorts.count, 'short') + ', ' + plural(shorts.wins, 'win')])
  sides.classList.add('wide')
  habits.append(sides)

  // The table: every fact the page used, with no hovering required — and the
  // way into a trade, because a row is where you go to write about one.
  const shown = [...trades].reverse()

  /** How each row redraws its own mark, so a save does not rebuild the table. */
  const marks = new Map<string, () => void>()
  const tally = must('written')
  const countWritten = (): void => {
    tally.textContent = trades.length === 0 ? ''
      : margin.written() + ' of ' + plural(trades.length, 'trade') + ' written up'
  }

  const tabs = createTabs(shown.map((p) => p.trade), format, margin, vocabulary, (positionId) => {
    marks.get(positionId)?.()
    countWritten()
  })

  // Renaming a tag in the settings changes what every row should say, and
  // what every open trade offers to pick from.
  const settings = createSettings(vocabulary, () => {
    for (const redraw of marks.values()) redraw()
    tabs.refresh()
  })
  must('tags-button').addEventListener('click', () => settings.open())

  /**
   * What you have written against a trade, at a glance: the grade, the play —
   * or the first tag if it has no play — how many more tags there are, and a
   * mark when there is a note under them. Only one tag, because the column
   * has to fit beside ten of the broker's own figures; the rest are a click
   * away, where there is room for them.
   */
  const noteCell = (trade: Trade): HTMLElement => {
    const cell = h('td', 'mine')
    const redraw = (): void => {
      const note = margin.get(trade.positionId)
      cell.replaceChildren()
      // The mark keeps its place whether or not there is a note, so the column
      // reads as a line of them and the gaps are what you notice.
      cell.append(h('span', 'dot' + (note.text.trim() === '' ? ' off' : '')))
      if (note.grade !== null) cell.append(h('span', 'grade-mark', note.grade))
      const play = note.tags.find((slug) => vocabulary.kindOf(slug) === 'play')
      const first = play ?? note.tags[0]
      if (first !== undefined) cell.append(h('span', 'chip' + (play ? ' play' : ''), vocabulary.label(first)))
      if (note.tags.length > 1) cell.append(h('span', 'chip more', '+' + (note.tags.length - 1)))
      if (isBlank(note)) cell.append(h('span', 'invite', 'Write'))
    }
    redraw()
    marks.set(trade.positionId, redraw)
    return cell
  }

  const table = must<HTMLTableElement>('table')
  const head = table.createTHead().insertRow()
  for (const [text, num] of [['Closed', 0], ['Symbol', 0], ['Side', 0], ['Lots', 1], ['Entry', 1], ['Exit', 1], ['Held', 1], ['Ended', 0], ['Stop', 1], ['Net', 1], ['Note', 0]] as [string, number][]) {
    head.append(h('th', num ? 'num' : '', text))
  }
  const body = table.createTBody()
  for (const p of shown) {
    const t = p.trade
    const stop = stopAt(t)
    const row = body.insertRow()
    // The date is a link to the trade's own address, so a middle click or a
    // ⌘-click opens it in a browser tab; a plain click opens it in one here.
    const link = h('a', 'trade-link', when(p.time)) as HTMLAnchorElement
    link.href = '#trade/' + encodeURIComponent(t.positionId)
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
      event.preventDefault()
      tabs.open(t.positionId)
    })
    row.insertCell().append(link)
    const symbol = row.insertCell()
    symbol.textContent = t.symbol
    if (t.tag) symbol.append(h('span', 'tag', t.tag))
    row.insertCell().append(h('span', 'side', t.side))
    row.append(h('td', 'num', String(t.entry.volume)))
    row.append(h('td', 'num', price.format(t.entry.price)))
    row.append(h('td', 'num', price.format(exitPrice(t))))
    row.append(h('td', 'num', duration(hold(p))))
    row.insertCell().textContent = ended[endedAs(t)]
    row.append(stop === null ? h('td', 'num none', 'none') : h('td', 'num', price.format(stop)))
    row.append(h('td', 'num ' + tone(result(p)), signed(result(p))))
    row.append(noteCell(t))

    row.classList.add('open')
    row.dataset.position = t.positionId
    row.tabIndex = 0
    row.addEventListener('click', (event) => {
      // The link handles its own clicks, modifier keys included.
      if (event.target instanceof Element && event.target.closest('a') !== null) return
      tabs.open(t.positionId)
    })
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target === row) { event.preventDefault(); tabs.open(t.positionId) }
    })
  }
  if (trades.length === 0) {
    body.insertRow().insertCell().textContent = 'No closed trades yet.'
  }
  countWritten()
}

function niceStep(rough: number): number {
  if (rough <= 0) return 1
  const power = Math.pow(10, Math.floor(Math.log10(rough)))
  const unit = rough / power
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power
}
