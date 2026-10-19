import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres'
process.env.MAX_UPLOAD_MB = '1'

const { parseConvertForm, isConverterTimeout } = await import(
  '../src/modules/converter/utils.ts'
)

function pdf(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })
}

function field(form: FormData, name: string): string {
  const value = form.get(name)
  assert.equal(typeof value, 'string')
  return value as string
}

describe('parseConvertForm', () => {
  test('rejects a missing file', () => {
    const result = parseConvertForm(new FormData())
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 422)
  })

  test('rejects a non-pdf upload', () => {
    const form = new FormData()
    form.append('file', new File(['hi'], 'notes.txt'), 'notes.txt')
    const result = parseConvertForm(form)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 400)
  })

  test('rejects a file over the upload limit', () => {
    const form = new FormData()
    form.append('file', pdf('big.pdf', 1024 * 1024 + 1))
    const result = parseConvertForm(form)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 413)
  })

  test('defaults extract_images and maps ocr flags', () => {
    const form = new FormData()
    form.append('file', pdf('doc.pdf', 32))
    form.append('scan_images', 'on')
    form.append('ocr_images', 'true')
    form.append('ocr_scope', 'flowchart')
    form.append('webhook_url', 'https://example.test/hook')
    const result = parseConvertForm(form)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(field(result.upstream, 'scan_images'), 'true')
    assert.equal(field(result.upstream, 'extract_images'), 'true')
    assert.equal(field(result.upstream, 'ocr_images'), 'true')
    assert.equal(field(result.upstream, 'ocr_scope'), 'flowchart')
    assert.equal(field(result.upstream, 'webhook_url'), 'https://example.test/hook')
    assert.equal(result.file.name, 'doc.pdf')
  })

  test('turns unknown ocr scope into all and omits an empty webhook', () => {
    const form = new FormData()
    form.append('file', pdf('doc.pdf', 32))
    form.append('ocr_scope', 'images')
    const result = parseConvertForm(form)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(field(result.upstream, 'extract_images'), 'true')
    assert.equal(field(result.upstream, 'scan_images'), 'false')
    assert.equal(field(result.upstream, 'ocr_scope'), 'all')
    assert.equal(result.upstream.get('webhook_url'), null)
  })
})

describe('isConverterTimeout', () => {
  test('recognizes undici header and body timeouts', () => {
    assert.equal(isConverterTimeout(Object.assign(new Error('slow'), { name: 'TimeoutError' })), true)
    assert.equal(isConverterTimeout({ code: 'UND_ERR_BODY_TIMEOUT' }), true)
    assert.equal(isConverterTimeout({ cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }), true)
    assert.equal(isConverterTimeout(new Error('down')), false)
  })
})
