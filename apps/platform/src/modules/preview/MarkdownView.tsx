import { isValidElement, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { absoluteUrl, mediaUrl } from '../../lib/api'
import { useI18n } from '../../lib/i18n'

// Keep `language-*` classes from fenced blocks so the block header
// can show the language; everything else stays strictly sanitized.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...((defaultSchema.attributes?.code as string[] | undefined) ?? []),
      ['className', 'language-bash', 'language-css', 'language-diff', 'language-dockerfile', 'language-go', 'language-html', 'language-http', 'language-java', 'language-javascript', 'language-js', 'language-json', 'language-jsx', 'language-markdown', 'language-nginx', 'language-php', 'language-powershell', 'language-py', 'language-python', 'language-ruby', 'language-rust', 'language-sh', 'language-shell', 'language-sql', 'language-ts', 'language-tsx', 'language-txt', 'language-xml', 'language-yaml', 'language-yml'],
    ],
  },
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

// A lone image is emitted inside a paragraph; our <img> renderer wraps it in
// <figure>/<figcaption>, which is invalid inside <p>. Render such paragraphs
// as a <div> so the figure stays valid HTML (avoids hydration errors).
const ImageRenderer: Components['img'] = ({ src, alt }) => (
  <figure>
    {/* eslint-disable-next-line jsx-a11y/alt-text */}
    <img
      src={typeof src === 'string' ? mediaUrl(src) : src}
      alt={alt ?? ''}
      loading="lazy"
    />
    {alt && <figcaption>{alt}</figcaption>}
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
    meaningful[0].type === ImageRenderer
  )
}

function Heading({
  level,
  children,
}: {
  level: 1 | 2 | 3 | 4
  children: ReactNode
}) {
  const id = slugify(textOf(children)) || `section-${level}`
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
  return (
    <Tag id={id}>
      {children}
      <a href={`#${id}`} className="md-anchor" aria-label="Link to section">
        #
      </a>
    </Tag>
  )
}

function CodeBlock({
  language,
  code,
}: {
  language: string
  code: string
}) {
  const [copied, setCopied] = useState(false)
  const { t } = useI18n()
  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="md-codeblock">
      <div className="md-codeblock-bar">
        <span>{language || 'code'}</span>
        <button type="button" onClick={copy} className="md-codeblock-copy">
          {copied ? t('mdview.copied') : t('mdview.copy')}
        </button>
      </div>
      <pre>
        <code className={language ? `language-${language}` : undefined}>
          {code}
        </code>
      </pre>
    </div>
  )
}

const components: Components = {
  h1: ({ children }) => <Heading level={1}>{children}</Heading>,
  h2: ({ children }) => <Heading level={2}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  h4: ({ children }) => <Heading level={4}>{children}</Heading>,
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const raw = textOf(children)
    const match = /language-(\w+)/.exec(className ?? '')
    // Fenced block (multiline) → IDE-style block with copy button
    if (match || raw.includes('\n')) {
      return <CodeBlock language={match?.[1] ?? ''} code={raw.replace(/\n$/, '')} />
    }
    return <code className={className}>{children}</code>
  },
  img: ImageRenderer,
  p: ({ children }) =>
    isImageOnly(children) ? <div>{children}</div> : <p>{children}</p>,
  a: ({ href, children }) => {
    const external = href?.startsWith('http')
    return (
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        {children}
      </a>
    )
  },
}

export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="md-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={components}
        urlTransform={(url) => absoluteUrl(url)}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
