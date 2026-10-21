import { isValidElement, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import { mediaUrl } from '../../lib/api'

/**
 * Image renderer shared by streaming ReactMarkdown and Message.Markdown.
 * Plain inline span (not <figure>): react-markdown always nests <img> inside
 * <p>, so a block-level figure here triggers the <figure>-in-<p> hydration
 * error console users keep seeing. A span is valid in every nesting position
 * and the .chat-md CSS below keeps the figure-like look.
 */
export const ChatImage: Components['img'] = ({ src, alt }) => (
  <span className="chat-img">
    {/* eslint-disable-next-line jsx-a11y/alt-text */}
    <img
      src={typeof src === 'string' ? mediaUrl(src) : src}
      alt={alt ?? ''}
      loading="lazy"
    />
    {alt ? <span className="chat-img-cap">{alt}</span> : null}
  </span>
)

function isImageOnly(children: ReactNode): boolean {
  const items = Array.isArray(children) ? children : [children]
  const meaningful = items.filter(
    (child) => !(typeof child === 'string' && child.trim() === ''),
  )
  return (
    meaningful.length === 1 &&
    isValidElement(meaningful[0]) &&
    meaningful[0].type === ChatImage
  )
}

/**
 * Components for assistant markdown. `img` maps to ChatImage (inline span, so
 * it stays valid inside <p>); `p` renders bare content unwrapped to keep
 * <figure>-in-<p> impossible while plain-text paragraphs keep their <p>.
 */
export const chatMarkdownComponents: Components = {
  img: ChatImage,
  p: ({ children }) =>
    isImageOnly(children) ? <>{children}</> : <p>{children}</p>,
}
