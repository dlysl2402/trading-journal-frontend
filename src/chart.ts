/**
 * The growth curve: every trade's return compounded, against time, on a log
 * axis so that equal heights are equal percentages wherever they fall.
 *
 * It left `page.ts` when it learned to redraw itself. It is drawn at the size
 * it is shown at, and again whenever that changes, so its labels stay the size
 * of the text around them — a fixed viewBox scaled down to a phone shrank them
 * to nothing — and it fills whatever height its card is given. The line draws
 * itself in once, on the first paint.
 *
 * Every point after the first is a trade, so the curve is also a way in: a
 * click on a point opens that trade, and for the keyboard the arrow keys walk
 * the points and Enter opens the one in focus.
 */

import { h } from './dom.ts'
import type { Format } from './format.ts'
import type { EquityPoint } from './view.ts'
import { returnOf } from './view.ts'

const NS = 'http://www.w3.org/2000/svg'
const DAY = 86_400_000

export function drawCurve(
  svg: SVGSVGElement, tooltip: HTMLElement, points: EquityPoint[], format: Format,
  open: (positionId: string) => void,
): void {
  const { day, side, signed, tone, when } = format
  const plot = svg.parentElement!

  if (points.length < 2) {
    svg.replaceWith(h('p', 'empty', 'Your growth curve starts with the first closed trade.'))
    return
  }

  const el = <K extends keyof SVGElementTagNameMap>(
    name: K, attrs: Record<string, string | number> = {}, parent: Element = svg,
  ): SVGElementTagNameMap[K] => {
    const node = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
    parent.append(node)
    return node
  }

  const from = (p: EquityPoint) => p.growth - 1
  const t0 = points[0]!.time.getTime(), t1 = points[points.length - 1]!.time.getTime()

  // What outlives a redraw: which point is shown. What a redraw replaces:
  // how to show one, and how to find the one under the pointer.
  let shown: number | null = null
  let show: (index: number) => void = () => {}
  let nearest: (clientX: number) => number = () => points.length - 1
  let animate = true
  tooltip.hidden = true

  function draw(): void {
    const W = Math.round(plot.clientWidth), H = Math.round(plot.clientHeight)
    // Hidden behind a trade tab; the observer calls again once it is back.
    if (W === 0 || H === 0) return
    const narrow = W < 560
    const M = { top: 12, right: narrow ? 60 : 76, bottom: 28, left: narrow ? 44 : 52 }
    svg.replaceChildren()
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('width', String(W))
    svg.setAttribute('height', String(H))

    const lo = Math.min(0, ...points.map(from))
    const hi = Math.max(0, ...points.map(from))
    const step = niceStep((hi - lo) / (narrow ? 3 : 4))
    // Never down to −100%, where the log axis has no bottom.
    const yMin = Math.max(Math.floor(lo / step) * step, lo - (1 + lo) / 2)
    const yMax = Math.max(Math.ceil(hi / step) * step, yMin + step)
    const ln = (v: number) => Math.log(1 + v)
    const x = (t: number) => M.left + (t - t0) / (t1 - t0 || 1) * (W - M.left - M.right)
    const y = (v: number) => H - M.bottom - (ln(v) - ln(yMin)) / (ln(yMax) - ln(yMin)) * (H - M.top - M.bottom)

    // Ticks carry as many decimals as the step needs, and no more.
    const places = step >= 0.01 ? 0 : step >= 0.001 ? 1 : 2
    const tick = (v: number) => Math.abs(v) < step / 2 ? '0%'
      : (v > 0 ? '+' : '−') + Math.abs(100 * v).toFixed(places) + '%'
    for (let v = Math.ceil(yMin / step) * step; v <= yMax + step / 2; v += step) {
      if (Math.abs(v) > step / 2) el('line', { class: 'gridline', x1: M.left, x2: W - M.right, y1: y(v), y2: y(v) })
      el('text', { class: 'tick', x: M.left - 10, y: y(v) + 4, 'text-anchor': 'end' }).textContent = tick(v)
    }
    el('line', { class: 'baseline', x1: M.left, x2: W - M.right, y1: y(0), y2: y(0) })

    const days = Math.max(1, Math.round((t1 - t0) / DAY))
    const every = Math.max(1, Math.ceil(days / Math.max(2, Math.floor((W - M.left - M.right) / 84))))
    for (let d = 0; d <= days; d += every) {
      const t = t0 + d * DAY
      if (t > t1) break
      el('text', { class: 'tick', x: x(t), y: H - 8, 'text-anchor': d === 0 ? 'start' : 'middle' }).textContent = day(new Date(t))
    }

    // A wash under the line that fades to nothing at zero, in either direction.
    const defs = el('defs')
    const wash = el('linearGradient', { id: 'wash', x1: 0, x2: 0, y1: y(yMax), y2: y(yMin), gradientUnits: 'userSpaceOnUse' }, defs)
    const zero = (y(0) - y(yMax)) / (y(yMin) - y(yMax))
    el('stop', { offset: 0, 'stop-color': 'var(--accent)', 'stop-opacity': 0.14 }, wash)
    el('stop', { offset: zero, 'stop-color': 'var(--accent)', 'stop-opacity': 0.02 }, wash)
    el('stop', { offset: 1, 'stop-color': 'var(--accent)', 'stop-opacity': 0.1 }, wash)

    const drawn = animate ? ' draw' : ''
    const path = points.map((p, i) => (i ? 'L' : 'M') + x(p.time.getTime()).toFixed(1) + ' ' + y(from(p)).toFixed(1)).join(' ')
    el('path', { class: 'area' + drawn, fill: 'url(#wash)', d: path + ` L${x(t1).toFixed(1)} ${y(0).toFixed(1)} L${x(t0).toFixed(1)} ${y(0).toFixed(1)} Z` })
    const line = el('path', { class: 'line' + drawn, d: path })
    if (animate) line.style.setProperty('--length', String(line.getTotalLength()))
    const last = points[points.length - 1]!
    el('circle', { class: 'end' + drawn, cx: x(t1), cy: y(from(last)), r: 4.5 })
    el('text', { class: 'end-label' + drawn, x: x(t1) + 10, y: y(from(last)) + 4 }).textContent = signed(from(last))

    const crosshair = el('line', { class: 'crosshair', y1: M.top, y2: H - M.bottom, visibility: 'hidden' })
    const focus = el('circle', { class: 'focus', r: 5, visibility: 'hidden' })

    show = (index: number): void => {
      const p = points[index]!
      shown = index
      const px = x(p.time.getTime()), py = y(from(p))
      crosshair.setAttribute('x1', String(px))
      crosshair.setAttribute('x2', String(px))
      crosshair.setAttribute('visibility', 'visible')
      focus.setAttribute('cx', String(px))
      focus.setAttribute('cy', String(py))
      focus.setAttribute('visibility', 'visible')

      tooltip.replaceChildren(h('b', '', signed(from(p))))
      if (p.trade !== null) {
        const result = returnOf(p.trade)
        const line = h('span', 'sub', p.trade.symbol + ' · ' + side(p.trade.side) + ' · ')
        line.append(h('span', 'net ' + tone(result), signed(result)))
        tooltip.append(h('span', 'sub', when(p.time)), line, h('span', 'hint', 'Click to open this trade'))
      } else {
        tooltip.append(h('span', 'sub', day(p.time) + ' · before the first trade'))
      }
      tooltip.hidden = false

      // The tooltip sits beside the point, on whichever side has the room.
      const box = svg.getBoundingClientRect(), frame = plot.getBoundingClientRect()
      const left = box.left - frame.left + px, top = box.top - frame.top + py
      const flip = left > frame.width * 0.6
      tooltip.style.left = flip ? 'auto' : left + 16 + 'px'
      tooltip.style.right = flip ? frame.width - left + 16 + 'px' : 'auto'
      tooltip.style.top = Math.max(0, top - 24) + 'px'
      svg.style.cursor = p.trade !== null ? 'pointer' : 'default'
    }

    // The point nearest the pointer in time: the crosshair finds the date, never the line.
    nearest = (clientX: number): number => {
      const box = svg.getBoundingClientRect()
      const t = t0 + ((clientX - box.left) * W / box.width - M.left) / (W - M.left - M.right) * (t1 - t0)
      let best = 0
      points.forEach((p, i) => {
        if (Math.abs(p.time.getTime() - t) < Math.abs(points[best]!.time.getTime() - t)) best = i
      })
      return best
    }

    if (shown !== null) show(shown)
    if (animate) {
      animate = false
      // Coming back to the overview must not replay the entrance.
      setTimeout(() => { for (const node of svg.querySelectorAll('.draw')) node.classList.remove('draw') }, 1800)
    }
  }

  function hide(): void {
    shown = null
    tooltip.hidden = true
    for (const node of svg.querySelectorAll('.crosshair, .focus')) node.setAttribute('visibility', 'hidden')
  }

  svg.addEventListener('pointermove', (event) => { show(nearest(event.clientX)) })
  svg.addEventListener('pointerleave', hide)
  svg.addEventListener('click', (event) => {
    const trade = points[nearest(event.clientX)]!.trade
    if (trade !== null) open(trade.positionId)
  })

  svg.tabIndex = 0
  svg.addEventListener('focus', () => { if (shown === null) show(points.length - 1) })
  svg.addEventListener('blur', hide)
  svg.addEventListener('keydown', (event) => {
    const at = shown ?? points.length - 1
    const to = event.key === 'ArrowLeft' ? at - 1 : event.key === 'ArrowRight' ? at + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null
    if (to !== null) {
      event.preventDefault()
      show(Math.max(0, Math.min(points.length - 1, to)))
    } else if (event.key === 'Enter') {
      const trade = points[at]!.trade
      if (trade !== null) open(trade.positionId)
    } else if (event.key === 'Escape') {
      hide()
    }
  })

  let size = ''
  new ResizeObserver(() => {
    const now = Math.round(plot.clientWidth) + 'x' + Math.round(plot.clientHeight)
    if (now !== size) { size = now; draw() }
  }).observe(plot)
}

function niceStep(rough: number): number {
  if (rough <= 0) return 0.01
  const power = Math.pow(10, Math.floor(Math.log10(rough)))
  const unit = rough / power
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power
}
