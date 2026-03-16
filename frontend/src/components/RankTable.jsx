import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import TrendChart from './TrendChart'
import styles from './RankTable.module.css'

const API = 'http://localhost:8000'

// ── Badge definitions — shown in the legend ─────────────────────────────────
export const BADGES = {
  'All-Rounder':       { icon: '⬟', color: 'var(--gold)',   bg: 'rgba(240,180,41,0.12)',  desc: 'Above-avg shipper AND reviewer AND catches bugs' },
  'Quality Guardian':  { icon: '🛡', color: 'var(--red)',    bg: 'rgba(255,59,92,0.12)',   desc: 'High changes-requested rate — finds real problems' },
  'Shipping Reviewer': { icon: '⚡', color: 'var(--cyan)',   bg: 'rgba(0,200,240,0.1)',    desc: 'Above-avg on both PRs shipped and reviews given' },
  'Prolific Shipper':  { icon: '🚀', color: '#00e878',       bg: 'rgba(0,232,120,0.1)',    desc: 'High PR volume with strong commit output' },
  'Code Reviewer':     { icon: '◈', color: 'var(--purple)', bg: 'rgba(155,114,246,0.12)', desc: 'Review score outweighs shipping score' },
  'Feature Shipper':   { icon: '🏹', color: '#60c8ff',       bg: 'rgba(96,200,255,0.1)',   desc: 'Above-avg PRs merged, lighter on reviews' },
  'Code Engine':       { icon: '⚙', color: 'var(--orange)', bg: 'rgba(255,138,0,0.12)',   desc: 'Commit count is 2× their PR count' },
  'Contributor':       { icon: '◇', color: 'var(--muted)',  bg: 'rgba(61,88,120,0.1)',    desc: 'Solid contributor below field averages' },
}

// Relative to field averages so the 10 engineers spread across badge types
function getProfile(e, engineers) {
  const n = engineers.length
  const avgPRs  = engineers.reduce((s, x) => s + x.prs_merged, 0) / n
  const avgRevs = engineers.reduce((s, x) => s + x.reviews, 0) / n

  const highShip = e.prs_merged > avgPRs * 1.2
  const highRev  = e.reviews    > avgRevs * 1.1
  const catches  = e.changes_requested >= 3

  const shipPts = e.prs_merged * 8
  const revPts  = e.reviews * 3 + e.changes_requested * 4
  const revDom  = revPts > shipPts * 0.45

  if (highShip && highRev && catches)  return 'All-Rounder'
  if (catches && revDom)               return 'Quality Guardian'
  if (highShip && highRev)             return 'Shipping Reviewer'
  if (highShip && e.commits > 12)      return 'Prolific Shipper'
  if (revDom)                          return 'Code Reviewer'
  if (highShip)                        return 'Feature Shipper'
  if (e.commits > avgPRs * 2.5)        return 'Code Engine'
  return 'Contributor'
}

const RANK_COLORS = {
  1: 'var(--gold)', 2: 'var(--silver)', 3: 'var(--bronze)',
  4: 'var(--muted)', 5: 'var(--muted)', 6: 'var(--muted)',
  7: 'var(--muted)', 8: 'var(--muted)', 9: 'var(--muted)', 10: 'var(--muted)',
}
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' }

function DnaBar({ e }) {
  const total = e.impact_score || 1
  const segs = [
    { v: e.score_from_prs,             c: 'var(--cyan)',   t: `PRs: ${e.score_from_prs} pts` },
    { v: e.score_from_catching_issues, c: 'var(--red)',    t: `Catching issues: ${e.score_from_catching_issues} pts` },
    { v: e.score_from_reviews,         c: 'var(--purple)', t: `Reviews: ${e.score_from_reviews} pts` },
    { v: e.score_from_issues,          c: 'var(--gold)',   t: `Issues closed: ${e.score_from_issues} pts` },
    { v: e.score_from_commits,         c: 'var(--green)',  t: `Commits: ${e.score_from_commits} pts` },
  ].filter(s => s.v > 0)
  return (
    <div className={styles.dna} title="Hover each segment to see pts">
      {segs.map((s, i) => (
        <div key={i} className={styles.dnaSeg}
          style={{ width: `${(s.v / total) * 100}%`, background: s.c }}
          title={s.t}
        />
      ))}
    </div>
  )
}

function Row({ engineer: e, rank, isOpen, onToggle, engineers, days }) {
  const profile = getProfile(e, engineers)
  const b = BADGES[profile] || BADGES['Contributor']
  const rankColor = RANK_COLORS[rank] || 'var(--muted)'
  const medal = MEDALS[rank]

  const { data: trends } = useQuery({
    queryKey: ['trends', e.engineer_login, days],
    queryFn: () => axios.get(`${API}/api/trends/${e.engineer_login}?days=${days}`).then(r => r.data),
    enabled: isOpen,
  })

  return (
    <>
      <div
        className={`${styles.row} ${isOpen ? styles.rowOpen : ''}`}
        onClick={onToggle}
        style={{ '--rc': rankColor, animationDelay: `${(rank - 1) * 0.055}s` }}
      >
        {/* Left accent bar */}
        <div className={styles.accentBar} style={{ background: rankColor }} />

        {/* Rank */}
        <div className={styles.rankCol}>
          {medal
            ? <span className={styles.medal}>{medal}</span>
            : <span className={styles.rankNum} style={{ color: rankColor }}>#{rank}</span>
          }
        </div>

        {/* Avatar + name + badge */}
        <div className={styles.identity}>
          <img src={`https://github.com/${e.engineer_login}.png?size=40`} alt={e.engineer_login} className={styles.avatar} style={{ borderColor: rankColor }} />
          <div>
            <div className={styles.login}>@{e.engineer_login}</div>
            <span className={styles.badge} style={{ color: b.color, background: b.bg }}>
              {b.icon} {profile}
            </span>
          </div>
        </div>

        {/* DNA bar */}
        <div className={styles.dnaCol}>
          <DnaBar e={e} />
          <div className={styles.dnaLabel}>score composition</div>
        </div>

        {/* Metrics */}
        <div className={styles.metricsCol}>
          <span style={{ color: 'var(--cyan)' }}>{e.prs_merged} PRs</span>
          <span style={{ color: 'var(--purple)' }}>{e.reviews} Reviews</span>
          <span style={{ color: 'var(--green)' }}>{e.commits} Commits</span>
        </div>

        {/* Score */}
        <div className={styles.scoreCol} style={{ color: rankColor }}>
          {Math.round(e.impact_score)}
          <span className={styles.scorePts}>pts</span>
        </div>

        {/* Actions */}
        <div className={styles.actionsCol}>
          <a
            href={`https://github.com/${e.engineer_login}`}
            target="_blank" rel="noreferrer"
            className={styles.ghBtn}
            onClick={ev => ev.stopPropagation()}
            title="GitHub profile"
          >
            <GithubIcon />
          </a>
          <button className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} tabIndex={-1}>▾</button>
        </div>
      </div>

      {/* Expanded panel — inline below this row */}
      {isOpen && (
        <div className={styles.panel} style={{ '--rc': rankColor }}>
          <div className={styles.panelGrid}>

            {/* Score breakdown */}
            <div>
              <div className={styles.panelHeading}>Score Breakdown</div>
              {[
                { l: 'PRs Merged ×8',     v: e.score_from_prs,             c: 'var(--cyan)' },
                { l: 'Changes Req ×4',    v: e.score_from_catching_issues,  c: 'var(--red)' },
                { l: 'Reviews ×3',        v: e.score_from_reviews,          c: 'var(--purple)' },
                { l: 'Issues Closed ×2',  v: e.score_from_issues,           c: 'var(--gold)' },
                { l: 'Commits ×1',        v: e.score_from_commits,          c: 'var(--green)' },
                { l: 'Approvals ×1',      v: e.score_from_approvals,        c: 'var(--silver)' },
              ].map(b => (
                <div key={b.l} className={styles.bRow}>
                  <span className={styles.bDot} style={{ background: b.c }} />
                  <span className={styles.bLabel}>{b.l}</span>
                  <div className={styles.bTrack}>
                    <div style={{ width: `${Math.min(100,(b.v/e.impact_score)*100)}%`, background: b.c, height: '100%', borderRadius: 2 }} />
                  </div>
                  <span className={styles.bVal}>{b.v}</span>
                </div>
              ))}

              <div className={styles.statPills}>
                <span className={styles.statPill}>{e.prs_merged} PRs merged</span>
                <span className={styles.statPill}>{e.reviews} reviews given</span>
                <span className={styles.statPill}>{e.commits} commits</span>
                <span className={styles.statPill}>{e.active_days} active days</span>
                <span className={styles.statPill}>{e.changes_requested} changes requested</span>
                <span className={styles.statPill}>{e.approvals} approvals</span>
              </div>

              {/* Badge explanation */}
              <div className={styles.badgeExplain} style={{ borderColor: b.color }}>
                <span className={styles.badgeExplainIcon} style={{ color: b.color }}>{b.icon}</span>
                <div>
                  <div className={styles.badgeExplainTitle} style={{ color: b.color }}>{profile}</div>
                  <div className={styles.badgeExplainDesc}>{b.desc}</div>
                </div>
              </div>

              <a href={`https://github.com/${e.engineer_login}`} target="_blank" rel="noreferrer" className={styles.fullLink} onClick={ev => ev.stopPropagation()}>
                <GithubIcon /> View @{e.engineer_login} on GitHub ↗
              </a>
            </div>

            {/* Recent PRs + trend */}
            <div>
              <div className={styles.panelHeading}>Recent PRs</div>
              {e.recent_pr_titles?.slice(0, 3).map((title, i) => (
                <div key={i} className={styles.prRow}>
                  <span className={styles.prBullet} style={{ color: rankColor }}>▸</span>
                  <span className={styles.prTitle}>{title}</span>
                </div>
              ))}

              <div className={styles.panelHeading} style={{ marginTop: 18 }}>
                Weekly Activity
              </div>
              {trends
                ? <TrendChart data={trends.trends} compact />
                : <div className={styles.chartLoading}>Loading trend data...</div>
              }
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function RankTable({ engineers, days }) {
  const [open, setOpen] = useState(null)
  const toggle = (login) => setOpen(prev => prev === login ? null : login)

  return (
    <div className={styles.table}>
      {engineers.map((e, i) => (
        <Row
          key={e.engineer_login}
          engineer={e}
          rank={i + 1}
          isOpen={open === e.engineer_login}
          onToggle={() => toggle(e.engineer_login)}
          engineers={engineers}
          days={days}
        />
      ))}
    </div>
  )
}

function GithubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  )
}
