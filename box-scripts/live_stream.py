# REAL-TIME DUAL STREAM (per-fill): TxLINE 1X2 fair (change-based) + Polymarket PER-TRADE fills
# (Data API /trades, real fill timestamps, so we catch every traded price, not the sluggish
# midpoint). Publishes two independent timestamped arrays to desk-archives/live-stream.json.
import json, os, time, subprocess
import live_edge as LE
import poly_pickoff_system as P

SUPA = P.SUPA
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
UA = "Mozilla/5.0"
POLL = 2
KEEP = 800
mk_cache = {}   # fid -> {"yes","cond"} or None
last_ts = {}    # fid -> last seen fill unix-seconds
streams = {}    # fid -> {"teams","txline":[[ts,fair]],"market":[[ts,pm]]}

def market_for(fid, p2, start):
    if fid not in mk_cache:
        mk = P.resolve_market(p2, start)
        mk_cache[fid] = {"yes": str(mk["yes"]), "cond": mk["cond"]} if mk else None
    return mk_cache[fid]

def pm_fills(fid, mk):
    out = subprocess.run(
        ["curl", "-s", "--max-time", "8", "-H", "User-Agent: " + UA,
         "https://data-api.polymarket.com/trades?market=" + mk["cond"] + "&limit=200&takerOnly=false"],
        capture_output=True, text=True).stdout
    try:
        arr = json.loads(out)
    except Exception:
        return []
    if not isinstance(arr, list):
        return []
    seen = last_ts.get(fid, 0.0)
    ticks = []
    maxts = seen
    for tr in sorted(arr, key=lambda x: float(x.get("timestamp", 0) or 0)):
        ts = float(tr.get("timestamp", 0) or 0)
        if ts <= seen:
            continue
        try:
            price = float(tr.get("price"))
        except Exception:
            continue
        asset = str(tr.get("asset", ""))
        prob = price if asset == mk["yes"] else 1 - price
        tsm = int(ts if ts > 1e12 else ts * 1000)
        ticks.append([tsm, round(prob, 4)])
        if ts > maxts:
            maxts = ts
    last_ts[fid] = maxts
    return ticks

def publish():
    fixtures = [{"fid": fid, "teams": s["teams"], "txline": s["txline"][-KEEP:], "market": s["market"][-KEEP:]} for fid, s in streams.items()]
    blob = {"generatedAt": int(time.time() * 1000), "poll": POLL, "fixtures": fixtures}
    open("/tmp/live-stream.json", "w").write(json.dumps(blob))
    if KEY:
        subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-X", "POST",
             SUPA + "/storage/v1/object/desk-archives/live-stream.json",
             "-H", "Authorization: Bearer " + KEY, "-H", "apikey: " + KEY,
             "-H", "Content-Type: application/json", "-H", "x-upsert: true",
             "--data-binary", "@/tmp/live-stream.json"],
            capture_output=True, text=True)

print("live_stream (per-fill) up, poll " + str(POLL) + "s", flush=True)
while True:
    try:
        fixs = LE.live_fixtures()
        # prune fixtures that left the live window: keeping every finished match made the
        # published blob grow without bound (dead ticks re-served by Vercel on every
        # revalidate window = cached-egress bleed). Publish once more after a prune so the
        # stored blob actually shrinks.
        live_now = {str(fx["fid"]) for fx in fixs}
        pruned = [fid for fid in list(streams) if fid not in live_now]
        for fid in pruned:
            del streams[fid]
            mk_cache.pop(fid, None)
            last_ts.pop(fid, None)
        for fx in fixs:
            fid = str(fx["fid"])
            if fid not in streams:
                streams[fid] = {"teams": str(fx["p1"]) + " v " + str(fx["p2"]), "txline": [], "market": []}
            fv = LE.fair_1x2(fx["fid"])
            if fv is not None:
                tl = streams[fid]["txline"]
                v = round(fv["fair"], 4)
                if not tl or tl[-1][1] != v:
                    tl.append([int(fv.get("ts") or time.time() * 1000), v])
                    streams[fid]["txline"] = tl[-KEEP:]
            mk = market_for(fid, fx["p2"], fx["start"])
            if mk:
                for tsm, prob in pm_fills(fid, mk):
                    mkt = streams[fid]["market"]
                    if not mkt or mkt[-1][1] != prob:
                        mkt.append([tsm, prob])
                        streams[fid]["market"] = mkt[-KEEP:]
        if fixs or pruned:
            publish()
    except Exception as e:
        print("err " + str(e), flush=True)
    time.sleep(POLL)
