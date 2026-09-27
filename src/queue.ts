/**
 * The review queue: how much of the journal is written up, and the way to the
 * next trade that is not.
 *
 * Writing a trade up is the part of keeping a journal that gets skipped, so
 * the page keeps the count in view and makes the next one a single click. The
 * order is the list's, newest first, so what it offers first is the trade you
 * closed last — the one you remember best.
 */

import { h } from './dom.ts'
import type { Format } from './format.ts'
import { icon } from './icons.ts'
import type { Trade } from './journal.ts'
import type { Margin } from './margin.ts'
import { isBlank } from './margin.ts'
import { closedAt, returnOf } from './view.ts'

const NS = 'http://www.w3.org/2000/svg'
/** How many of the waiting trades are named on the card; the list has the rest. */
const SHOWN = 4
const RADIUS = 34

export interface QueueContext {
  format: Format
  margin: Margin
  open: (positionId: string) => void
  /** Narrow the list to every trade still waiting. */
  showAll: () => void
}

/** @param trades newest first, the order the list reads in. */
export function createQueue(root: HTMLElement, trades: Trade[], context: QueueContext): { redraw: () => void } {
  const { format, margin, open, showAll } = context
  const { side, signed, tone, when } = format

  function ring(fraction: number): SVGSVGElement {
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('class', 'ring')
    svg.setAttribute('viewBox', '0 0 88 88')
    svg.setAttribute('aria-hidden', 'true')
    const circle = (className: string): SVGCircleElement => {
      const node = document.createElementNS(NS, 'circle')
      for (const [k, v] of Object.entries({ class: className, cx: 44, cy: 44, r: RADIUS, fill: 'none', 'stroke-width': 8 })) {
        node.setAttribute(k, String(v))
      }
      svg.append(node)
      return node
    }
    circle('track')
    const fill = circle('fill')
    const length = 2 * Math.PI * RADIUS
    fill.setAttribute('stroke-dasharray', length.toFixed(2))
    fill.setAttribute('stroke-dashoffset', (length * (1 - fraction)).toFixed(2))
    const label = document.createElementNS(NS, 'text')
    for (const [k, v] of Object.entries({ x: 44, y: 49, 'text-anchor': 'middle' })) label.setAttribute(k, String(v))
    label.textContent = Math.round(100 * fraction) + '%'
    svg.append(label)
    return svg
  }

  function redraw(): void {
    const waiting = trades.filter((trade) => isBlank(margin.get(trade.positionId)))
    const done = trades.length - waiting.length
    const head = h('header', 'card-head')
    head.append(h('h2', '', 'Review queue'))
    root.replaceChildren(head)

    if (trades.length === 0) {
      root.append(h('p', 'queue-note', 'Nothing to review yet.'))
      return
    }

    const progress = h('div', 'ring-row')
    const words = h('div')
    words.append(h('b', '', `${done} of ${trades.length}`), h('span', '', 'reviewed'))
    progress.append(ring(done / trades.length), words)
    root.append(progress)

    if (waiting.length === 0) {
      const clear = h('div', 'caught-up')
      clear.append(icon('check-circle'), h('b', '', 'All caught up'))
      root.append(clear)
      return
    }

    const next = h('button', 'btn primary block') as HTMLButtonElement
    next.type = 'button'
    next.append('Review next trade', icon('arrow-right'))
    next.addEventListener('click', () => open(waiting[0]!.positionId))
    root.append(next)

    const list = h('ul', 'upnext')
    list.setAttribute('aria-label', 'Waiting for a review')
    for (const trade of waiting.slice(0, SHOWN)) {
      const result = returnOf(trade)
      const item = h('li')
      const button = h('button', 'upnext-row') as HTMLButtonElement
      button.type = 'button'
      const name = h('span', 'upnext-name')
      name.append(h('b', '', trade.symbol), h('span', 'side-word', side(trade.side)))
      button.append(name, h('span', 'upnext-when', when(closedAt(trade))),
        h('span', 'result ' + tone(result), signed(result)), icon('chevron-right'))
      button.addEventListener('click', () => open(trade.positionId))
      item.append(button)
      list.append(item)
    }
    root.append(list)
    // The card names a few; past that, the list has the rest.
    if (waiting.length > SHOWN) {
      const foot = h('div', 'queue-foot')
      const all = h('button', 'link', `See all ${waiting.length}`) as HTMLButtonElement
      all.type = 'button'
      all.addEventListener('click', showAll)
      foot.append(all)
      root.append(foot)
    }
  }

  redraw()
  return { redraw }
}
