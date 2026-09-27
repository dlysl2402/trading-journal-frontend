/**
 * Tooltips: the explanation behind a word, shown where you point.
 *
 * Anything with a `data-tip` gets one on hover and on keyboard focus. One
 * bubble serves the whole page and is placed by measuring, so it stays on the
 * screen at the edge of a phone where a CSS-only tooltip would be cut off.
 *
 * This is where the page's explaining lives, so the page itself can carry
 * figures and little else. A tip is never the only home of a figure: what one
 * names can be read off the page too — the green days it counts are the green
 * cells of the calendar.
 */

import { h } from './dom.ts'
import { icon } from './icons.ts'

const GAP = 8
const EDGE = 8

export function enableTips(): void {
  const bubble = h('div', 'tip-bubble')
  bubble.id = 'tip-bubble'
  bubble.setAttribute('role', 'tooltip')
  document.body.append(bubble)

  let current: HTMLElement | null = null

  function show(target: HTMLElement): void {
    const text = target.dataset.tip
    if (text === undefined || text === '') return
    if (current !== target) hide()
    current = target
    bubble.textContent = text
    bubble.classList.add('on')
    target.setAttribute('aria-describedby', bubble.id)

    const anchor = target.getBoundingClientRect()
    const size = bubble.getBoundingClientRect()
    const left = Math.max(EDGE, Math.min(anchor.left + anchor.width / 2 - size.width / 2, innerWidth - size.width - EDGE))
    const above = anchor.top - size.height - GAP
    bubble.style.left = left + 'px'
    bubble.style.top = (above >= EDGE ? above : anchor.bottom + GAP) + 'px'
  }

  function hide(): void {
    bubble.classList.remove('on')
    current?.removeAttribute('aria-describedby')
    current = null
  }

  const tipped = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null

  document.addEventListener('pointerover', (event) => {
    const target = tipped(event.target)
    if (target !== null) show(target)
    else if (current !== null) hide()
  })
  document.addEventListener('focusin', (event) => {
    const target = tipped(event.target)
    if (target !== null && target.matches(':focus-visible')) show(target)
  })
  document.addEventListener('focusout', hide)
  document.addEventListener('pointerdown', hide)
  // A finger has no hover, so the info marks answer a tap instead.
  document.addEventListener('click', (event) => {
    const target = tipped(event.target)
    if (target !== null && target.classList.contains('tip')) show(target)
  })
  window.addEventListener('scroll', hide, { capture: true, passive: true })
}

/** The small circled "i" that explains the word beside it, on hover, focus or tap. */
export function tipMark(text: string, label = 'What this means'): HTMLButtonElement {
  const mark = h('button', 'tip') as HTMLButtonElement
  mark.type = 'button'
  mark.dataset.tip = text
  mark.setAttribute('aria-label', label)
  mark.append(icon('info'))
  return mark
}
