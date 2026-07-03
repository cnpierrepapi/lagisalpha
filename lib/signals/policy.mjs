// OPERATOR POLICY DSL — the operator's side of the read-only boundary. Pure.
//
// Agenthesis emits a signal. What happens next is 100% the operator's call, written as a
// rule-set THEY control. This evaluator matches a signal against their rules and reports
// which rule fired and what action IT prescribes — we compute the decision, we never
// execute it. That separation is the product: the operator keeps the book, we supply the
// warning + the on-chain proof.
//
// A policy is { rules: [ { when, then } ], default? }:
//   when : { kind?, action?, minConfidence?, pickoffRisk?, market?, minGapBps? }
//          (all present clauses must match; pickoffRisk/gap are the pickoff-severity gates)
//   then : { do: "widen_margin" | "cut_limit" | "suspend" | "none",
//            marginPct?, limitPct?, note? }
// First matching rule wins; else `default` (or {do:"none"}). Deterministic.
//
// Example (the demo policy file):
//   { "rules": [
//       { "when": { "kind": "overreaction", "minConfidence": 0.7 }, "then": { "do": "widen_margin", "marginPct": 4 } },
//       { "when": { "kind": "goal_imminent" },                     "then": { "do": "suspend" } },
//       { "when": { "kind": "steam", "pickoffRisk": "high" },       "then": { "do": "cut_limit", "limitPct": 50 } }
//   ] }

const RISK_RANK = { low: 0, med: 1, high: 2 };

function clauseMatches(when, sig) {
  if (!when) return true;
  if (when.kind && when.kind !== sig.kind) return false;
  if (when.action && when.action !== sig.action) return false;
  if (when.minConfidence != null && !(Number(sig.confidence) >= when.minConfidence)) return false;
  if (when.market && !String(sig.market || "").includes(when.market)) return false;
  if (when.pickoffRisk != null) {
    if ((RISK_RANK[sig.pickoffRisk] ?? -1) < (RISK_RANK[when.pickoffRisk] ?? 99)) return false;
  }
  if (when.minGapBps != null) {
    if (sig.gapBps == null || Math.abs(sig.gapBps) < when.minGapBps) return false;
  }
  return true;
}

// Evaluate a policy against one signal → { ruleIndex, action, note }. ruleIndex = -1 when
// only the default fired. `action` is the operator's prescribed action object.
export function evaluatePolicy(policy, sig) {
  const rules = policy?.rules || [];
  for (let i = 0; i < rules.length; i++) {
    if (clauseMatches(rules[i].when, sig)) {
      return { ruleIndex: i, action: rules[i].then || { do: "none" }, matched: true };
    }
  }
  return { ruleIndex: -1, action: policy?.default || { do: "none" }, matched: false };
}

// Human-readable one-liner for the control-room log (what the operator's book did).
export function describeAction(action) {
  switch (action?.do) {
    case "widen_margin": return `widen margin +${action.marginPct ?? "?"}%`;
    case "cut_limit": return `cut limit to ${action.limitPct ?? "?"}%`;
    case "suspend": return "suspend market";
    default: return "no action";
  }
}

// A sensible built-in demo policy so the control-room works out of the box.
export const DEMO_POLICY = {
  rules: [
    { when: { kind: "goal_imminent" }, then: { do: "suspend", note: "goal imminent" } },
    { when: { kind: "overreaction", minConfidence: 0.7 }, then: { do: "widen_margin", marginPct: 4, note: "fade the overshoot" } },
    { when: { kind: "overreaction" }, then: { do: "cut_limit", limitPct: 50, note: "hold, don't chase" } },
    { when: { kind: "steam", pickoffRisk: "high" }, then: { do: "cut_limit", limitPct: 60, note: "stale on a true move" } },
  ],
  default: { do: "none" },
};
