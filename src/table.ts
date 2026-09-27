/**
 * The list of trades: every one, newest first, under the day it closed — and
 * the way into each, because a row is where you go to write one up.
 *
 * Rows are built once. The filter hides and shows them rather than rebuilding
 * the table, and a save redraws only its own row's review column, so the
 * scroll position, the focus and a half-typed search all survive both. Each
 * day is a `<tbody>` of its own with a header row, so a day whose trades are
 * all filtered away goes with them, and a day that stays is re-summed over
 * the trades that are left.
 */

import { h, must } from './dom.ts'
import type { Entry, Filter } from './filter.ts'
import { EVERYTHING, matches, narrows } from './filter.ts'
import type { Format } from './format.ts'
import { CLOSED_BY } from './format.ts'
import { icon } from './icons.ts'
import type { Trade } from './journal.ts'
import type { Margin } from './margin.ts'
import { hasWords, isBlank } from './margin.ts'
import type { Vocabulary } from './tags.ts'
import { GRADE_GUIDE, KINDS } from './tags.ts'
import { endedAs, exitPrice, stopAt } from './view.ts'

export interface TradeList {
  /** Redraw one row's review column, after a save. */
  mark: (positionId: string) => void
  /** Redraw every row's review column, after the vocabulary changed under them. */
  markAll: () => void
  /** Filter again, after a save changed what a row matches. */
  refilter: () => void
  /** Narrow to one day, or let the day go with null. */
  showDay: (day: string | null) => void
  /** Narrow to one group from the breakdown. */
  showGroup: (group: Filter['group']) => void
  /** Narrow to the trades waiting for a review. */
  showUnreviewed: () => void
}

export interface ListContext {
  format: Format
  margin: Margin
  vocabulary: Vocabulary
  open: (positionId: string) => void
  /** Told when the list lets go of a day itself, so the calendar can follow. */
  dayChanged: (day: string | null) => void
}

interface Row {
  entry: Entry
  node: HTMLTableRowElement
  redraw: () => void
}

/** @param entries every trade, newest first. */
export function createTable(entries: Entry[], context: ListContext): TradeList {
  const { format, margin, vocabulary, open, dayChanged } = context
  const { day, duration, plural, price, side, signed, time, tone, weekday, when } = format
  const words = { label: vocabulary.label, kindOf: vocabulary.kindOf }

  const card = must('trades')
  const bar = must('filters')
  const table = must<HTMLTableElement>('table')
  const empty = h('div', 'list-empty')
  empty.hidden = true
  table.after(empty)

  let filter: Filter = EVERYTHING
  const rows: Row[] = []
  const byId = new Map<string, Row>()

  // ── the filter bar ───────────────────────────────────────────────────────

  const search = h('label', 'search')
  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = 'Search'
  input.setAttribute('aria-label', 'Search trades')
  input.addEventListener('input', () => { filter = { ...filter, text: input.value }; apply() })
  search.append(icon('search'), input)

  /** Every control that shows the filter redraws itself from it through one of these. */
  const syncs: (() => void)[] = []

  /**
   * A pair of toggles for one field of the filter. Pressing one narrows to it,
   * pressing the other moves over, and pressing the lit one again lets go —
   * so "all" needs no button of its own, and no label to tell three of them apart.
   */
  function toggles<K extends 'result' | 'review' | 'side'>(
    label: string, key: K, options: [Exclude<Filter[K], 'all'>, string][],
  ): HTMLElement {
    const group = h('div', 'toggles')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', label)
    const buttons = options.map(([value, text]) => {
      const button = h('button', 'toggle', text) as HTMLButtonElement
      button.type = 'button'
      button.addEventListener('click', () => {
        filter = { ...filter, [key]: filter[key] === value ? 'all' : value }
        apply()
      })
      group.append(button)
      return button
    })
    syncs.push(() => buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(filter[key] === options[i]![0]))))
    return group
  }

  const review = toggles('Review', 'review', [['todo', 'To do'], ['done', 'Done']])
  const todoCount = h('span', 'seg-count')
  review.querySelector('button')!.append(todoCount)

  const chips = h('div', 'active-filters')
  const count = h('span', 'count')
  bar.append(chips, count, search,
    review,
    toggles('Result', 'result', [['win', 'Wins'], ['loss', 'Losses']]),
    toggles('Side', 'side', [['buy', 'Long'], ['sell', 'Short']]))

  /** What a group from the breakdown is called on its chip: "Play: Break and continue", "No mistake". */
  function groupText(group: NonNullable<Filter['group']>): string {
    const title = group.facet === 'grade' ? GRADE_GUIDE.title : KINDS.find((k) => k.kind === group.facet)!.title
    if (group.key === null) return 'No ' + title.toLowerCase()
    return title + ': ' + (group.facet === 'grade' ? group.key : vocabulary.label(group.key))
  }

  function drawChips(): void {
    const chip = (text: string, clear: () => void, iconName: 'calendar' | 'tag'): HTMLElement => {
      const node = h('button', 'filter-chip') as HTMLButtonElement
      node.type = 'button'
      node.setAttribute('aria-label', 'Stop filtering by ' + text)
      node.append(icon(iconName), h('span', '', text), icon('x', 'icon x'))
      node.addEventListener('click', () => { clear(); apply() })
      return node
    }
    chips.replaceChildren()
    if (filter.day !== null) {
      chips.append(chip(day(new Date(filter.day)), () => { filter = { ...filter, day: null }; dayChanged(null) }, 'calendar'))
    }
    if (filter.group !== null) {
      chips.append(chip(groupText(filter.group), () => { filter = { ...filter, group: null } }, 'tag'))
    }
    if (narrows(filter)) {
      const clear = h('button', 'link', 'Clear all') as HTMLButtonElement
      clear.type = 'button'
      clear.addEventListener('click', () => {
        const hadDay = filter.day !== null
        filter = EVERYTHING
        input.value = ''
        if (hadDay) dayChanged(null)
        apply()
      })
      chips.append(clear)
    }
  }

  // ── the rows ─────────────────────────────────────────────────────────────

  /**
   * What you have written against a trade, at a glance: the grade, the play —
   * or the first tag if it has no play — how many more tags there are, and a
   * mark when there is a note. Only one tag, because the column has to fit
   * beside ten of the broker's own figures; the rest are named on hover, and a
   * click away. A trade with nothing written says so, as an invitation.
   */
  function markCell(trade: Trade): { cell: HTMLTableCellElement; redraw: () => void } {
    const cell = h('td', 'mine') as HTMLTableCellElement
    const redraw = (): void => {
      const note = margin.get(trade.positionId)
      cell.replaceChildren()
      if (isBlank(note)) {
        const todo = h('span', 'todo')
        todo.dataset.tip = 'Not reviewed yet'
        todo.append(icon('pencil'))
        cell.append(todo)
        return
      }
      const marks = h('span', 'marks')
      if (note.grade !== null) marks.append(h('span', 'grade-badge', note.grade))
      const play = note.tags.find((slug) => vocabulary.kindOf(slug) === 'play')
      const first = play ?? note.tags[0]
      if (first !== undefined) {
        const chip = h('span', 'chip kind-' + (vocabulary.kindOf(first) ?? 'stray'), vocabulary.label(first))
        marks.append(chip)
      }
      if (note.tags.length > 1) {
        const more = h('span', 'more', '+' + (note.tags.length - 1))
        more.dataset.tip = note.tags.map(vocabulary.label).join(' · ')
        marks.append(more)
      }
      if (hasWords(note)) {
        const wrote = h('span', 'has-note')
        wrote.dataset.tip = 'Has a note'
        wrote.append(icon('note'))
        marks.append(wrote)
      }
      cell.append(marks)
    }
    redraw()
    return { cell, redraw }
  }

  const head = table.createTHead().insertRow()
  const columns: [string, string][] = [
    ['Time', ''], ['Symbol', ''], ['Side', 'c-some'], ['Lots', 'num c-more'], ['Entry', 'num c-more'], ['Exit', 'num c-more'],
    ['Held', 'num c-more'], ['Closed by', 'c-some'], ['Stop', 'num c-more'], ['Result', 'num'], ['Review', ''],
  ]
  for (const [text, className] of columns) {
    const th = h('th', className, text)
    th.setAttribute('scope', 'col')
    head.append(th)
  }

  /** One `<tbody>` per day, its header re-summed over whichever of its rows are showing. */
  const groups: { body: HTMLTableSectionElement; rows: Row[]; sum: HTMLElement }[] = []

  for (const [date, list] of Map.groupBy(entries, (entry) => entry.day)) {
    const body = table.createTBody()
    const header = body.insertRow()
    header.className = 'day-row'
    const th = h('th', '') as HTMLTableCellElement
    th.setAttribute('scope', 'rowgroup')
    th.colSpan = columns.length
    const line = h('div', 'day-head')
    const sum = h('span', 'day-sum')
    line.append(h('span', 'day-name', weekday(new Date(date))), sum)
    th.append(line)
    header.append(th)

    const members: Row[] = []
    for (const entry of list) {
      const t = entry.trade
      const closed = new Date(Math.max(...t.exits.map((exit) => exit.time.getTime())))
      const node = body.insertRow()
      node.className = 'open'
      node.dataset.position = t.positionId
      node.tabIndex = 0
      node.setAttribute('aria-label', `${t.symbol} ${side(t.side).toLowerCase()}, closed ${when(closed)}, ${signed(entry.result)}`)

      // The time is a link to the trade's own address, so a middle click or a
      // ⌘-click opens it in a browser tab; a plain click opens it in one here.
      const link = h('a', 'trade-link', time(closed)) as HTMLAnchorElement
      link.href = '#trade/' + encodeURIComponent(t.positionId)
      link.tabIndex = -1
      link.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        event.preventDefault()
        open(t.positionId)
      })
      node.insertCell().append(link)

      // On a phone the side column goes, and its arrow rides beside the symbol.
      const symbol = node.insertCell()
      symbol.append(h('span', 'sym', t.symbol), icon(t.side === 'buy' ? 'long' : 'short', 'icon sym-side'))

      const sidePill = h('span', 'side ' + t.side)
      sidePill.append(icon(t.side === 'buy' ? 'long' : 'short'), side(t.side))
      const sideCell = node.insertCell()
      sideCell.className = 'c-some'
      sideCell.append(sidePill)

      node.append(h('td', 'num c-more', String(t.entry.volume)))
      node.append(h('td', 'num c-more', price.format(t.entry.price)))
      node.append(h('td', 'num c-more', price.format(exitPrice(t))))
      node.append(h('td', 'num c-more', duration(closed.getTime() - t.entry.time.getTime())))

      const kind = endedAs(t)
      const by = h('td', 'c-some')
      const how = h('span', 'closed-by')
      how.append(h('i', 'dot ' + kind), CLOSED_BY[kind])
      by.append(how)
      node.append(by)

      const stop = stopAt(t)
      const stopCell = h('td', 'num c-more')
      if (stop === null) {
        const none = h('span', 'no-stop', 'None')
        none.dataset.tip = 'No stop was on this trade when it closed'
        stopCell.append(none)
      } else {
        stopCell.textContent = price.format(stop)
      }
      node.append(stopCell)

      const result = h('td', 'num')
      result.append(h('span', 'result ' + tone(entry.result), signed(entry.result)))
      node.append(result)

      const { cell, redraw } = markCell(t)
      node.append(cell)

      node.addEventListener('click', (event) => {
        // The link handles its own clicks, modifier keys included.
        if (event.target instanceof Element && event.target.closest('a') !== null) return
        open(t.positionId)
      })
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target === node) { event.preventDefault(); open(t.positionId) }
      })

      const row = { entry, node, redraw }
      rows.push(row)
      members.push(row)
      byId.set(t.positionId, row)
    }
    groups.push({ body, rows: members, sum })
  }

  if (entries.length === 0) {
    table.hidden = true
    bar.hidden = true
    empty.hidden = false
    empty.append(h('p', '', 'No closed trades yet.'))
  }

  // ── applying it ──────────────────────────────────────────────────────────

  function apply(): void {
    for (const sync of syncs) sync()
    drawChips()
    let showing = 0
    for (const group of groups) {
      let net = 0, left = 0
      for (const row of group.rows) {
        const shown = matches(row.entry, margin.get(row.entry.trade.positionId), filter, words)
        row.node.hidden = !shown
        if (shown) { net += row.entry.result; left++ }
      }
      group.body.hidden = left === 0
      group.sum.replaceChildren(plural(left, 'trade') + ' · ', h('b', tone(net), signed(net)))
      showing += left
    }
    count.textContent = narrows(filter) ? `${showing} of ${rows.length}` : ''

    const todo = rows.filter((row) => isBlank(margin.get(row.entry.trade.positionId))).length
    todoCount.textContent = todo ? String(todo) : ''

    if (rows.length > 0) {
      empty.hidden = showing > 0
      if (showing === 0) {
        const clear = h('button', 'btn secondary small', 'Clear filters') as HTMLButtonElement
        clear.type = 'button'
        clear.addEventListener('click', () => {
          const hadDay = filter.day !== null
          filter = EVERYTHING
          input.value = ''
          if (hadDay) dayChanged(null)
          apply()
        })
        empty.replaceChildren(h('p', '', 'No trades match these filters.'), clear)
      }
    }
  }

  /** Bring the list into view, as the thing a filter set from elsewhere just changed. */
  function reveal(): void {
    const top = card.getBoundingClientRect().top
    if (top > innerHeight * 0.6 || top < 0) card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  apply()

  return {
    mark(positionId) { byId.get(positionId)?.redraw() },
    markAll() { for (const row of rows) row.redraw() },
    refilter: apply,
    showDay(date) {
      filter = { ...filter, day: date }
      apply()
      if (date !== null) reveal()
    },
    showGroup(group) {
      filter = { ...filter, group }
      apply()
      reveal()
    },
    showUnreviewed() {
      filter = { ...EVERYTHING, review: 'todo' }
      input.value = ''
      dayChanged(null)
      apply()
      reveal()
    },
  }
}
