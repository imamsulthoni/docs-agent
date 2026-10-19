import {
  defineGuardrailPolicy,
  defineInputGuardrail,
  defineOutputGuardrail,
} from '@anvia/core'

/** Prompt-injection / jailbreak patterns blocked before the model runs. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /\b(system\s+prompt|reveal\s+(your\s+)?(system\s+)?(prompt|instructions))\b/i,
  /\b(jailbreak|jail-break|\bDAN\b\s*mode|do\s+anything\s+now)\b/i,
  /forget\s+(all\s+)?(previous|prior)\s+instructions?/i,
  /you\s+are\s+now\s+(a|an)\s+\w+\s+(assistant|ai|model)/i,
]

/** Markers suggesting the model is leaking its own instructions. */
const LEAKAGE_PATTERNS: RegExp[] = [
  /my\s+(system|core)\s+(prompt|instructions)\s+(says?|states?|are)/i,
  /as\s+an\s+ai\b[\s\S]{0,80}my\s+instructions/i,
]

function hit(text: string, patterns: RegExp[]): RegExp | undefined {
  return patterns.find((re) => re.test(text))
}

/**
 * Scan untrusted file content (attachment text, OCR output) against the
 * injection list. Unlike the user-input guard, a hit does NOT reject the
 * content — real documents legitimately contain these phrases — it flags
 * it so the prompt can mark the block as pure data.
 */
export function containsInjectionPattern(
  text: string,
): RegExp | undefined {
  return hit(text, INJECTION_PATTERNS)
}

const injectionGuard = defineInputGuardrail({
  id: 'prompt-injection',
  check({ inputText }, actions) {
    const re = hit(inputText, INJECTION_PATTERNS)
    if (!re) return actions.allow()
    return actions.block({
      reason: `prompt-injection pattern: ${re.source}`,
      message:
        'Permintaan itu terlihat seperti upaya injeksi prompt dan saya tidak bisa memenuhinya. ' +
        'Silakan tanyakan sesuatu tentang isi dokumen ini.',
    })
  },
})

const leakageGuard = defineOutputGuardrail({
  id: 'prompt-leakage',
  check({ outputText }, actions) {
    const re = hit(outputText, LEAKAGE_PATTERNS)
    if (!re) return actions.allow()
    return actions.block({
      reason: `prompt-leakage pattern: ${re.source}`,
      message:
        'Saya tidak bisa membagikan instruksi internal. Silakan tanyakan sesuatu tentang isi dokumen ini.',
    })
  },
})

/**
 * Deterministic safety net around the doc-QA agent.
 *
 * Two separate policies on purpose: the agent buffers all output deltas when
 * any policy has an enforced output guardrail (`hasEnforcedOutputGuardrails`),
 * which kills real streaming. So the input guard stays `enforce` (blocking),
 * while the output guard runs in `observe` mode — it records leakage decisions
 * without forcing the stream to be buffered.
 */
export const docGuardrails = [
  defineGuardrailPolicy({
    id: 'doc-qa-input-safety',
    mode: 'enforce',
    input: [injectionGuard],
  }),
  defineGuardrailPolicy({
    id: 'doc-qa-output-safety',
    mode: 'observe',
    output: [leakageGuard],
  }),
]
