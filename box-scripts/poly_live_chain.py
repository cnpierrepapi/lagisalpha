#!/usr/bin/env python3
# LIVE CHAIN TAILER — append on-chain Polymarket fills the Data API missed, while the match runs.
#
# The Data-API forward collector (poly_live_collector.py) cursors on trade timestamps, so a print the
# indexer surfaces late (or one sharing the cursor's timestamp boundary) is skipped forever. That is
# exactly how the Norway v England exit fill (0x11f4..., $645 at/through fair) never reached
# ~/poly-live/ and the live detector could not fire the exit the /proof recorder later proved.
#
# This tailer reads the SAME source /edge and /proof use — OrderFilled events decoded straight from
# the Polygon chain (poly_pickoff_system's decoder, 10-block getLogs chunks, exact block timestamps)
# — but live, in small increments, instead of backfilled after full time. Fills are appended to the
# same ~/poly-live/{cond}.jsonl in the collector's schema (tagged "src":"chain"), deduped by tx hash,
# so live_edge.py consumes them with no changes.
#
# Gate: only markets whose Data-API cursor advanced in the last ACTIVE_WINDOW_S (i.e. actively
# trading = match live-ish) are tailed, keeping RPC usage a rounding error on the free tier.
#
#   cron: */2 during match hours, right after poly_live_collector.py
#   debug: python3 poly_live_chain.py --range <cond> <fromBlock> <toBlock>   (one bounded pass)
import json, os, sys, time
from pathlib import Path
import poly_live_collector as C
import poly_pickoff_system as P

OUT = Path(os.environ.get("POLY_LIVE_DIR", str(Path.home() / "poly-live")))
OUT.mkdir(parents=True, exist_ok=True)
STATE = OUT / "chain-cursors.json"
LOCK = OUT / ".chain.lock"
ACTIVE_WINDOW_S = 30 * 60   # tail a market only if the Data-API saw a trade this recently
MAX_LOOKBACK = 900          # blocks (~30 min on Polygon); bigger gaps belong to the post-match backfill
FIRST_LOOKBACK = 150        # blocks (~5 min) the first time we see a market trading


def load_state():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}


def known_txs(cond):
    txs = set()
    p = OUT / ("%s.jsonl" % cond)
    if not p.exists():
        return txs
    for line in p.open():
        try:
            tx = json.loads(line).get("transactionHash")
            if tx:
                txs.add(tx.lower())
        except Exception:
            continue
    return txs


def tokens_of(meta):
    toks = meta.get("tokens")
    if isinstance(toks, str):
        toks = json.loads(toks)
    return int(toks[0]), int(toks[1])


def tail_market(cond, meta, st, latest):
    yes, no = tokens_of(meta)
    rec = st.get(cond) or {}
    topic0 = rec.get("topic0")
    if not topic0:
        topic0 = P.learn_topic0(cond, yes, no)
        if not topic0:
            return 0  # no Data-API trade to learn from yet; next run
    frm = rec.get("blk")
    frm = (latest - FIRST_LOOKBACK) if not frm else max(frm + 1, latest - MAX_LOOKBACK)
    if frm > latest:
        st[cond] = {"blk": latest, "topic0": topic0}
        return 0

    seen = known_txs(cond)
    rows = []
    f = frm
    while f <= latest:
        t = min(f + 9, latest)
        res = P.getlogs10(f, t, topic0)
        if res is None:      # transient RPC failure: retry this window next run, do not skip prints
            latest = f - 1
            break
        for lg in res:
            d = P.decode(lg, yes, no)
            if not d:
                continue
            tx = lg["transactionHash"].lower()
            if tx in seen:
                continue
            seen.add(tx)
            rows.append({"blk": int(lg["blockNumber"], 16), "tx": lg["transactionHash"], **d})
        f = t + 1

    n = 0
    if rows:
        tsmap = P.timestamps_for([r["blk"] for r in rows])
        with (OUT / ("%s.jsonl" % cond)).open("a", encoding="utf-8") as fh:
            for r in rows:
                bt = tsmap.get(r["blk"])
                if bt is None:
                    continue
                fh.write(json.dumps({
                    "timestamp": bt,
                    "side": "BUY",
                    "price": round(r["price"], 4),
                    "size": round(r["shares"], 4),
                    "outcome": "Yes" if r["token"] == yes else "No",
                    "conditionId": cond,
                    "asset": str(r["token"]),
                    "transactionHash": r["tx"],
                    "src": "chain",
                }) + "\n")
                n += 1
    if latest >= frm - 1:
        st[cond] = {"blk": latest, "topic0": topic0}
    return n


def main():
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 600:
        print("another chain-tail run in progress (lock)")
        return
    LOCK.write_text(str(os.getpid()))
    try:
        cur = C.load_state()          # the Data-API collector's per-market trade cursors
        now = time.time()
        active = {c for c, ts in cur.items() if now - float(ts) <= ACTIVE_WINDOW_S}
        if not active:
            print("no actively-trading market; nothing to tail")
            return
        matches = C.today_matches()
        st = load_state()
        latest = int(P.rpc("eth_blockNumber", [], 10), 16)
        total = 0
        for cond, meta in matches.items():
            if cond not in active:
                continue
            try:
                n = tail_market(cond, meta, st, latest)
                total += n
                print("  %s: +%d chain fill(s)" % (meta.get("slug", cond), n))
            except Exception as e:
                print("  %s: tail error %s" % (cond, e))
        STATE.write_text(json.dumps(st))
        print("done: %d chain fill(s) appended across %d active market(s)" % (total, len(active)))
    finally:
        LOCK.unlink(missing_ok=True)


def range_test(cond, frm, to):
    # bounded one-off pass over an explicit block range (no active gate, no cursor writes).
    matches = C.today_matches()
    meta = matches.get(cond)
    if not meta:
        # market may be from a past day (gone from Gamma's day search); CLOB serves it by condition id
        d = P.dget("https://clob.polymarket.com/markets/%s" % cond) or {}
        toks = [t.get("token_id") for t in (d.get("tokens") or [])]
        if len(toks) < 2:
            print("unknown market", cond)
            return
        meta = {"slug": d.get("market_slug"), "tokens": toks}
    yes, no = tokens_of(meta)
    topic0 = P.learn_topic0(cond, yes, no)
    print("market %s topic0 %s" % (meta.get("slug"), topic0))
    seen = known_txs(cond)
    found = []
    f = frm
    while f <= to:
        t = min(f + 9, to)
        res = P.getlogs10(f, t, topic0) or []
        for lg in res:
            d = P.decode(lg, yes, no)
            if d:
                found.append((int(lg["blockNumber"], 16), lg["transactionHash"], d,
                              lg["transactionHash"].lower() in seen))
        f = t + 1
    tsmap = P.timestamps_for([b for b, _, _, _ in found])
    for b, tx, d, dup in found:
        imp = d["price"] if d["token"] == yes else 1 - d["price"]
        print("blk %d ts %s imp %.4f usd %.0f tx %s %s"
              % (b, tsmap.get(b), imp, d["price"] * d["shares"], tx, "[already in jsonl]" if dup else "[MISSING -> would append]"))


if __name__ == "__main__":
    if len(sys.argv) > 4 and sys.argv[1] == "--range":
        range_test(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
    else:
        main()
