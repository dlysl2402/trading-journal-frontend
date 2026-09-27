/**
 * Draws the journal into the page.
 *
 * This was an inline script inside a template string that the backend filled
 * in and wrote to disk. It became a module the browser loads, which is why it
 * reads as a script that runs once rather than as components: it is handed
 * every closed trade and works the figures out itself — win rate, profit
 * factor, drawdown, the calendar. Nothing is stored, so nothing can drift from
 * the record.
 *
 * It takes the `Journal` as it stands in memory. There is no JSON in between:
 * the page used to be a string the backend substituted data into, and the flat
 * row that fed it was a shape that only existed to survive that trip.
 *
 * The margin comes in beside it rather than inside it. Layers 2 and 3 are
 * rebuilt from the record every load so they cannot drift from it; what you
 * wrote is the one thing on the page that is kept rather than derived, and
 * keeping it out of the `Journal` is what stops the two being confused.
 *
 * What it draws itself is the overview's figures: the greeting, the headline
 * return, the six tiles and how the trades were run. The larger pieces each
 * have a module of their own — the curve in `chart.ts`, the calendar in
 * `calendar.ts`, the list in `table.ts`, the review queue in `queue.ts`, the
 * breakdown by tag in `insights.ts` — and this is where they are wired to one
 * another: a day on the calendar narrows the list, a point on the curve opens
 * a trade, and a save anywhere redraws everything that counts written-up
 * trades. `tabs.ts` owns the tab a trade opens in, and `trade.ts` what is
 * drawn in it.
 */

import { drawCalendar } from './calendar.ts'
import type { Day } from './calendar.ts'
import { drawCurve } from './chart.ts'
import { h, must } from './dom.ts'
import type { Entry } from './filter.ts'
import { CLOSED_HOW, formatters } from './format.ts'
import { createInsights } from './insights.ts'
import type { Journal, Trade } from './journal.ts'
import type { Margin } from './margin.ts'
import { isBlank } from './margin.ts'
import { createQueue } from './queue.ts'
import { createSettings } from './settings.ts'
import { createTable } from './table.ts'
import type { Tabs } from './tabs.ts'
import { createTabs } from './tabs.ts'
import type { Vocabulary } from './tags.ts'
import { tipMark } from './tips.ts'
import type { EquityPoint } from './view.ts'
import { costsOf, endedAs, equityCurve, returnOf, stopAt } from './view.ts'

/** A point that is a closed trade, rather than the zero the curve starts on. */
type ClosedPoint = EquityPoint & { trade: Trade }

export function drawPage(journal: Journal, margin: Margin, vocabulary: Vocabulary): void {
  // Formatting, made once and handed to every piece so all of them write a
  // figure the same way.
  const format = formatters()
  const { day, dateOf, duration, fixed, pct, plural, signed, tone, utc } = format

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

  // The list's order, newest first: the table reads this way, the tabs step
  // this way, and the review queue offers trades in it.
  const shown = [...trades].reverse()
  const entries: Entry[] = shown.map((p) => ({ trade: p.trade, result: result(p), day: dateOf(p.time) }))

  // ── the top of the page ──────────────────────────────────────────────────

  const account = must('sub')
  account.textContent = '#' + journal.account.id + ' · ' + journal.account.currency
  account.dataset.tip = journal.account.broker
  account.hidden = false

  const now = new Date()
  const hour = now.getHours()
  must('today').textContent = now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
  must('greeting').textContent = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening'

  // The headline: where the account stands, from trading alone.
  const headline = must('net')
  headline.textContent = signed(net)
  headline.className = 'hero ' + tone(net)
  must('growth-title').append(tipMark('Every trade’s return compounded, after costs.'))
  must('net-note').textContent = trades.length ? `${day(first!.time)} – ${day(last!.time)}` : 'No trades yet'

  const readout = must('readout')
  const read = (key: string, value: string, tip?: string): void => {
    const dt = h('dt', '', key)
    if (tip !== undefined) dt.append(tipMark(tip))
    readout.append(dt, h('dd', '', value))
  }
  read('Trades', trades.length ? trades.length + ' over ' + plural(days.length, 'day') : '—')
  read('Costs', costShare === null ? '—' : pct(costShare) + ' of gross',
    'Commission and swap, as a share of what the trades made before them.')
  if (journal.serverUtcOffsetMinutes !== null) {
    read('Clock', utc(journal.serverUtcOffsetMinutes),
      'Every time on this page is the broker’s clock, the one your terminal shows.')
  }

  // ── six figures, each with the plain-words version underneath ────────────

  const tiles = must('tiles')
  const tile = (label: string, value: string, valueTone: string, note: string, tip: string, extra?: HTMLElement): void => {
    const node = h('div', 'stat card')
    const head = h('div', 'stat-label', label)
    head.append(tipMark(tip))
    node.append(head, h('div', 'stat-value ' + valueTone, value))
    if (extra !== undefined) node.append(extra)
    if (note !== '') node.append(h('div', 'stat-note', note))
    tiles.append(node)
  }

  const meter = h('div', 'meter')
  meter.setAttribute('aria-hidden', 'true')
  for (const [count, className] of [[winners.length, 'up'], [trades.length - winners.length - losers.length, 'flat'], [losers.length, 'down']] as const) {
    if (count === 0) continue
    const segment = h('i', className)
    segment.style.flexGrow = String(count)
    meter.append(segment)
  }

  tile('Win rate',
    winRate === null ? '—' : Math.round(100 * winRate) + '%', '',
    trades.length === 0 ? 'No trades yet' : winners.length + ' of ' + plural(trades.length, 'trade'),
    'The share of trades that closed in profit, after costs. ' + greenDays + ' of ' + plural(days.length, 'day') + ' were green.',
    trades.length ? meter : undefined)
  tile('Profit factor',
    fixed(profitFactor), profitFactor === null ? '' : tone(profitFactor - 1),
    profitFactor === null ? 'Needs a win and a loss' : signed(won) + ' / ' + signed(-lost),
    'Everything won divided by everything lost. Above 1 means the winners outweigh the losers.')
  tile('Win / loss size',
    fixed(payoff), payoff === null ? '' : tone(payoff - 1),
    payoff === null ? 'Needs a win and a loss' : signed(avgWin!) + ' / ' + signed(-avgLoss!),
    'The average winner divided by the average loser. Above 1 means your wins are bigger than your losses.')
  tile('Expectancy',
    expectancy === null ? '—' : signed(expectancy), expectancy === null ? '' : tone(expectancy),
    '',
    'What an average trade adds to the account after costs: how often you win and by how much, together.')
  tile('Max drawdown',
    drawdown.amount ? '−' + pct(drawdown.amount) : pct(0), drawdown.amount ? 'down' : '',
    drawdown.amount ? day(drawdown.from) + ' – ' + day(drawdown.to) : 'No high given back yet',
    'The deepest fall from a high point on the curve, before the account made a new high.')

  // The streak, with the last few trades drawn beside it: a bar up for a win,
  // down for a loss, as tall as the result.
  const recent = trades.slice(-16)
  const biggest = Math.max(...recent.map((p) => Math.abs(result(p))), 1e-9)
  const form = h('div', 'form')
  for (const p of recent) {
    const value = result(p)
    const bar = h('i', tone(value))
    bar.style.setProperty('--size', (Math.abs(value) / biggest).toFixed(3))
    bar.dataset.tip = p.trade.symbol + ' · ' + signed(value)
    form.append(bar)
  }
  tile('Streak',
    streak ? plural(streak.length, streak.kind, streak.kind === 'win' ? 'wins' : 'losses') : '—',
    streak ? (streak.kind === 'win' ? 'up' : 'down') : '',
    'Longest ' + plural(longestWin, 'win') + ' · ' + plural(longestLoss, 'loss', 'losses'),
    'Your current run of wins or losses. A trade that breaks even ends a run. The bars are your last trades, oldest first.',
    recent.length ? form : undefined)

  // ── how the trades were run, from the broker's own fields ─────────────────

  const habits = must('habits')
  const bucket = (list: ClosedPoint[]) =>
    ({ count: list.length, net: sum(list, result), wins: list.filter((p) => result(p) > 0).length })
  const section = (title: string, tip: string): HTMLElement => {
    const node = h('section', 'habit')
    const heading = h('h3', '', title)
    heading.append(tipMark(tip))
    node.append(heading)
    habits.append(node)
    return node
  }
  const duo = (into: HTMLElement, cells: [string, string, string][]): void => {
    const row = h('div', 'duo')
    for (const [value, valueTone, note] of cells) {
      const cell = h('div')
      cell.append(h('div', 'duo-value ' + valueTone, value), h('div', 'duo-note', note))
      row.append(cell)
    }
    into.append(row)
  }

  const closing = section('How trades closed', 'Whether you closed each trade yourself, or the stop or target you left with the broker did.')
  if (trades.length === 0) {
    closing.append(h('p', 'empty', 'Fills in as trades close.'))
  } else {
    const bar = h('div', 'bar')
    bar.setAttribute('aria-hidden', 'true')
    const legend = h('ul', 'legend')
    for (const kind of ['manual', 'stop', 'target'] as const) {
      const b = bucket(trades.filter((p) => endedAs(p.trade) === kind))
      if (b.count === 0) continue
      const seg = h('span', 'seg ' + kind)
      seg.style.flexGrow = String(b.count)
      bar.append(seg)
      const item = h('li')
      const name = h('span', 'legend-name')
      name.append(h('b', '', CLOSED_HOW[kind]), ' ' + plural(b.count, 'trade') + ', ' + plural(b.wins, 'win'))
      item.append(h('i', 'swatch ' + kind), name, h('span', 'legend-net ' + tone(b.net), signed(b.net)))
      legend.append(item)
    }
    closing.append(bar, legend)
  }

  const naked = bucket(trades.filter((p) => stopAt(p.trade) === null))
  const covered = bucket(trades.filter((p) => stopAt(p.trade) !== null))
  duo(section('Stop in place', 'Whether a stop was on the trade when it closed.'), [
    [String(covered.count), '', 'with a stop · ' + signed(covered.net)],
    [String(naked.count), naked.count ? 'warn' : '', 'without · ' + signed(naked.net)],
  ])

  duo(section('Median hold', 'How long the middle trade was held, winners and losers apart. Losers held longer than winners is worth a look.'), [
    [winners.length ? duration(median(winners.map(hold))!) : '—', '', 'winners'],
    [losers.length ? duration(median(losers.map(hold))!) : '—', '', 'losers'],
  ])

  const longs = bucket(trades.filter((p) => p.trade.side === 'buy'))
  const shorts = bucket(trades.filter((p) => p.trade.side === 'sell'))
  duo(section('Long vs short', 'What each direction added up to, and how often it won.'), [
    [signed(longs.net), tone(longs.net), plural(longs.count, 'long') + ', ' + plural(longs.wins, 'win')],
    [signed(shorts.net), tone(shorts.net), plural(shorts.count, 'short') + ', ' + plural(shorts.wins, 'win')],
  ])

  // ── the pieces that talk to each other ───────────────────────────────────

  // Assigned below; everything that calls these runs after it is.
  let tabs: Tabs
  const open = (positionId: string): void => { tabs.open(positionId) }

  const calendar = drawCalendar(must('calendar'), days, format, (date) => { list.showDay(date) })
  const list = createTable(entries, {
    format, margin, vocabulary, open,
    dayChanged: (date) => { calendar.select(date) },
  })

  const nextToReview = (): void => {
    const next = shown.find((p) => isBlank(margin.get(p.trade.positionId)))
    if (next !== undefined) open(next.trade.positionId)
  }
  const queue = createQueue(must('queue'), shown.map((p) => p.trade), {
    format, margin, open,
    showAll: () => { list.showUnreviewed() },
  })
  const insights = createInsights(must('insights'),
    entries.map((entry) => ({ result: entry.result, positionId: entry.trade.positionId })), {
      format, margin, vocabulary, review: nextToReview,
      pick: (group) => { list.showGroup(group) },
    })

  drawCurve(must<SVGSVGElement>('chart'), must('tooltip'), points, format, open)

  tabs = createTabs(shown.map((p) => p.trade), format, margin, vocabulary, (positionId) => {
    list.mark(positionId)
    list.refilter()
    queue.redraw()
    insights.redraw()
  })

  // Renaming a tag in the settings changes what every row should say, and
  // what every open trade offers to pick from.
  const settings = createSettings(vocabulary, () => {
    list.markAll()
    list.refilter()
    insights.redraw()
    tabs.refresh()
  })
  must('tags-button').addEventListener('click', () => settings.open())
  must('brand').addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    tabs.home()
  })

  // The entrance plays once, on the first paint, not every time the overview
  // comes back from behind a trade.
  const overview = must('overview')
  overview.classList.add('intro')
  setTimeout(() => overview.classList.remove('intro'), 1400)
}
