// OPERATOR BOOK PARSER — turn an uploaded odds book (JSON or YAML) into the price we
// benchmark against TxLINE's demargined fair line. Pure (no I/O; the caller reads the file).
//
// This is the operator's OWN book — the thing that gets picked off. Linethesis never
// touches it; it just measures the gap between what the operator quotes and the vig-free
// consensus, and warns when that gap is a pickoff. In the /live sandbox an operator uploads
// their book for a recorded match; the gap is computed against the same demargined frames
// the classifier runs on.
//
// LENIENT by design (per the product decision): a quote MAY carry a `ts` (→ step-aligned
// time-series: we use the latest quote at/before each of our frames) or NOT (→ static: the
// same price applies across the whole match). A file may mix the two — ts'd quotes align,
// un-ts'd ones are the fallback baseline.
//
// Accepted shape (JSON or YAML), forgiving on names/casing:
//   { fixtureId?, quotes: [ { market, line, side, period?, ts?, odds? | prob? } ] }
//   ("book"/"lines" also accepted as the array key; market "O/U"|"OVERUNDER"|full all work.)
import { parse as parseYaml } from "yaml";

// Canonical SuperOddsType from a loose market label.
export function canonMarket(m) {
  const s = String(m || "").toUpperCase();
  if (/(OVERUNDER|O\/U|OU|OVER_?UNDER|TOTAL)/.test(s)) return "OVERUNDER_PARTICIPANT_GOALS";
  if (/(ASIANHANDICAP|ASIAN|AH|HANDICAP|SPREAD)/.test(s)) return "ASIANHANDICAP_PARTICIPANT_GOALS";
  return s || null;
}

// Canonical side token. O/U → over|under ; AH → part1|part2.
export function canonSide(side) {
  const s = String(side || "").toLowerCase().trim();
  if (/(^|[^a-z])(over|o)([^a-z]|$)/.test(s) || s === "over") return "over";
  if (/(^|[^a-z])(under|u)([^a-z]|$)/.test(s) || s === "under") return "under";
  if (/(part(icipant)?\s*1|home|p1|^1$|team1)/.test(s)) return "part1";
  if (/(part(icipant)?\s*2|away|p2|^2$|team2)/.test(s)) return "part2";
  return s || null;
}

// "line=2.5" | "2.5" | 2.5 | "-0.75" → number (null if absent/unparseable).
export function canonLine(line) {
  if (line == null) return null;
  const m = /(-?\d+(?:\.\d+)?)/.exec(String(line));
  return m ? Number(m[1]) : null;
}

// odds (decimal) or prob → implied probability in (0,1), else null.
function quoteProb(q) {
  if (q.prob != null && Number(q.prob) > 0 && Number(q.prob) < 1) return Number(q.prob);
  const odds = q.odds ?? q.price ?? q.decimal;
  if (odds != null && Number(odds) > 1) return 1 / Number(odds);
  // some feeds give price in milli-decimal (1950 = 1.95)
  if (odds != null && Number(odds) > 100) return 1000 / Number(odds);
  return null;
}

// Parse raw uploaded TEXT (auto-detect JSON vs YAML) into a normalized book.
// Returns { fixtureId, quotes:[{superOddsType,line,side,period,ts,prob}], warnings:[] }.
// Throws only on total garbage; individual bad quotes are dropped with a warning.
export function parseBook(text) {
  let raw;
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("empty file");
  try {
    raw = JSON.parse(trimmed);
  } catch {
    raw = parseYaml(trimmed); // YAML is a superset-ish; falls through for .yaml/.yml
  }
  if (raw == null || typeof raw !== "object") throw new Error("not an object");

  const arr = raw.quotes ?? raw.book ?? raw.lines ?? (Array.isArray(raw) ? raw : null);
  if (!Array.isArray(arr)) throw new Error("no `quotes` array found");

  const warnings = [];
  const quotes = [];
  arr.forEach((q, i) => {
    const superOddsType = canonMarket(q.market ?? q.superOddsType ?? q.type);
    const side = canonSide(q.side ?? q.selection ?? q.name);
    const line = canonLine(q.line ?? q.marketParameters ?? q.handicap ?? q.total);
    const prob = quoteProb(q);
    if (!superOddsType || !side || line == null || prob == null) {
      warnings.push(`quote #${i + 1} skipped (need market, side, line, and odds/prob)`);
      return;
    }
    quotes.push({
      superOddsType,
      line,
      side,
      period: q.period ?? q.marketPeriod ?? "null",
      ts: q.ts != null ? Number(q.ts) : null,
      prob,
    });
  });
  if (!quotes.length) throw new Error(`no usable quotes (${warnings.length} skipped)`);
  return { fixtureId: raw.fixtureId ?? raw.fid ?? null, quotes, warnings };
}

// Does a normalized quote describe the same market/side as `meta`? Period is matched
// loosely ("null"/absent = full match, treated as wildcard-compatible).
function quoteMatches(q, meta) {
  if (q.superOddsType !== meta.superOddsType) return false;
  if (q.side !== meta.side) return false;
  if (canonLine(q.line) !== canonLine(meta.line)) return false;
  const a = String(q.period ?? "null"), b = String(meta.period ?? "null");
  return a === b || a === "null" || b === "null";
}

// The operator book's implied prob for a market/side at match-time `ts`.
//   • quotes WITH ts → step-aligned: the latest quote at/before ts (or the earliest, so a
//     book that starts mid-match still anchors a baseline before its first stamp).
//   • quotes WITHOUT ts → static: that price holds for the whole match.
//   • both present → prefer the step-aligned value; fall back to the static one.
// Returns a probability in (0,1) or null when the book doesn't quote this market.
export function bookProbAt(book, meta, ts) {
  if (!book?.quotes?.length) return null;
  const matches = book.quotes.filter((q) => quoteMatches(q, meta));
  if (!matches.length) return null;

  const stamped = matches.filter((q) => q.ts != null).sort((a, b) => a.ts - b.ts);
  const staticQ = matches.find((q) => q.ts == null);

  if (stamped.length) {
    let chosen = null;
    for (const q of stamped) {
      if (q.ts <= ts) chosen = q;
      else break;
    }
    if (chosen) return chosen.prob;
    // ts is before the first stamped quote → use the static baseline if any, else the first stamp
    if (staticQ) return staticQ.prob;
    return stamped[0].prob;
  }
  return staticQ ? staticQ.prob : null;
}

export const _internal = { quoteProb, quoteMatches };
