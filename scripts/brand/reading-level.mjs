#!/usr/bin/env node
/**
 * Flesch-Kincaid grade level guard for user-facing copy.
 *
 * Scans i18n JSON bundles and email templates. Fails CI when the weighted
 * average grade is above MAX_GRADE. Per-string outliers above 12 are
 * surfaced as warnings so writers can target them. Legal pages excluded
 * because legalese is held to a different standard.
 *
 *   node scripts/brand/reading-level.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';

const MAX_GRADE = 9;
const FILES = await glob([
  'public/locales/en/**/*.json',
  'src/i18n/locales/en/**/*.json',
  'supabase/functions/_shared/transactional-email-templates/*.tsx',
  'supabase/functions/_shared/email-templates/*.tsx',
]);

const SYLL_RE = /[aeiouy]+/g;
function syllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return (word.match(SYLL_RE) || []).length || 1;
}

function gradeOf(text) {
  const sentences = (text.match(/[.!?]+/g) || ['.']).length;
  const words = (text.match(/\b[a-zA-Z']+\b/g) || []);
  if (words.length < 5) return null;
  const sylls = words.reduce((s, w) => s + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (sylls / words.length) - 15.59;
}

function* extractStrings(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* extractStrings(v);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* extractStrings(v);
}

const samples = [];
for (const file of FILES) {
  const raw = fs.readFileSync(file, 'utf8');
  const strings = file.endsWith('.json')
    ? [...extractStrings(JSON.parse(raw))]
    : raw.match(/(["'`])((?:(?!\1)[^\\]|\\.)+)\1/g)?.map((s) => s.slice(1, -1)) ?? [];
  for (const s of strings) {
    const g = gradeOf(s);
    if (g != null) samples.push({ file, text: s, grade: g });
  }
}

if (samples.length === 0) {
  console.log('reading-level: no samples found');
  process.exit(0);
}

const avg = samples.reduce((a, s) => a + s.grade, 0) / samples.length;
const outliers = samples.filter((s) => s.grade > 12).sort((a, b) => b.grade - a.grade).slice(0, 10);

console.log(`reading-level: avg grade ${avg.toFixed(1)} across ${samples.length} samples (max allowed ${MAX_GRADE})`);
if (outliers.length) {
  console.log('\nTop outliers (consider simplifying):');
  for (const o of outliers) console.log(`  [${o.grade.toFixed(1)}] ${path.basename(o.file)}: "${o.text.slice(0, 80)}"`);
}

if (avg > MAX_GRADE) {
  console.error(`\n❌ Average reading grade ${avg.toFixed(1)} exceeds limit ${MAX_GRADE}.`);
  process.exit(1);
}
