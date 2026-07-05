// MARKDOWN POLICY PARSER — the operator writes their rule-set as a plain .md file and we
// turn it into the { rules, default } object evaluatePolicy() consumes. Pure.
//
// Lagisalpha emits a signal; the OPERATOR decides what to do with it. Making the policy a
// human-readable markdown file (not a JSON blob or a form) keeps that boundary legible: an
// operator can read, diff, and version their book's behaviour in prose. We only parse it.
//
// SYNTAX — one rule per list item, first match wins:
//   - when <clauses> then <action>
// clauses (join with "and", all must hold):
//   • a kind:            steam | overreaction | goal_imminent
//   • an action:         follow | hold | fade | suspend         (the signal's recommendation)
//   • confidence >= N    (also: conf >= N)
//   • pickoff high|med   (also: risk >= high)
//   • gap >= N bps       (the stale-book gap; also: gap >= N)
//   • market <substr>    (e.g. market OVERUNDER)
// actions:
//   • suspend
//   • widen margin N%    (→ widen_margin, marginPct N)
//   • cut limit N%       (→ cut_limit, limitPct N)
//   • no action | none
// A line `default: <action>` sets the fallthrough (default {do:"none"}).
//
// Example:
//   # My book policy
//   - when goal_imminent then suspend
//   - when overreaction and confidence >= 0.7 then widen margin 4%
//   - when steam and pickoff high then cut limit 60%
//   default: no action

const KINDS = ["goal_imminent", "overreaction", "steam"];
const ACTIONS_WHEN = ["suspend", "follow", "hold", "fade"]; // signal.action values usable in `when`

// Parse the `then ...` half into a policy action object.
export function parseAction(text) {
  const s = String(text || "").toLowerCase().trim();
  if (!s || /^(no action|none|nothing|ignore)$/.test(s)) return { do: "none" };
  if (/suspend/.test(s)) return { do: "suspend" };
  let m = /widen\s*margin\s*(?:by\s*)?(\d+(?:\.\d+)?)\s*%?/.exec(s);
  if (m) return { do: "widen_margin", marginPct: Number(m[1]) };
  m = /(?:cut|reduce|lower)\s*limit\s*(?:to\s*)?(\d+(?:\.\d+)?)\s*%?/.exec(s);
  if (m) return { do: "cut_limit", limitPct: Number(m[1]) };
  m = /widen\s*(\d+(?:\.\d+)?)/.exec(s);
  if (m) return { do: "widen_margin", marginPct: Number(m[1]) };
  return { do: "none" };
}

// Parse the `when ...` half into a policy `when` clause object.
export function parseWhen(text) {
  const s = String(text || "").toLowerCase();
  const when = {};
  for (const k of KINDS) if (new RegExp(`\\b${k}\\b`).test(s)) { when.kind = k; break; }
  for (const a of ACTIONS_WHEN) {
    // a bare action word means "match this signal action", but not if it's the kind slot
    if (new RegExp(`\\b${a}\\b`).test(s) && a !== when.kind) { when.action = a; break; }
  }
  let m = /(?:confidence|conf)\s*(?:>=|>|≥|of at least|at least)?\s*(\d*\.?\d+)/.exec(s);
  if (m) when.minConfidence = Number(m[1]);
  m = /(?:pickoff|risk)\s*(?:>=|>|≥|of)?\s*(high|med|medium)/.exec(s);
  if (m) when.pickoffRisk = m[1] === "medium" ? "med" : m[1];
  m = /gap\s*(?:>=|>|≥)?\s*(\d+(?:\.\d+)?)\s*(?:bps)?/.exec(s);
  if (m) when.minGapBps = Number(m[1]);
  m = /market\s+([a-z0-9_\/]+)/.exec(s);
  if (m) when.market = m[1].toUpperCase();
  return when;
}

// Parse a whole markdown policy document → { rules:[{when,then}], default }.
// Robust: ignores headings, prose, blank lines; only `- when … then …` items and a
// `default:` line carry meaning. Never throws — an empty doc yields an empty policy.
export function parsePolicyMarkdown(md) {
  const lines = String(md ?? "").split(/\r?\n/);
  const rules = [];
  let def = { do: "none" };
  for (const raw of lines) {
    const line = raw.trim();
    const defMatch = /^(?:default|else|otherwise)\s*[:\-]\s*(.+)$/i.exec(line);
    if (defMatch) { def = parseAction(defMatch[1]); continue; }
    // a rule bullet: "- when X then Y" / "* when X then Y" / "1. when X then Y"
    const bullet = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    const body = bullet ? bullet[1] : null;
    if (!body || !/\bwhen\b/i.test(body) || !/\bthen\b/i.test(body)) continue;
    const m = /when\b(.*)\bthen\b(.*)$/i.exec(body);
    if (!m) continue;
    const when = parseWhen(m[1]);
    const then = parseAction(m[2]);
    rules.push({ when, then });
  }
  return { rules, default: def };
}

export const _internal = { KINDS, ACTIONS_WHEN };
