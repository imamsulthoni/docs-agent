import { isValidElement, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import { mediaUrl } from '../../lib/api'

/** Image renderer shared by streaming ReactMarkdown and Message.Markdown. */
export const ChatImage: Components['img'] = ({ src, alt }) => (
  <figure>
    {/* eslint-disable-next-line jsx-a11y/alt-text */}
    <img
      src={typeof src === 'string' ? mediaUrl(src) : src}
      alt={alt ?? ''}
      loading="lazy"
    />
    {alt ? <figcaption>{alt}</figcaption> : null}
  </figure>
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

/** Keep figure-wrapped images valid outside <p>. */
export const chatMarkdownComponents: Components = {
  img: ChatImage,
  p: ({ children }) =>
    isImageOnly(children) ? <div>{children}</div> : <p>{children}</p>,
}
