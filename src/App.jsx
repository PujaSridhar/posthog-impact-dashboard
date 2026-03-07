import { useState, useCallback } from "react";

const REPO = "PostHog/posthog";
const DAYS = 90;
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

// ─── Impact Profile logic ────────────────────────────────────────────────────
function getProfile(e) {
  // Use relative strengths so labels vary even with small review samples.
  // Compare each engineer's own stats to decide their primary identity.
  const shippingScore = e.prs_merged * 8;
  const reviewScore   = e.reviews * 3 + e.changes_requested * 4;
  const commitScore   = e.commits;

  const isShipper  = e.prs_merged >= 10;
  const isReviewer = e.reviews >= 3;
  const isCatcher  = e.changes_requested >= 2;
  const isEngine   = e.commits >= 20 && shippingScore < commitScore * 3;

  // Primary identity = highest weighted dimension
  const reviewDominant = reviewScore > shippingScore * 0.6;

  if (isShipper && isCatcher)               return { label: "The All-Rounder",      color: "#f5c542", desc: "Ships features AND actively catches bugs in review" };
  if (isCatcher && reviewDominant)          return { label: "The Quality Guardian",  color: "#60a5fa", desc: "Actively catches bugs before they land in main" };
  if (isShipper && isReviewer)              return { label: "The Shipping Reviewer", color: "#22d3ee", desc: "Delivers features while keeping teammates unblocked" };
  if (isReviewer && !isShipper)             return { label: "The Code Reviewer",     color: "#a78bfa", desc: "Keeps team quality high through thorough reviews" };
  if (isEngine)                             return { label: "The Code Engine",       color: "#fb923c", desc: "High commit breadth — touches many parts of the codebase" };
  if (isShipper)                            return { label: "The Feature Shipper",   color: "#4ade80", desc: "Consistently delivers merged work at pace" };
  return                                           { label: "The Contributor",       color: "#8892a4", desc: "Steady, reliable contributor across the codebase" };
}

// ─── GitHub fetch helpers ────────────────────────────────────────────────────
async function fetchAll(url, token, pages = 3) {
  const results = [];
  for (let page = 1; page <= pages; page++) {
    const sep = url.includes("?") ? "&" : "?";
    const res = await fetch(`${url}${sep}per_page=100&page=${page}`, {
      headers: token ? { Authorization: `token ${token}` } : {},
    });
    if (!res.ok) {
      if (res.status === 403) throw new Error("403: Rate limited. Add a GitHub token to continue.");
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    results.push(...data);
    if (data.length < 100) break;
  }
  return results;
}

async function fetchGitHubData(token) {
  const headers = token ? { Authorization: `token ${token}` } : {};

  // 1. Commits in last 90 days
  const commits = await fetchAll(
    `https://api.github.com/repos/${REPO}/commits?since=${since}`,
    token, 5
  );

  // 2. Closed/merged PRs in last 90 days
  //    NOTE: The pulls list view does NOT return additions/deletions per PR.
  //    Fetching those individually would burn the rate limit instantly (1 req/PR).
  //    We use review_comments + comments from the list view instead as a depth proxy.
  const closedPRs = await fetchAll(
    `https://api.github.com/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc`,
    token, 5
  );
  const recentPRs = closedPRs.filter(
    pr => pr.merged_at && new Date(pr.merged_at) >= new Date(since)
  );

  // 3. PR reviews — capped at 25 most recent PRs to protect the rate limit budget.
  //    Without token: 60 req/hr total. Commits + PRs use ~8. 25 review fetches = safe.
  //    With token: 5,000/hr, trivially safe.
  const reviewMap = {};
  const prSample = recentPRs.slice(0, 25);
  await Promise.all(prSample.map(async pr => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/pulls/${pr.number}/reviews`,
        { headers }
      );
      if (!res.ok) return;
      const reviews = await res.json();
      reviews.forEach(r => {
        if (!r.user || r.user.type === "Bot") return;
        const login = r.user.login;
        if (!reviewMap[login]) reviewMap[login] = { reviews: 0, approvals: 0, changes_requested: 0 };
        reviewMap[login].reviews++;
        if (r.state === "APPROVED") reviewMap[login].approvals++;
        if (r.state === "CHANGES_REQUESTED") reviewMap[login].changes_requested++;
      });
    } catch { /* skip individual PR failures silently */ }
  }));

  // 4. Issues closed.
  //    IMPORTANT: GitHub's `since` param on the issues API filters by updated_at,
  //    NOT closed_at. We add a secondary filter on closed_at for accuracy.
  //    Also: every PR is an issue in GitHub's model — strip those with !i.pull_request.
  const issues = await fetchAll(
    `https://api.github.com/repos/${REPO}/issues?state=closed&since=${since}&sort=updated`,
    token, 3
  );
  const realIssues = issues.filter(
    i => !i.pull_request && i.closed_at && new Date(i.closed_at) >= new Date(since)
  );

  // ─── Aggregate per engineer ──────────────────────────────────────────────
  const engineers = {};
  const BOT_LOGINS = new Set(["dependabot", "dependabot[bot]", "posthog-bot", "github-actions[bot]", "renovate[bot]"]);

  const ensure = (login, avatar) => {
    if (!engineers[login]) {
      engineers[login] = { login, avatar, commits: 0, prs_merged: 0, reviews: 0, approvals: 0, changes_requested: 0, issues_closed: 0, pr_titles: [] };
    }
  };

  commits.forEach(c => {
    if (!c.author || c.author.type === "Bot" || BOT_LOGINS.has(c.author.login)) return;
    ensure(c.author.login, c.author.avatar_url);
    engineers[c.author.login].commits++;
  });

  recentPRs.forEach(pr => {
    if (!pr.user || pr.user.type === "Bot" || BOT_LOGINS.has(pr.user.login)) return;
    ensure(pr.user.login, pr.user.avatar_url);
    const e = engineers[pr.user.login];
    e.prs_merged++;
    if (e.pr_titles.length < 3) e.pr_titles.push(pr.title);
  });

  Object.entries(reviewMap).forEach(([login, data]) => {
    if (BOT_LOGINS.has(login)) return;
    if (!engineers[login]) ensure(login, null);
    engineers[login].reviews = data.reviews;
    engineers[login].approvals = data.approvals;
    engineers[login].changes_requested = data.changes_requested;
  });

  realIssues.forEach(issue => {
    if (issue.closed_by && issue.closed_by.type !== "Bot" && !BOT_LOGINS.has(issue.closed_by.login)) {
      const login = issue.closed_by.login;
      if (engineers[login]) engineers[login].issues_closed++;
    }
  });

  // ─── Score ────────────────────────────────────────────────────────────────
  // PRs Merged        × 8  — primary shipping signal
  // Changes Requested × 4  — weighted higher than approvals: actually reading the diff
  // Reviews Given     × 3  — knowledge-sharing & team quality
  // Issues Closed     × 2  — delivery/completion
  // Commits           × 1  — activity breadth
  // Approvals         × 1  — participation in review process
  const scored = Object.values(engineers)
    .filter(e => e.commits + e.prs_merged + e.reviews > 2)
    .map(e => {
      const score = Math.round(
        e.prs_merged * 8 +
        e.changes_requested * 4 +
        e.reviews * 3 +
        e.issues_closed * 2 +
        e.commits * 1 +
        e.approvals * 1
      );
      return { ...e, score, profile: getProfile(e) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    engineers: scored,
    meta: {
      total_commits: commits.length,
      total_prs: recentPRs.length,
      reviews_sampled: prSample.length,
      total_reviews: Object.values(reviewMap).reduce((s, r) => s + r.reviews, 0),
      days: DAYS,
      fetched_at: new Date().toLocaleString(),
    }
  };
}

// ─── Mini progress bar ───────────────────────────────────────────────────────
function MiniBar({ value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ height: 5, borderRadius: 3, background: "#1e2433", flex: 1, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.8s ease" }} />
      </div>
      <span style={{ fontSize: 11, color: "#8892a4", minWidth: 24, textAlign: "right" }}>{value}</span>
    </div>
  );
}

const RANK_COLORS = ["#f5c542", "#b0bec5", "#cd7f32", "#7c9cbf", "#9c7cbf"];
const RANK_LABELS = ["#1", "#2", "#3", "#4", "#5"];
const METRIC_DEFS = [
  { key: "prs_merged",        label: "PRs Merged",   color: "#4ade80", tip: "Merged PRs — primary shipping signal" },
  { key: "reviews",           label: "Reviews",       color: "#60a5fa", tip: "Code reviews given across the team's PRs (sampled from 25 most recent PRs)" },
  { key: "commits",           label: "Commits",       color: "#a78bfa", tip: "Commit activity breadth across the codebase" },
  { key: "changes_requested", label: "Issues Caught", color: "#fb923c", tip: "Changes Requested in review — weighted ×4, highest after PRs, signals real code reading" },
];

// ─── Engineer Card ───────────────────────────────────────────────────────────
function EngineerCard({ engineer: e, rank, isExpanded, onToggle, maxValues }) {
  const rankColor = RANK_COLORS[rank];
  const breakdown = [
    { label: "PRs×8",           val: e.prs_merged * 8 },
    { label: "IssuesCaught×4",  val: e.changes_requested * 4 },
    { label: "Reviews×3",       val: e.reviews * 3 },
    { label: "IssuesClosed×2",  val: e.issues_closed * 2 },
    { label: "Commits×1",       val: e.commits },
    { label: "Approvals×1",     val: e.approvals },
  ].filter(s => s.val > 0);

  return (
    <div
      onClick={onToggle}
      style={{
        background: isExpanded ? "#111827" : "#0d1117",
        border: `1px solid ${isExpanded ? rankColor + "55" : "#1e2433"}`,
        borderRadius: 12, padding: "14px 18px", cursor: "pointer",
        transition: "all 0.2s ease", position: "relative", overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: rankColor, borderRadius: "12px 0 0 12px" }} />

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          {e.avatar
            ? <img src={e.avatar} alt={e.login} style={{ width: 38, height: 38, borderRadius: "50%", border: `2px solid ${rankColor}44` }} />
            : <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#1e2433", display: "flex", alignItems: "center", justifyContent: "center", color: "#8892a4" }}>?</div>
          }
          <div style={{ position: "absolute", bottom: -2, right: -4, background: rankColor, color: "#000", fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "1px 3px", fontFamily: "monospace" }}>
            {RANK_LABELS[rank]}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{ color: "#e8ecf0", fontWeight: 600, fontSize: 15, fontFamily: "monospace" }}>{e.login}</span>
            <a href={`https://github.com/${e.login}`} target="_blank" rel="noopener noreferrer"
              onClick={ev => ev.stopPropagation()}
              style={{ fontSize: 10, color: "#4a5568", textDecoration: "none", border: "1px solid #1e2433", borderRadius: 4, padding: "1px 5px" }}>
              ↗ github
            </a>
            <span style={{ fontSize: 10, color: e.profile.color, background: e.profile.color + "18", border: `1px solid ${e.profile.color}44`, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>
              {e.profile.label}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            {METRIC_DEFS.slice(0, 3).map(m => (
              <span key={m.key} style={{ fontSize: 11, color: "#5a6478" }}>
                <span style={{ color: m.color, fontWeight: 600 }}>{e[m.key]}</span>{" "}{m.label.split(" ")[0].toLowerCase()}
              </span>
            ))}
          </div>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: rankColor, fontFamily: "monospace", lineHeight: 1 }}>{e.score}</div>
          <div style={{ fontSize: 10, color: "#4a5568", marginTop: 2 }}>impact score</div>
        </div>
      </div>

      {/* ── Expanded ── */}
      {isExpanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e2433" }}>
          <div style={{ marginBottom: 6, fontSize: 11, color: e.profile.color, opacity: 0.9 }}>◆ {e.profile.desc}</div>
          <div style={{ marginBottom: 12, fontSize: 11, color: "#8892a4" }}>
            Top signal: {e.prs_merged >= e.reviews ? "Feature delivery — consistently ships merged work" : "Code review leadership — elevates team quality"}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", marginBottom: 12 }}>
            {METRIC_DEFS.map(m => (
              <div key={m.key}>
                <div style={{ fontSize: 10, color: "#5a6478", marginBottom: 3 }} title={m.tip}>{m.label} ⓘ</div>
                <MiniBar value={e[m.key]} max={maxValues[m.key]} color={m.color} />
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#5a6478", marginBottom: 5 }}>SCORE BREAKDOWN</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {breakdown.map(s => (
                <span key={s.label} style={{ background: "#1e2433", borderRadius: 5, padding: "2px 7px", fontSize: 10, color: "#8892a4" }}>
                  {s.label} = <span style={{ color: "#e8ecf0", fontWeight: 600 }}>{s.val}</span>
                </span>
              ))}
            </div>
          </div>

          {e.pr_titles.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: "#5a6478", marginBottom: 4 }}>RECENT MERGED PRS</div>
              {e.pr_titles.map((t, i) => (
                <div key={i} style={{ fontSize: 11, color: "#8892a4", paddingLeft: 8, borderLeft: "2px solid #1e2433", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  • {t}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(0);

  const load = useCallback(async (t) => {
    setLoading(true); setError(null);
    try {
      const result = await fetchGitHubData(t || null);
      setData(result); setExpanded(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const maxValues = data ? {
    prs_merged:        Math.max(...data.engineers.map(e => e.prs_merged)),
    reviews:           Math.max(...data.engineers.map(e => e.reviews)),
    commits:           Math.max(...data.engineers.map(e => e.commits)),
    changes_requested: Math.max(...data.engineers.map(e => e.changes_requested)),
  } : {};

  return (
    <div style={{ minHeight: "100vh", background: "#080c14", color: "#e8ecf0", fontFamily: "'Inter','Helvetica Neue',sans-serif", padding: "20px 16px", maxWidth: 660, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: "linear-gradient(135deg,#4ade80,#22d3ee)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⚡</div>
          <span style={{ fontSize: 11, color: "#5a6478", letterSpacing: 2, textTransform: "uppercase" }}>PostHog / Engineering Impact</span>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, background: "linear-gradient(135deg,#e8ecf0,#8892a4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Top Engineers — Last 90 Days
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7a99", lineHeight: 1.6 }}>
          Impact combines shipping velocity, code quality, and collaboration signals.
          PR merges carry the highest weight, followed by review depth (changes requested), reviews given, issues closed, and commit activity.
        </p>
        <div style={{ marginTop: 6, fontSize: 10, color: "#4a5568" }}>
          Repository: posthog/posthog · Window: last 90 days · Live GitHub API data
        </div>
      </div>

      {/* Token input */}
      {!data && !loading && (
        <div style={{ background: "#0d1117", border: "1px solid #1e2433", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#8892a4", marginBottom: 8 }}>
            GitHub Personal Access Token <span style={{ color: "#4a5568" }}>(recommended — raises rate limit 60→5,000 req/hr)</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="password" value={tokenInput} onChange={e => setTokenInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (setToken(tokenInput), load(tokenInput))}
              placeholder="ghp_xxxxxxxxxxxx  (or leave blank)"
              style={{ flex: 1, background: "#080c14", border: "1px solid #1e2433", borderRadius: 8, padding: "8px 12px", color: "#e8ecf0", fontSize: 13, outline: "none" }} />
            <button onClick={() => { setToken(tokenInput); load(tokenInput); }}
              style={{ background: "linear-gradient(135deg,#4ade80,#22d3ee)", border: "none", borderRadius: 8, padding: "8px 16px", color: "#080c14", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Load Data
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#4a5568" }}>
            Fetches commits, merged PRs, and reviews (25-PR sample to stay within rate limits) · posthog/posthog
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ background: "#0d1117", border: "1px solid #1e2433", borderRadius: 12, padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
          <div style={{ color: "#8892a4", fontSize: 14 }}>Fetching GitHub data…</div>
          <div style={{ color: "#4a5568", fontSize: 11, marginTop: 6 }}>Commits, PRs, and code reviews from the last 90 days</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: "#1a0808", border: "1px solid #7f1d1d", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ color: "#f87171", fontSize: 13, fontWeight: 600 }}>⚠ {error}</div>
          {error.includes("403") && (
            <div style={{ color: "#8892a4", fontSize: 11, marginTop: 6 }}>
              Add a GitHub token (Settings → Developer Settings → Personal Access Tokens → Classic, <code>public_repo</code> scope).
            </div>
          )}
          <button onClick={() => { setData(null); setError(null); }} style={{ marginTop: 10, background: "#1e2433", border: "none", borderRadius: 6, padding: "6px 12px", color: "#8892a4", fontSize: 12, cursor: "pointer" }}>← Back</button>
        </div>
      )}

      {/* Dashboard */}
      {data && (
        <>
          <div style={{ display: "flex", gap: 16, marginBottom: 14, padding: "10px 14px", background: "#0d1117", border: "1px solid #1e2433", borderRadius: 10 }}>
            {[
              { label: "Commits",    val: data.meta.total_commits },
              { label: "PRs Merged", val: data.meta.total_prs },
              { label: "Reviews",    val: `${data.meta.total_reviews} (${data.meta.reviews_sampled} PRs)` },
              { label: "Days",       val: data.meta.days },
            ].map(m => (
              <div key={m.label} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: m.label === "Reviews" ? 11 : 16, fontWeight: 700, color: "#e8ecf0", fontFamily: "monospace" }}>{m.val}</div>
                <div style={{ fontSize: 10, color: "#4a5568" }}>{m.label}</div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 14, padding: "8px 14px", background: "#0d1117", border: "1px solid #1e2433", borderRadius: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#5a6478" }}>SCORE =</span>
            {[
              { label: "PR×8", color: "#4ade80" },
              { label: "IssuesCaught×4", color: "#fb923c" },
              { label: "Review×3", color: "#60a5fa" },
              { label: "Commit×1", color: "#a78bfa" },
              { label: "Approval×1", color: "#8892a4" },
            ].map(m => <span key={m.label} style={{ fontSize: 10, color: m.color, fontWeight: 600 }}>{m.label}</span>)}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.engineers.map((eng, i) => (
              <EngineerCard key={eng.login} engineer={eng} rank={i}
                isExpanded={expanded === i} onToggle={() => setExpanded(expanded === i ? -1 : i)}
                maxValues={maxValues} />
            ))}
          </div>

          {/* Team Insight */}
          {(() => {
            const totalReviews = data.engineers.reduce((s, e) => s + e.reviews, 0);
            const totalPRs = data.engineers.reduce((s, e) => s + e.prs_merged, 0);
            const reviewHeavy = totalReviews > totalPRs * 0.4;
            const topShipper = data.engineers[0];
            return (
              <div style={{ marginTop: 12, padding: "12px 16px", background: "#0d1117", border: "1px solid #1e2433", borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: "#5a6478", marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>Team Insight</div>
                <div style={{ fontSize: 12, color: "#8892a4", lineHeight: 1.6 }}>
                  {reviewHeavy
                    ? "Top engineers contribute heavily through code reviews, indicating strong collaboration and shared code ownership across the PostHog team."
                    : `Top engineers are primarily driving output through feature delivery. ${topShipper.login} leads with ${topShipper.prs_merged} merged PRs — a strong shipping cadence.`
                  }
                </div>
              </div>
            );
          })()}

          <div style={{ marginTop: 12, fontSize: 10, color: "#2d3748", textAlign: "center" }}>
            Fetched {data.meta.fetched_at} · posthog/posthog · GitHub REST API
            <button onClick={() => { setData(null); setError(null); }} style={{ marginLeft: 10, background: "none", border: "none", color: "#4a5568", cursor: "pointer", fontSize: 10 }}>↺ Reset</button>
          </div>
        </>
      )}
    </div>
  );
}