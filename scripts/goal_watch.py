#!/usr/bin/env python3
# GOAL-IMMINENT overlay: from TxLINE's scores stream, extract high-danger pressure and add a `goalWatch`
# list to each match surface. A high_danger_possession makes a goal by that team ~4x more likely in the
# next 2 min (4.6% vs 1.1% baseline) - it is an early "watch this team's line" alert ahead of the
# post-goal fair jump. Consecutive high-danger for the same team within 60s is clustered into one marker.
# Run on the box, then re-run compute_edge.py to republish (it preserves goalWatch).
import json, glob, os
ARCH = "/home/ec2-user/match-archive/mainnet/live"
WIN = 120000  # 2-min lookahead for ledToGoal

for sf in glob.glob("/home/ec2-user/pickoff/*.surface.json"):
    surf = json.load(open(sf))
    fid = str(surf["fid"]); kick = surf["kick"]
    teams = (surf.get("teams") or "").split(" v ")
    tn = lambda k: (teams[k - 1].strip() if len(teams) >= k else "P%d" % k)
    ap = os.path.join(ARCH, fid + ".json")
    if not os.path.exists(ap):
        surf["goalWatch"] = []; json.dump(surf, open(sf, "w"), indent=1); print(fid, "no archive"); continue
    sc = json.load(open(ap)).get("scores", [])
    # goals via per-side goal-count deltas (Stats "1"/"2")
    goals = []; last1 = last2 = None
    for r in sc:
        st = r.get("Stats") or {}; ts = r.get("Ts")
        g1 = st.get("1"); g2 = st.get("2")
        if g1 is not None and last1 is not None and g1 > last1: goals.append((ts, 1))
        if g2 is not None and last2 is not None and g2 > last2: goals.append((ts, 2))
        if g1 is not None: last1 = g1
        if g2 is not None: last2 = g2
    goal_after = lambda ts, team: any(gt > ts and gt <= ts + WIN and gtm == team for gt, gtm in goals)
    # high-danger events, clustered per team within 60s
    hd = sorted((r["Ts"], r.get("Possession")) for r in sc
                if r.get("Action") == "high_danger_possession" and r.get("Possession") in (1, 2))
    watch = []; i = 0
    while i < len(hd):
        ts, team = hd[i]; j = i; cnt = 1
        while j + 1 < len(hd) and hd[j + 1][1] == team and hd[j + 1][0] - hd[j][0] <= 60000:
            j += 1; cnt += 1
        watch.append({"min": max(0, round((ts - kick) / 60000)), "ts": ts // 1000, "team": team,
                      "teamName": tn(team), "pressure": cnt, "ledToGoal": goal_after(ts, team)})
        i = j + 1
    surf["goalWatch"] = watch
    json.dump(surf, open(sf, "w"), indent=1)
    print(fid, (surf.get("teams") or "")[:22], "markers", len(watch), "led-to-goal", sum(1 for w in watch if w["ledToGoal"]))
print("goal_watch done")
