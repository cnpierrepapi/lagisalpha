import Link from "next/link";

const SECTIONS = [
  ["01", "Abstract"],
  ["02", "The problem: betting hides skill"],
  ["03", "The idea: a strategy is a research paper"],
  ["04", "The data layer: TxLINE"],
  ["05", "The edge engine"],
  ["06", "The decision core and CLV"],
  ["07", "Agents and the build loop"],
  ["08", "Proof and verifiability"],
  ["09", "The economy"],
  ["10", "The SDK"],
  ["11", "Roadmap"],
  ["12", "Responsible play"],
] as const;

function Section({
  id,
  num,
  title,
  children,
}: {
  id: string;
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-12 scroll-mt-20">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="label tabular-nums text-amber">{num}</span>
        <h2 className="serif text-2xl text-paper">{title}</h2>
      </div>
      <div className="space-y-4 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function Litepaper() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-10 border-b border-ink-600 pb-8">
        <p className="label">litepaper · v0.1</p>
        <h1 className="serif mt-2 text-4xl leading-tight text-paper">
          Agenthesis: strategies from research, traded by autonomous agents
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          A platform where every trading strategy is a published market-inefficiency result, every
          agent runs that strategy with no human in the loop, and every decision is graded on
          closing-line value over a verifiable, on-chain-anchored data feed.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <a
            href="/agenthesis-litepaper.pdf"
            download
            className="rounded border border-amber-dim bg-amber/10 px-4 py-2 text-amber hover:bg-amber/20"
          >
            ↓ Download PDF
          </a>
          <Link href="/sdk" className="card px-4 py-2 text-muted hover:text-fg">
            Integrate (SDK + API) →
          </Link>
        </div>
      </header>

      {/* TOC */}
      <nav className="card mb-12 p-5">
        <p className="label mb-3">contents</p>
        <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {SECTIONS.map(([num, title]) => (
            <li key={num}>
              <a
                href={`#s${num}`}
                className="flex gap-2 text-sm text-muted hover:text-amber"
              >
                <span className="tabular-nums text-faint">{num}</span>
                {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="s01" num="01" title="Abstract">
        <p>
          Sports and event betting is the largest unstructured prediction market on earth, yet it is
          treated as gambling rather than as a quantitative discipline. The reason is that outcomes
          are noisy: a good bet can lose and a bad bet can win, so over any human-scale sample,
          skill is statistically indistinguishable from luck. Agenthesis reframes the activity. We
          take published results about market inefficiencies, render each one as a runnable strategy,
          let autonomous agents trade them over a live, de-margined price feed, and grade every
          decision on <span className="amber">closing-line value</span> rather than on whether the
          bet won. CLV settles from odds alone, which makes skill measurable on every single
          decision instead of once per outcome.
        </p>
      </Section>

      <Section id="s02" num="02" title="The problem: betting hides skill">
        <p>
          The bookmaker&apos;s margin and the variance of outcomes do two things at once. The margin
          guarantees that the median participant loses, and the variance guarantees that the few who
          win cannot prove they did so on purpose. A bettor who is genuinely 3% sharper than the
          closing line will still spend long stretches underwater. Conventional platforms reward the
          appearance of winning — the lucky streak, the parlay screenshot — and have no instrument
          for the thing that actually compounds: consistently beating the price the market settles
          at.
        </p>
        <p>
          If you cannot measure skill cleanly, you cannot teach it, rank it, or build a market around
          it. That missing instrument is the gap Agenthesis fills.
        </p>
      </Section>

      <Section id="s03" num="03" title="The idea: a strategy is a research paper">
        <p>
          Every strategy on the platform is a published market-inefficiency result rendered as code.
          A paper maps to one <em className="text-fg">edge kind</em> in the engine plus a calibrated
          set of default levers — the parameter variant, which is the edge conditioned on a specific
          match context. Steam-chasing, post-event overreaction, and micro-drift quoting each
          correspond to a documented effect with an entry rule, a sizing rule, and a settlement rule.
        </p>
        <p>
          This makes strategy legible. You do not deploy a black box; you deploy a citation. The{" "}
          <Link href="/papers" className="text-amber hover:text-fg">
            research library
          </Link>{" "}
          is the strategy menu, and an agent&apos;s behaviour is fully explained by the papers it
          carries and the levers it was tuned with.
        </p>
      </Section>

      <Section id="s04" num="04" title="The data layer: TxLINE">
        <p>
          Agents trade over TxLINE, the World Cup data layer, which publishes a{" "}
          <span className="text-fg">de-margined (no-vig) book</span>. Because the vig is removed,
          each side&apos;s price is a clean implied probability: for a side priced{" "}
          <code className="text-info">price</code>, the fair probability is{" "}
          <code className="text-info">p = 1 / (price/1000)</code> with decimal odds{" "}
          <code className="text-info">O = 1/p</code>. That clean book is what lets the engine reason
          in probability units instead of fighting the margin.
        </p>
        <p>
          The feed is anchored on Solana, and access to it is minted by a real on-chain subscribe
          transaction. The same captured streams the live product replays — two complete matches,
          Brazil v Japan (13,335 odds frames) and Germany v Paris (8,230) — ship inside the
          repository, so the system is self-contained and every result is reproducible.
        </p>
      </Section>

      <Section id="s05" num="05" title="The edge engine">
        <p>
          The <code className="text-info">EdgeEngine</code> ingests odds and score frames and emits
          typed, scored edges of three kinds:
        </p>
        <ul className="ml-1 space-y-2">
          <li>
            <span className="amber">steam</span> — a sharp, fast move in fair probability that tends
            to continue rather than revert.
          </li>
          <li>
            <span className="amber">overreaction</span> — a post-event overshoot (a goal, a card)
            that the market corrects.
          </li>
          <li>
            <span className="amber">quote</span> — a micro-drift baseline that keeps an agent active
            between the louder signals.
          </li>
        </ul>
        <p>
          Each edge carries a magnitude in probability units and a conviction score. The engine is an
          event emitter with tunable thresholds and windows; downstream, nothing needs to know how an
          edge was found, only what it is worth.
        </p>
      </Section>

      <Section id="s06" num="06" title="The decision core and CLV">
        <p>
          The decision core is a pure mapping from an edge plus a lever set to a sized bet. An edge of
          magnitude <em className="text-fg">m</em> implies an expected captured move{" "}
          <code className="text-info">ê = κ·m</code>, an expected return{" "}
          <code className="text-info">e = ê / p_entry</code>, and a Kelly fraction{" "}
          <code className="text-info">f* = e / b</code> applied as fractional Kelly and capped, so no
          single bet can over-concentrate the bankroll.
        </p>
        <p>
          Settlement is closing-line value:{" "}
          <code className="text-info">back: r = (p_close − p_entry) / p_entry</code>. CLV measures
          whether you entered at a better price than the market closed at. Critically, it{" "}
          <span className="text-fg">resolves from odds alone</span> — the match outcome is never
          needed — so every decision is graded immediately and the skill signal is not buried under
          win/loss variance. This is the heart of the platform: a fast-settling, low-variance metric
          for being right about price.
        </p>
      </Section>

      <Section id="s07" num="07" title="Agents and the build loop">
        <p>
          An agent is a bankroll plus an ordered list of strategies. It runs its base tuning plus one
          lever set per attached paper; for each incoming edge, the first strategy that greenlights it
          takes the bet. There is no agent-versus-agent mechanic and no human override mid-match — the
          agent trades the live stream autonomously and its track record is entirely its own.
        </p>
        <p>
          In the{" "}
          <Link href="/build" className="text-amber hover:text-fg">
            builder
          </Link>{" "}
          you pick a paper, tune its levers (conviction, stake mode, Kelly fraction, phase, minute
          gates, odds band, concurrency, follow-or-fade), and deploy to the runner. The{" "}
          <Link href="/leaderboard" className="text-amber hover:text-fg">
            leaderboard
          </Link>{" "}
          ranks agents on realized performance.
        </p>
      </Section>

      <Section id="s08" num="08" title="Proof and verifiability">
        <p>
          Trust in a trading claim comes from being able to check it. Agenthesis exposes a one-page{" "}
          <Link href="/proof" className="text-amber hover:text-fg">
            audit trail
          </Link>{" "}
          with the full execution ledger — 300 trades across ten matches — where each trade carries a{" "}
          <code className="text-info">proofHash</code> tying it to the exact feed frame it was taken
          on.
        </p>
        <p>
          The Solana touchpoint is <span className="text-fg">proof of access</span>: a real on-chain
          subscribe transaction, signed with a wallet, mints the right to the TxLINE stream. That
          signature is a public, verifiable hash anyone can open on Solana Explorer, anchoring the
          claim that the data the agents trade comes from the genuine, authorized feed rather than a
          fabricated one.
        </p>
      </Section>

      <Section id="s09" num="09" title="The economy">
        <p>
          Every agent starts from the same fake-USD float, so the leaderboard measures strategy, not
          deposit size. <span className="amber">AGI</span> is the in-app token. It buys one thing —
          access to more research papers (roughly 1,000 AGI per paper). It is explicitly{" "}
          <span className="text-fg">never bankroll and never prize odds</span>: you cannot pay to
          trade bigger or to improve your standing. AGI buys knowledge; performance is earned on the
          feed.
        </p>
        <p>
          Rewards run on an operator-funded model: a daily pool (USDC plus AGI) is posted by the
          operator and split across the competing agents by skill. The platform never sells bankroll
          and never sells a share of the pool — the separation between what is purchasable (research)
          and what is earned (standing and rewards) is the integrity guarantee.
        </p>
      </Section>

      <Section id="s10" num="10" title="The SDK">
        <p>
          The quantitative layer is published as an embeddable SDK for desks that want to run the
          engine in their own stack. You bring your own feed and your own execution; the SDK turns the
          de-margined book into typed, scored edges and grades every decision on CLV. It is the exact
          pure, deterministic, unit-tested code the product runs — no I/O, no clock reads, no hidden
          state — which is what makes it safe to place next to real money.
        </p>
        <p>
          Read the integration guide and copy the quickstart on the{" "}
          <Link href="/sdk" className="text-amber hover:text-fg">
            SDK page
          </Link>
          .
        </p>
      </Section>

      <Section id="s11" num="11" title="Roadmap">
        <ul className="ml-1 space-y-2">
          <li>Expand the paper catalog and let agents carry deeper multi-paper stacks.</li>
          <li>
            Live, persistent agents on a continuous TxLINE worker beyond the captured-replay demo.
          </li>
          <li>
            Richer on-chain settlement: per-trade proofs anchored to the feed&apos;s Merkle roots.
          </li>
          <li>A skill profile per operator: CLV distribution, calibration, and persistence.</li>
        </ul>
      </Section>

      <Section id="s12" num="12" title="Responsible play">
        <p>
          Agenthesis is a research and skill-measurement platform built on captured and de-margined
          data. Agents trade a fake-USD float; the token buys research, not betting power. CLV is a
          measure of pricing skill, not a promise of profit, and past performance over a replay does
          not guarantee future results on a live book. Nothing here is financial advice.
        </p>
      </Section>

      <footer className="mt-6 border-t border-ink-600 pt-6 text-xs text-faint">
        Agenthesis · built on the TxLINE World Cup data layer ·{" "}
        <Link href="/desk" className="text-amber hover:text-fg">
          watch it trade live →
        </Link>
      </footer>
    </div>
  );
}
