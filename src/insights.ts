/**
 * What's working: the trades you have written up, split by what you wrote.
 *
 * One facet at a time — grade, play, context, trigger or mistake — and for
 * each group how many trades, how often they won, what an average one did and
 * what they came to together. This is the payoff for tagging: the question a
 * tag was written to answer, answered. A row is also a way into the list: it
 * narrows the trades below to that group.
 *
 * It is redrawn after every save, since a grade or a tag moves a trade between
 * groups; the numbers are small and the table is short, so it is simply drawn
 * again rather than patched.
 */

import type { Facet, Group } from './breakdown.ts'
import { breakdown } from './breakdown.ts'
import { h } from './dom.ts'
import type { Filter } from './filter.ts'
import type { Format } from './format.ts'
import type { Margin } from './margin.ts'
import { isBlank } from './margin.ts'
import type { Vocabulary } from './tags.ts'
import { GRADE_GUIDE, KINDS } from './tags.ts'

/** Below this many trades a group's figures are noise, and the row says so. */
const FEW = 3

const FACETS: { facet: Facet; title: string; asks: string }[] = [
  { facet: 'grade', title: GRADE_GUIDE.title, asks: GRADE_GUIDE.asks },
  ...KINDS.map((k) => ({ facet: k.kind, title: k.title, asks: k.asks })),
]

export interface InsightsContext {
  format: Format
  margin: Margin
  vocabulary: Vocabulary
  /** Narrow the list to one group. */
  pick: (group: NonNullable<Filter['group']>) => void
  /** Open the next trade that has nothing written against it. */
  review: () => void
}

export function createInsights(
  root: HTMLElement, entries: { result: number; positionId: string }[], context: InsightsContext,
): { redraw: () => void } {
  const { format, margin, vocabulary, pick, review } = context
  const { plural, signed, tone } = format
  let facet: Facet = 'play'

  const control = h('div', 'seg-control')
  control.setAttribute('role', 'group')
  control.setAttribute('aria-label', 'Split by')
  const facetButtons = FACETS.map((f) => {
    const button = h('button', '', f.title) as HTMLButtonElement
    button.type = 'button'
    button.dataset.tip = f.asks
    button.addEventListener('click', () => { facet = f.facet; redraw() })
    control.append(button)
    return button
  })

  const head = h('header', 'card-head')
  head.append(h('h2', '', 'What’s working'), control)
  const body = h('div', 'facet-body')
  root.append(head, body)

  function nameOf(group: Group, title: string): HTMLElement {
    if (group.key === null) return h('span', 'none', 'No ' + title.toLowerCase())
    if (facet === 'grade') return h('span', 'grade-badge', group.key)
    const tag = vocabulary.get(group.key)
    const chip = h('span', 'chip kind-' + facet, vocabulary.label(group.key))
    if (tag?.archived) chip.classList.add('retired')
    return chip
  }

  function redraw(): void {
    const written = entries
      .map((entry) => ({ result: entry.result, note: margin.get(entry.positionId) }))
    const groups = breakdown(written, facet, vocabulary.kindOf)
    const reviewed = written.filter((w) => !isBlank(w.note)).length
    const current = FACETS.find((f) => f.facet === facet)!

    facetButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(FACETS[i]!.facet === facet)))

    if (reviewed === 0) {
      const empty = h('div', 'insights-empty')
      const start = h('button', 'btn primary', 'Review a trade') as HTMLButtonElement
      start.type = 'button'
      start.addEventListener('click', review)
      empty.append(h('p', '', 'Grade and tag a few trades to see which setups pay.'), start)
      body.replaceChildren(empty)
      return
    }

    // One scale for every bar, with zero wherever the groups need it to be:
    // at the left edge when every group made money, further in when some lost.
    const lo = Math.min(0, ...groups.map((g) => g.total))
    const hi = Math.max(0, ...groups.map((g) => g.total))
    const range = hi - lo || 1e-9
    const zero = (-lo / range * 100).toFixed(2) + '%'
    const table = h('table', 'facet-table')
    const headRow = (table as HTMLTableElement).createTHead().insertRow()
    for (const [text, className] of [[current.title, ''], ['Trades', 'num'], ['Win rate', 'num c-some'], ['Average', 'num c-some'], ['Total', 'total']]) {
      const th = h('th', className!, text)
      th.setAttribute('scope', 'col')
      headRow.append(th)
    }
    const tbody = (table as HTMLTableElement).createTBody()
    for (const group of groups) {
      const row = tbody.insertRow()
      row.className = 'pick' + (group.count < FEW ? ' thin' : '')
      const choose = h('button', 'group-name') as HTMLButtonElement
      choose.type = 'button'
      choose.append(nameOf(group, current.title))
      choose.setAttribute('aria-label', `Show the ${plural(group.count, 'trade')} in ${group.key === null ? 'no ' + current.title.toLowerCase() : vocabulary.label(group.key)}`)
      if (group.count < FEW) choose.dataset.tip = `Only ${plural(group.count, 'trade')} so far — too few to read much into`
      const go = (): void => pick({ facet, key: group.key })
      choose.addEventListener('click', (event) => { event.stopPropagation(); go() })
      row.addEventListener('click', go)
      row.insertCell().append(choose)

      row.append(h('td', 'num', String(group.count)))
      row.append(h('td', 'num c-some', Math.round(100 * group.wins / group.count) + '%'))
      const average = group.total / group.count
      row.append(h('td', 'num c-some ' + tone(average), signed(average)))

      // Each total as a bar out from a shared zero, so the groups compare at a
      // glance; the figure beside it says exactly.
      const total = h('td', 'total')
      const line = h('span', 'total-line')
      const bar = h('span', 'dbar')
      bar.style.setProperty('--zero', zero)
      const fill = h('i', tone(group.total))
      fill.style.width = (100 * Math.abs(group.total) / range).toFixed(2) + '%'
      bar.append(fill)
      line.append(bar, h('span', 'dbar-value ' + tone(group.total), signed(group.total)))
      total.append(line)
      row.append(total)
    }
    body.replaceChildren(table)
  }

  redraw()
  return { redraw }
}
