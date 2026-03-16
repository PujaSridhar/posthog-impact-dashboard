import { useState } from 'react'
import styles from './EngineerCard.module.css'

const RANK_COLORS = {
  1: { color: '#f5c518', bg: 'rgba(245,197,24,0.08)', border: 'rgba(245,197,24,0.3)', medal: '🥇' },
  2: { color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.2)', medal: '🥈' },
  3: { color: '#cd7f32', bg: 'rgba(205,127,50,0.07)', border: 'rgba(205,127,50,0.25)', medal: '🥉' },
  4: { color: '#4a6080', bg: 'transparent', border: '#111c30', medal: '' },
  5: { color: '#4a6080', bg: 'transparent', border: '#111c30', medal: '' },
}

const BADGE_CONFIG = {
  'All-Rounder':       { icon: '⬟', color: '#f5c518', bg: 'rgba(245,197,24,0.12)', desc: 'Ships, reviews, and catches bugs' },
  'Quality Guardian':  { icon: '🛡', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  desc: 'Keeps code quality high' },
  'Shipping Reviewer': { icon: '⚡', color: '#00d4ff', bg: 'rgba(0,212,255,0.1)',   desc: 'Ships fast & reviews thoroughly' },
  'Code Reviewer':     { icon: '◈', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',  desc: 'Deep review expertise' },
  'Feature Shipper':   { icon: '🚀', color: '#00ff87', bg: 'rgba(0,255,135,0.1)',   desc: 'Relentless feature delivery' },
  'Code Engine':       { icon: '⚙', color: '#ff8c00', bg: 'rgba(255,140,0,0.12)',   desc: 'High commit velocity' },
  'Contributor':       { icon: '◇', color: '#4a6080', bg: 'rgba(74,96,128,0.1)',    desc: 'Solid team contributor' },
}

function getProfile(e) {
  const shippingScore = e.prs_merged * 8
  const reviewScore = e.reviews * 3 + e.changes_requested * 4
  const isShipper = e.prs_merged >= 10
  const isReviewer = e.reviews >= 3
  const isCatcher = e.changes_requested >= 2
  const isEngine = e.commits >= 20 && shippingScore < e.commits * 3
  const reviewDominant = reviewScore > shippingScore * 0.6

  if (isShipper && isReviewer && isCatcher) return 'All-Rounder'
  if (isCatcher && reviewDominant) return 'Quality Guardian'
  if (isShipper && isReviewer) return 'Shipping Reviewer'
  if (isEngine) return 'Code Engine'
  if (reviewDominant) return 'Code Reviewer'
  if (isShipper) return 'Feature Shipper'
  return 'Contributor'
}

export default function EngineerCard({ engineer: e, rank, isSelected, onClick, delay }) {
  const rankCfg = RANK_COLORS[rank] || RANK_COLORS[5]
  const profile = getProfile(e)
  const badge = BADGE_CONFIG[profile] || BADGE_CONFIG['Contributor']
  const [hovered, setHovered] = useState(false)

  const metrics = [
    { label: 'PRs', value: e.prs_merged, max: 25, color: '#00d4ff' },
    { label: 'Reviews', value: e.reviews, max: 20, color: '#8b5cf6' },
    { label: 'Commits', value: e.commits, max: 30, color: '#00ff87' },
    { label: 'Issues', value: e.issues_closed, max: 10, color: '#f5c518' },
  ]

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ''} ${hovered ? styles.hovered : ''}`}
      style={{
        '--rank-color': rankCfg.color,
        '--rank-bg': rankCfg.bg,
        '--rank-border': rankCfg.border,
        '--badge-color': badge.color,
        '--badge-bg': badge.bg,
        animationDelay: `${delay}s`,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Rank accent line */}
      <div className={styles.rankLine} />

      <div className={styles.mainRow}>

        {/* Rank + medal */}
        <div className={styles.rankBlock}>
          {rankCfg.medal ? (
            <span className={styles.medal}>{rankCfg.medal}</span>
          ) : (
            <span className={styles.rankNum}>#{rank}</span>
          )}
        </div>

        {/* Avatar + name + badge */}
        <div className={styles.identity}>
          <div className={styles.avatarWrap}>
            <img
              src={`https://github.com/${e.engineer_login}.png?size=48`}
              alt={e.engineer_login}
              className={styles.avatar}
            />
            {rank <= 3 && <div className={styles.avatarGlow} />}
          </div>
          <div className={styles.nameBlock}>
            <div className={styles.login}>@{e.engineer_login}</div>
            <div className={styles.badge} style={{ color: badge.color, background: badge.bg }}>
              <span>{badge.icon}</span>
              <span>{profile}</span>
            </div>
          </div>
        </div>

        {/* Metric bars */}
        <div className={styles.metricsBlock}>
          {metrics.map(m => (
            <div key={m.label} className={styles.metric}>
              <span className={styles.metricLabel}>{m.label}</span>
              <div className={styles.metricBar}>
                <div
                  className={styles.metricFill}
                  style={{
                    width: `${Math.min(100, (m.value / m.max) * 100)}%`,
                    background: m.color,
                    boxShadow: hovered ? `0 0 8px ${m.color}60` : 'none',
                  }}
                />
              </div>
              <span className={styles.metricVal}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Score */}
        <div className={styles.scoreBlock}>
          <div className={styles.scoreNum}>{Math.round(e.impact_score)}</div>
          <div className={styles.scoreUnit}>pts</div>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <a
            href={`https://github.com/${e.engineer_login}`}
            target="_blank"
            rel="noreferrer"
            className={styles.ghBtn}
            onClick={ev => ev.stopPropagation()}
            title="View GitHub profile"
          >
            <GithubIcon />
          </a>
          <button className={`${styles.expandBtn} ${isSelected ? styles.expandOpen : ''}`} onClick={onClick}>
            ▾
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {isSelected && (
        <div className={styles.expandedPanel}>
          <div className={styles.expandedGrid}>

            {/* Score breakdown */}
            <div className={styles.breakdownBlock}>
              <div className={styles.blockTitle}>Score Breakdown</div>
              {[
                { label: 'PRs Merged ×8',       val: e.score_from_prs,              color: '#00d4ff' },
                { label: 'Changes Req. ×4',      val: e.score_from_catching_issues,  color: '#ef4444' },
                { label: 'Reviews ×3',            val: e.score_from_reviews,          color: '#8b5cf6' },
                { label: 'Issues Closed ×2',      val: e.score_from_issues,           color: '#f5c518' },
                { label: 'Commits ×1',            val: e.score_from_commits,          color: '#00ff87' },
                { label: 'Approvals ×1',          val: e.score_from_approvals,        color: '#94a3b8' },
              ].map(b => (
                <div key={b.label} className={styles.breakRow}>
                  <span className={styles.breakDot} style={{ background: b.color }} />
                  <span className={styles.breakLabel}>{b.label}</span>
                  <div className={styles.breakBarWrap}>
                    <div
                      className={styles.breakBar}
                      style={{ width: `${Math.min(100, (b.val / e.impact_score) * 100)}%`, background: b.color }}
                    />
                  </div>
                  <span className={styles.breakVal}>{b.val}</span>
                </div>
              ))}
            </div>

            {/* Recent PRs + stats */}
            <div className={styles.rightBlock}>
              <div className={styles.blockTitle}>Recent PRs</div>
              {e.recent_pr_titles?.slice(0, 3).map((title, i) => (
                <div key={i} className={styles.prRow}>
                  <span className={styles.prArrow}>▸</span>
                  <span className={styles.prTitle}>{title}</span>
                </div>
              ))}

              <div className={styles.statsPills}>
                <span className={styles.pill}>{e.active_days} active days</span>
                <span className={styles.pill}>{e.changes_requested} changes requested</span>
                <span className={styles.pill}>{e.approvals} approvals given</span>
                {e.avg_discussion_per_pr > 0 && (
                  <span className={styles.pill}>{e.avg_discussion_per_pr.toFixed(1)} avg discussion/PR</span>
                )}
              </div>

              <div className={styles.profileBio}>
                <span style={{ color: badge.color }}>{badge.icon} {profile}</span>
                <span className={styles.bioDesc}> — {badge.desc}</span>
              </div>

              <a
                href={`https://github.com/${e.engineer_login}`}
                target="_blank"
                rel="noreferrer"
                className={styles.fullProfileLink}
                onClick={ev => ev.stopPropagation()}
              >
                <GithubIcon />
                View @{e.engineer_login} on GitHub ↗
              </a>
            </div>
          </div>
        </div>
      )}
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
