// Regression: EMAIL-RL-005..008 — bulk templates MUST route to bulk_emails
// so a bulk 429 cannot freeze auth confirmations or 1:1 transactional sends.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { BULK_TEMPLATES, resolveEmailQueue } from './transactional-email.ts'

Deno.test('bulk templates route to bulk_emails lane', () => {
  for (const t of ['project-blast', 'fleety-coach-digest', 'announcement']) {
    assertEquals(resolveEmailQueue(t), 'bulk_emails', `${t} must go to bulk_emails`)
  }
})

Deno.test('non-bulk templates route to transactional_emails lane', () => {
  for (const t of [
    'welcome',
    'password-reset',
    'application-status',
    'interview-scheduled',
    'unknown-template',
  ]) {
    assertEquals(resolveEmailQueue(t), 'transactional_emails', `${t} must go to transactional_emails`)
  }
})

Deno.test('BULK_TEMPLATES set is exactly the three known bulk templates', () => {
  assertEquals(
    [...BULK_TEMPLATES].sort(),
    ['announcement', 'fleety-coach-digest', 'project-blast'],
  )
})
