/**
 * A play's R, added up trade by trade: the running total as a line, and each
 * trade's own R as a bar under it.
 *
 * The overview's curve is drawn against time and compounded, because it is the
 * account. This one is drawn against the trades, one step each, because it is
 * the setup: whether a setup is still working is a question about its last ten
 * trades, not its last ten days, and a week it was not traded is not a flat
 * week for it. R adds rather than compounds, so the axis is a plain one and
 * equal heights are equal R.
 *
 * Like the overview's, it is drawn at the size it is shown and again whenever
 * that changes, and it is a way in: a click on a trade opens it, and for the
 * keyboard the arrows walk the trades and Enter opens the one in focus.
 */

import { h } from './dom.ts'
import type { Step } from './edge.ts'
import type { Format } from './format.ts'
import { closedAt } from './view.ts'

const NS = 'http://www.w3.org/2000/svg'
/** The line takes this share of the height, and the bars what is left under it. */
const LINE = 0.66

/** Each chart's fill needs an id of its own: two play tabs are two charts in one document. */
let made = 0

/**
 * Draw the curve into `plot`, which sets its size. Returns the way to stop
 * redrawing it, for when the page it is on is drawn again.
 *
 * @param entrance told once the line has drawn itself in, which it does on its
 *   first drawing at a real size — not while its tab is still out of sight.
 *   Null to arrive drawn, as it does every time the page comes back.
 */
export function drawRCurve(
  plot: HTMLElement, steps: Step[], format: Format, open: (positionId: string) => void,
  entrance: (() => void) | null,
): () => void {
  const { day, multiple, side, tone } = format
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'rcurve')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'The play’s R added up trade by trade. Use the arrow keys to step through trades, Enter to open one.')
  const tooltip = h('div', 'tooltip')
  tooltip.hidden = true
  plot.replaceChildren(svg, tooltip)
  const wash = 'rwash-' + ++made

  const el = <K extends keyof SVGElementTagNameMap>(
    name: K, attrs: Record<string, string | number> = {}, parent: Element = svg,
  ): SVGElementTagNameMap[K] => {
    const node = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
    parent.append(node)
    return node
  }

  // Point 0 is the play before its first trade; point i is it after trade i.
  const totals = [0, ...steps.map((step) => step.total)]
  const n = steps.length

  let shown: number | null = null
  let show: (index: number) => void = () => {}
  let nearest: (clientX: number) => number = () => n
  let animate = entrance !== null

  function draw(): void {
    const W = Math.round(plot.clientWidth), H = Math.round(plot.clientHeight)
    // Hidden behind another tab; the observer calls again once it is back.
    if (W === 0 || H === 0) return
    const narrow = W < 560
    const M = { top: 12, right: narrow ? 56 : 68, bottom: 26, left: narrow ? 40 : 48 }
    svg.replaceChildren()
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('width', String(W))
    svg.setAttribute('height', String(H))

    const lineBottom = M.top + (H - M.top - M.bottom) * LINE
    const barTop = lineBottom + 16, barBottom = H - M.bottom

    const lo = Math.min(0, ...totals), hi = Math.max(0, ...totals)
    const step = niceStep((hi - lo) / (narrow ? 3 : 4))
    const yMin = Math.floor(lo / step) * step
    const yMax = Math.max(Math.ceil(hi / step) * step, yMin + step)
    const x = (i: number) => M.left + i / (n || 1) * (W - M.left - M.right)
    const y = (v: number) => lineBottom - (v - yMin) / (yMax - yMin) * (lineBottom - M.top)

    const places = step >= 1 ? 0 : 1
    for (let v = yMin; v <= yMax + step / 2; v += step) {
      if (Math.abs(v) > step / 2) el('line', { class: 'gridline', x1: M.left, x2: W - M.right, y1: y(v), y2: y(v) })
      const label = Math.abs(v) < step / 2 ? '0R' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(places) + 'R'
      el('text', { class: 'tick', x: M.left - 10, y: y(v) + 4, 'text-anchor': 'end' }).textContent = label
    }
    el('line', { class: 'baseline', x1: M.left, x2: W - M.right, y1: y(0), y2: y(0) })

    // The bars share a zero that sits as far down their band as the biggest
    // win is tall against the biggest loss, so neither side is squashed.
    const up = Math.max(0, ...steps.map((s) => s.r)), down = Math.max(0, ...steps.map((s) => -s.r))
    const zero = barTop + (up + down === 0 ? 0.5 : up / (up + down)) * (barBottom - barTop)
    const scale = (barBottom - barTop) / (up + down || 1)
    const barWidth = Math.max(2, Math.min(12, 0.62 * (W - M.left - M.right) / (n || 1)))
    el('line', { class: 'baseline', x1: M.left, x2: W - M.right, y1: zero, y2: zero })
    const bars = steps.map((s, i) => {
      const height = Math.max(1.5, Math.abs(s.r) * scale)
      return el('rect', {
        class: 'rbar ' + tone(s.r), x: x(i + 1) - barWidth / 2, width: barWidth, rx: Math.min(2, barWidth / 3),
        y: s.r > 0 ? zero - height : s.r < 0 ? zero : zero - height / 2, height,
      })
    })

    // Dates under the bars, as many as fit.
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - M.left - M.right) / 84))))
    for (let i = 1; i <= n; i += every) {
      el('text', { class: 'tick', x: x(i), y: H - 8, 'text-anchor': i === 1 && n > 1 ? 'start' : 'middle' })
        .textContent = day(closedAt(steps[i - 1]!.sample.trade))
    }

    const defs = el('defs')
    const gradient = el('linearGradient', { id: wash, x1: 0, x2: 0, y1: y(yMax), y2: y(yMin), gradientUnits: 'userSpaceOnUse' }, defs)
    const at = (y(0) - y(yMax)) / (y(yMin) - y(yMax))
    el('stop', { offset: 0, 'stop-color': 'var(--accent)', 'stop-opacity': 0.14 }, gradient)
    el('stop', { offset: at, 'stop-color': 'var(--accent)', 'stop-opacity': 0.02 }, gradient)
    el('stop', { offset: 1, 'stop-color': 'var(--accent)', 'stop-opacity': 0.1 }, gradient)

    const drawn = animate ? ' draw' : ''
    const path = totals.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')
    el('path', { class: 'area' + drawn, fill: `url(#${wash})`, d: path + ` L${x(n).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z` })
    const line = el('path', { class: 'line' + drawn, d: path })
    if (animate) line.style.setProperty('--length', String(line.getTotalLength()))
    el('circle', { class: 'end' + drawn, cx: x(n), cy: y(totals[n]!), r: 4.5 })
    el('text', { class: 'end-label' + drawn, x: x(n) + 10, y: y(totals[n]!) + 4 }).textContent = multiple(totals[n]!)

    const crosshair = el('line', { class: 'crosshair', y1: M.top, y2: barBottom, visibility: 'hidden' })
    const focus = el('circle', { class: 'focus', r: 5, visibility: 'hidden' })

    show = (index: number): void => {
      shown = index
      const px = x(index), py = y(totals[index]!)
      crosshair.setAttribute('x1', String(px))
      crosshair.setAttribute('x2', String(px))
      crosshair.setAttribute('visibility', 'visible')
      focus.setAttribute('cx', String(px))
      focus.setAttribute('cy', String(py))
      focus.setAttribute('visibility', 'visible')
      bars.forEach((bar, i) => bar.classList.toggle('on', i === index - 1))

      tooltip.replaceChildren(h('b', '', multiple(totals[index]!)))
      const one = steps[index - 1]
      if (one === undefined) {
        tooltip.append(h('span', 'sub', 'Before the first trade'))
      } else {
        const trade = one.sample.trade
        const line = h('span', 'sub', `${day(closedAt(trade))} · ${trade.symbol} ${side(trade.side)} · `)
        line.append(h('span', 'net ' + tone(one.r), multiple(one.r)))
        tooltip.append(h('span', 'sub', `Trade ${index} of ${n}`), line, h('span', 'hint', 'Click to open this trade'))
      }
      tooltip.hidden = false

      // The tooltip sits beside the point, on whichever side has the room,
      // and never past the edge of the chart: on a phone neither side may.
      const box = svg.getBoundingClientRect(), frame = plot.getBoundingClientRect()
      const left = box.left - frame.left + px, top = box.top - frame.top + py
      const width = tooltip.offsetWidth
      const beside = left > frame.width * 0.6 ? left - 16 - width : left + 16
      tooltip.style.left = Math.max(0, Math.min(beside, frame.width - width)) + 'px'
      tooltip.style.right = 'auto'
      tooltip.style.top = Math.max(0, Math.min(top - 24, frame.height - tooltip.offsetHeight)) + 'px'
      svg.style.cursor = one !== undefined ? 'pointer' : 'default'
    }

    // The trade nearest the pointer across: the crosshair finds the trade, never the line.
    nearest = (clientX: number): number => {
      const box = svg.getBoundingClientRect()
      const i = Math.round(((clientX - box.left) * W / box.width - M.left) / (W - M.left - M.right) * n)
      return Math.max(0, Math.min(n, i))
    }

    if (shown !== null) show(shown)
    if (animate) {
      animate = false
      entrance?.()
      // Drawn again on a resize, it arrives drawn.
      setTimeout(() => { for (const node of svg.querySelectorAll('.draw')) node.classList.remove('draw') }, 1800)
    }
  }

  function hide(): void {
    shown = null
    tooltip.hidden = true
    for (const node of svg.querySelectorAll('.crosshair, .focus')) node.setAttribute('visibility', 'hidden')
    for (const node of svg.querySelectorAll('.rbar.on')) node.classList.remove('on')
  }

  const openAt = (index: number): void => {
    const one = steps[index - 1]
    if (one !== undefined) open(one.sample.trade.positionId)
  }

  svg.addEventListener('pointermove', (event) => { show(nearest(event.clientX)) })
  svg.addEventListener('pointerleave', hide)
  svg.addEventListener('click', (event) => { openAt(nearest(event.clientX)) })

  svg.tabIndex = 0
  svg.addEventListener('focus', () => { if (shown === null) show(n) })
  svg.addEventListener('blur', hide)
  svg.addEventListener('keydown', (event) => {
    const at = shown ?? n
    const to = event.key === 'ArrowLeft' ? at - 1 : event.key === 'ArrowRight' ? at + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? n : null
    if (to !== null) {
      // The arrows walk the chart here; they step between plays everywhere else on the tab.
      event.preventDefault()
      event.stopPropagation()
      show(Math.max(0, Math.min(n, to)))
    } else if (event.key === 'Enter') {
      openAt(at)
    } else if (event.key === 'Escape' && shown !== null) {
      event.stopPropagation()
      hide()
    }
  })

  let size = ''
  const observer = new ResizeObserver(() => {
    const now = Math.round(plot.clientWidth) + 'x' + Math.round(plot.clientHeight)
    if (now !== size) { size = now; draw() }
  })
  observer.observe(plot)
  return () => observer.disconnect()
}

function niceStep(rough: number): number {
  if (rough <= 0) return 1
  const power = Math.pow(10, Math.floor(Math.log10(rough)))
  const unit = rough / power
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power
}
