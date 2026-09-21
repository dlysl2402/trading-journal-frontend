/**
 * The two lines of DOM every drawing module would otherwise write for itself.
 *
 * Nothing here is a framework. `h` exists because `createElement`, a class and
 * a string is three statements for one element, and a page built out of three
 * hundred of them stops reading like the thing it draws.
 */

/** An element the page is required to have, or a loud error naming it. */
export function must<T extends Element = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`the page has no #${id}`)
  return node as unknown as T
}

/**
 * An element with a class and its text.
 *
 * Text is set with `textContent`, never `innerHTML`, which is the reason a
 * note can hold a quote mark or an angle bracket and still be words on the
 * page rather than markup.
 */
export function h(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
