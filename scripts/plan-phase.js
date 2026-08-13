#!/usr/bin/env node
// Slices one phase out of docs/PLAN.md so a phase subagent can be handed its
// spec inline instead of being pointed at the whole plan.
//
// Why this exists: a measurement across every session transcript on 2026-08-13
// found that Read is 53% of all context material, and that plan/spec files were
// the single largest slice of it -- Plan 4's spec cost ~226k tokens of reading,
// because each of nine phase subagents read the entire file to find its own
// section. The file is not too big; it is being delivered wrong. One phase is
// ~900 tokens out of ~8,700, and a subagent that is handed its phase needs no
// Read at all.
//
// Output is preamble + the requested phase + only the Risks bullets that name
// that phase. The preamble is always included because it carries the zero-write
// baseline hash and the phase-order rationale, which every phase is checked
// against.
//
// READ-ONLY. Reads a markdown file and writes to stdout; nothing here touches
// data/, and there is no --dry-run because there is nothing to run for real.
const fs = require('fs');
const path = require('path');

const DEFAULT_PLAN = path.join(__dirname, '..', 'docs', 'PLAN.md');

// ~3.7 chars/token, the same rough divisor used in the transcript analysis that
// motivated this script. Good enough to compare a slice against a whole file.
const estTokens = s => Math.round(s.length / 3.7);

function parsePlan(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  // Every section starts at a level-2 heading. Phases are the ones whose
  // heading names a number; "What this plan is", "Risks" etc. are not.
  const heads = [];
  lines.forEach((l, i) => {
    const m = /^##\s+(.*)$/.exec(l);
    if (m) heads.push({ i, title: m[1].trim() });
  });

  const phaseOf = title => {
    const m = /^Phase\s+(\d+)\b/i.exec(title);
    return m ? Number(m[1]) : null;
  };

  const firstPhase = heads.find(h => phaseOf(h.title) !== null);
  // Preamble is everything above the first phase, minus a trailing rule.
  const preamble = lines
    .slice(0, firstPhase ? firstPhase.i : lines.length)
    .join('\n')
    .replace(/\n+---\s*$/, '')
    .trim();

  const sectionAt = idx => {
    const start = heads[idx].i;
    const end = idx + 1 < heads.length ? heads[idx + 1].i : lines.length;
    return lines.slice(start, end).join('\n').replace(/\n+---\s*$/, '').trimEnd();
  };

  const phases = [];
  let risks = '';
  heads.forEach((h, idx) => {
    const n = phaseOf(h.title);
    if (n !== null) phases.push({ n, title: h.title, body: sectionAt(idx) });
    else if (/^risks\b/i.test(h.title)) risks = sectionAt(idx);
  });

  return { text, preamble, phases, risks };
}

// A risk bullet may name one phase ("Phase 5's mesh-scale trap") or several
// ("Phases 7 and 8 share the core radius"). Collect every number attached to a
// Phase/Phases mention so a shared risk reaches both of its phases.
function risksForPhase(risks, n) {
  if (!risks) return '';
  const body = risks.split('\n').slice(1).join('\n');
  const bullets = [];
  for (const line of body.split('\n')) {
    if (/^\s*-\s/.test(line)) bullets.push(line);
    else if (bullets.length && line.trim()) bullets[bullets.length - 1] += '\n' + line;
  }
  const matching = bullets.filter(b => {
    const nums = new Set();
    for (const m of b.matchAll(/Phases?\s+((?:\d+(?:\s*(?:,|and)\s*)?)+)/gi))
      for (const d of m[1].match(/\d+/g) || []) nums.add(Number(d));
    return nums.has(n);
  });
  return matching.length ? '## Risks that name this phase\n\n' + matching.join('\n') : '';
}

function main() {
  const args = process.argv.slice(2);
  let file = DEFAULT_PLAN;
  const fileArg = args.indexOf('--file');
  if (fileArg !== -1) { file = path.resolve(args[fileArg + 1]); args.splice(fileArg, 2); }

  if (!fs.existsSync(file)) {
    console.error('No plan file at ' + file);
    process.exit(1);
  }
  const plan = parsePlan(file);
  const wantList = args.includes('--list') || args.length === 0;

  if (wantList) {
    const whole = estTokens(plan.text);
    console.log(path.relative(process.cwd(), file) + ' -- ' + plan.phases.length +
      ' phases, ~' + whole.toLocaleString('en-US') + ' tokens whole\n');
    console.log('  #   ~tokens sliced   heading');
    for (const p of plan.phases) {
      const sliced = estTokens([plan.preamble, p.body, risksForPhase(plan.risks, p.n)]
        .filter(Boolean).join('\n\n'));
      console.log('  ' + String(p.n).padStart(2) + '   ' +
        String(sliced).padStart(13) + '   ' + p.title);
    }
    const avg = plan.phases.reduce((a, p) => a + estTokens(
      [plan.preamble, p.body, risksForPhase(plan.risks, p.n)].filter(Boolean).join('\n\n')), 0)
      / (plan.phases.length || 1);
    console.log('\naverage slice ~' + Math.round(avg).toLocaleString('en-US') +
      ' tokens vs ~' + whole.toLocaleString('en-US') + ' whole (' +
      Math.round(100 - (100 * avg / whole)) + '% smaller)');
    if (args.length === 0) console.log('\nUsage: node scripts/plan-phase.js <n> [--file <plan.md>] [--no-preamble]');
    return;
  }

  const n = Number(args.find(a => /^\d+$/.test(a)));
  const phase = plan.phases.find(p => p.n === n);
  if (!phase) {
    console.error('No phase ' + args[0] + ' in ' + path.basename(file) +
      ' (have ' + plan.phases.map(p => p.n).join(', ') + ')');
    process.exit(1);
  }

  const parts = [];
  if (!args.includes('--no-preamble')) parts.push(plan.preamble);
  parts.push(phase.body);
  const r = risksForPhase(plan.risks, n);
  if (r) parts.push(r);
  process.stdout.write(parts.join('\n\n---\n\n') + '\n');
}

main();
