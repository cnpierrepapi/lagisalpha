#!/usr/bin/env python3
# One-shot patch: bake the SIGNAL POLICY into compute_edge.py at the source, so the blob's per-entry
# `incl` flag, per-match edge, pooled agg, and bootstrap CIs are all coherent under the policy.
# Policy: full Kelly; exclude ONLY buy-NO duds - a buy-NO >=25pp (giant NO lag) or after minute 80.
import sys
P = "/home/ec2-user/compute_edge.py"
s = open(P).read()

def rep(old, new):
    global s
    c = s.count(old)
    if c != 1:
        sys.exit(f"PATCH ABORT: expected 1 match, found {c} for: {old[:60]!r}")
    s = s.replace(old, new)

# 1) tag every entry with `incl` (buy-NO is NO iff sgn<=0; minute = (ms-kick)/60000)
rep('"clv":round(clv,4),"fills":efills})',
    '"clv":round(clv,4),"incl":(not((sgn<=0) and (abs(gap)>=0.25 or (ms-mm["kick"])/60000.0>80))),"fills":efills})')

# 2) per-match edge over INCLUDED calls (store all entries, but grade on the signals)
rep('n=len(ents); reach=sum(e["reached"] for e in ents)',
    'inc=[e for e in ents if e.get("incl",True)]; n=len(inc); reach=sum(e["reached"] for e in inc)')
rep('cost=sum(e["entry"] for e in ents); winsum=sum(e["win"] for e in ents)',
    'cost=sum(e["entry"] for e in inc); winsum=sum(e["win"] for e in inc)')
rep('tpsum=sum(tp_pnl(e) for e in ents); clvsum=sum(e["clv"] for e in ents)',
    'tpsum=sum(tp_pnl(e) for e in inc); clvsum=sum(e["clv"] for e in inc)')
rep('"winRate":round(winsum/n,3) if n else 0,"usd":round(sum(e["usd"] for e in ents)),',
    '"winRate":round(winsum/n,3) if n else 0,"usd":round(sum(e["usd"] for e in inc)),')
rep('"kellyRoi":round(prod(kelly_mult_tp(e) for e in ents)-1,4) if n else 0}',
    '"kellyRoi":round(prod(kelly_mult_tp(e) for e in inc)-1,4) if n else 0}')

# 3) pooled agg over included calls
rep('def agg(entries):',
    'def agg(entries):\n    entries=[e for e in entries if e.get("incl",True)]  # SIGNAL POLICY: pooled over included calls only')

# 4) per-match lists feeding the pooled agg + bootstrap CIs -> included only
rep('for k in ("5","10"): per[k].append(ents[k])',
    'for k in ("5","10"): per[k].append([e for e in ents[k] if e.get("incl",True)])')

open(P, "w").write(s)
print("compute_edge.py patched OK")
