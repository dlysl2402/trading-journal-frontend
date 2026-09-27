/**
 * The calendar: a month at a time, Monday first, each week totalled on the
 * right.
 *
 * A day's colour says which way it went and, in three steps, how far; the
 * figure printed in it says exactly, so the colour is never the only way to
 * read it. A day with trades is a button: it narrows the list of trades to
 * that day, and pressing it again lets the list go.
 *
 * It opens on the latest month and pages back from there, so a journal a year
 * long is still one card tall rather than twelve.
 */

import { h } from './dom.ts'
import type { Format } from './format.ts'
import { icon } from './icons.ts'

export interface Day {
  /** YYYY-MM-DD on the broker's clock. */
  date: string
  net: number
  count: number
}

export interface Calendar {
  /** Light one day, or none — kept in step with the list's own filter. */
  select: (date: string | null) => void
}

interface Month {
  /** YYYY-MM. */
  key: string
  title: string
  summary: HTMLElement
  grid: HTMLElement
}

export function drawCalendar(
  root: HTMLElement, days: Day[], format: Format, pick: (date: string | null) => void,
): Calendar {
  const { dateOf, plural, signed, tone, weekday } = format
  const buttons = new Map<string, HTMLButtonElement>()
  let selected: string | null = null

  if (days.length === 0) {
    root.append(h('p', 'empty', 'Days fill in here as your trades close.'))
    return { select() {} }
  }

  const byDate = new Map(days.map((d) => [d.date, d]))
  const largest = Math.max(...days.map((d) => Math.abs(d.net)))
  /** Three steps of colour: up to a third of the biggest day, up to two thirds, and the rest. */
  const level = (net: number): number =>
    largest === 0 ? 1 : Math.min(3, Math.max(1, Math.ceil(3 * Math.abs(net) / largest)))
  // Today on your own calendar. The broker's clock can run a day ahead of it,
  // which is why only an empty day is ever drawn as still to come.
  const now = new Date()
  const today = dateOf(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))

  const figure = (cell: HTMLElement, net: number, count: number): void => {
    cell.append(h('span', 'cal-n', signed(net)), h('span', 'cal-c', plural(count, 'trade')))
  }

  const months: Month[] = []
  const start = new Date(days[0]!.date), end = new Date(days[days.length - 1]!.date)
  for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
       cursor <= end;
       cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
    const year = cursor.getUTCFullYear(), month = cursor.getUTCMonth()
    const key = cursor.toISOString().slice(0, 7)
    const inMonth = days.filter((d) => d.date.startsWith(key))
    const sum = (of: (d: Day) => number) => inMonth.reduce((total, d) => total + of(d), 0)

    const summary = h('span', 'month-sum')
    summary.append(h('b', tone(sum((d) => d.net)), signed(sum((d) => d.net))),
      ' · ' + plural(sum((d) => d.count), 'trade'))

    const grid = h('div', 'cal')
    for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week']) grid.append(h('div', 'cal-head', name))

    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    let column = (cursor.getUTCDay() + 6) % 7
    let week = { net: 0, count: 0 }
    const closeWeek = (): void => {
      const cell = h('div', 'cal-cell week' + (week.count ? ' ' + tone(week.net) : ''))
      if (week.count) figure(cell, week.net, week.count)
      grid.append(cell)
      week = { net: 0, count: 0 }
    }

    for (let i = 0; i < column; i++) grid.append(h('div', 'cal-cell blank'))
    for (let date = 1; date <= daysInMonth; date++) {
      const at = new Date(Date.UTC(year, month, date))
      const day = dateOf(at)
      const d = byDate.get(day)
      const mark = day === today ? ' today' : ''
      if (d === undefined) {
        const cell = h('div', 'cal-cell idle' + (column >= 5 ? ' weekend' : '') + (day > today ? ' future' : '') + mark)
        cell.append(h('span', 'cal-d', String(date)))
        grid.append(cell)
      } else {
        const cell = h('button', `cal-cell ${tone(d.net)} l${level(d.net)}${mark}`) as HTMLButtonElement
        cell.type = 'button'
        cell.setAttribute('aria-pressed', 'false')
        cell.setAttribute('aria-label', `${weekday(at)}: ${signed(d.net)}, ${plural(d.count, 'trade')}. Show these trades.`)
        cell.append(h('span', 'cal-d', String(date)))
        figure(cell, d.net, d.count)
        cell.addEventListener('click', () => {
          const next = selected === day ? null : day
          select(next)
          pick(next)
        })
        buttons.set(day, cell)
        grid.append(cell)
        week.net += d.net
        week.count += d.count
      }
      if (++column === 7) { closeWeek(); column = 0 }
    }
    if (column > 0) {
      for (; column < 7; column++) grid.append(h('div', 'cal-cell blank'))
      closeWeek()
    }
    months.push({ key, title: cursor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }), summary, grid })
  }

  // ── a month at a time ────────────────────────────────────────────────────

  const title = h('h2', '')
  const summaryBox = h('div', 'month-summary')
  const turn = (iconName: 'chevron-left' | 'chevron-right', by: number, label: string): HTMLButtonElement => {
    const button = h('button', 'icon-btn') as HTMLButtonElement
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.dataset.tip = label
    button.append(icon(iconName))
    button.addEventListener('click', () => show(showing + by))
    return button
  }
  const back = turn('chevron-left', -1, 'Earlier month')
  const on = turn('chevron-right', 1, 'Later month')
  const head = h('div', 'month-head')
  const pager = h('div', 'month-pager')
  pager.append(back, title, on)
  if (months.length === 1) { back.hidden = true; on.hidden = true }
  head.append(pager, summaryBox)
  root.append(head)
  const frame = h('div', 'month-frame')
  frame.setAttribute('aria-live', 'polite')
  root.append(frame)

  let showing = months.length - 1
  function show(index: number): void {
    showing = Math.max(0, Math.min(months.length - 1, index))
    const month = months[showing]!
    title.textContent = month.title
    summaryBox.replaceChildren(month.summary)
    frame.replaceChildren(month.grid)
    back.disabled = showing === 0
    on.disabled = showing === months.length - 1
  }
  show(showing)

  function select(date: string | null): void {
    selected = date
    for (const [day, button] of buttons) {
      button.classList.toggle('on', day === date)
      button.setAttribute('aria-pressed', String(day === date))
    }
    // A day picked from somewhere else brings its month with it.
    if (date !== null) {
      const index = months.findIndex((m) => date.startsWith(m.key))
      if (index >= 0 && index !== showing) show(index)
    }
  }

  return { select }
}
