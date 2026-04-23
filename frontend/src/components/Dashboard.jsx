import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useState, useEffect } from 'react'
import Podium from './Podium'
import RankTable from './RankTable'
import BadgeLegend from './BadgeLegend'
import TeamInsight from './TeamInsight'
import styles from './Dashboard.module.css'

const API = import.meta.env.VITE_API_BASE_URL || ''
const DAY_OPTIONS = [7, 15, 30, 60, 90]

export default function Dashboard() {
  const [days, setDays] = useState(90)
  const [mounted, setMounted] = useState(false)
  const [showLegend, setShowLegend] = useState(false)

  useEffect(() => { setTimeout(() => setMounted(true), 80) }, [])

  const { data: lb, isLoading, error } = useQuery({
    queryKey: ['leaderboard', days],
    queryFn: () => axios.get(`${API}/api/leaderboard?days=${days}&limit=10`).then(r => r.data),
    keepPreviousData: true,
  })

  const { data: summary } = useQuery({
    queryKey: ['summary', days],
    queryFn: () => axios.get(`${API}/api/team-summary?days=${days}`).then(r => r.data),
  })

  const { data: pipeline } = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => axios.get(`${API}/api/pipeline-status`).then(r => r.data),
  })

  const engineers = lb?.engineers ?? []
  const top3 = engineers.slice(0, 3)
  const lastRun = pipeline?.runs?.[0]

  if (error) return (
      <div className={styles.error}>
      <div className={styles.errorIcon}>⚠</div>
      <div className={styles.errorTitle}>API Unreachable</div>
      <div className={styles.errorSub}>
        Make sure the API is running
        {API ? ` · ${API}` : ''}
      </div>
    </div>
  )

  return (
    <div className={`${styles.root} ${mounted ? styles.in : ''}`}>
      <div className={styles.ambient}>
        <div className={styles.orb1} /><div className={styles.orb2} /><div className={styles.grid} />
      </div>

      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.pulse} />
          <span className={styles.repoTag}>PostHog / posthog</span>
          <span className={styles.sep}>·</span>
          <span className={styles.headerLabel}>Engineering Impact</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.windowLabel}>Window</span>
          <div className={styles.pills}>
            {DAY_OPTIONS.map(d => (
              <button key={d} className={`${styles.pill} ${days === d ? styles.pillActive : ''}`} onClick={() => setDays(d)}>
                {d}d
              </button>
            ))}
          </div>
          {lastRun && (
            <div className={styles.freshness}>
              <span className={styles.freshDot} />
              {new Date(lastRun.run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
      </header>

      <main className={styles.main}>

        {/* HERO */}
        <div className={styles.hero}>
          <div className={styles.heroEye}>
            <span className={styles.eyeLine} />Last {days} Days<span className={styles.eyeLine} />
          </div>
          <h1 className={styles.heroTitle}>
            <span>TOP</span>
            <span className={styles.heroOutline}>ENGINEERS</span>
          </h1>
          <p className={styles.heroSub}>Ranked by shipping velocity, code review depth, and team impact</p>
        </div>

        {/* STATS */}
        {summary && (
          <div className={styles.stats}>
            {[
              { v: summary.total_engineers, l: 'Contributors' },
              { v: summary.total_commits?.toLocaleString(), l: 'Commits' },
              { v: summary.total_prs_merged?.toLocaleString(), l: 'PRs Shipped' },
              { v: summary.total_reviews?.toLocaleString(), l: 'Reviews' },
              { v: summary.total_issues_closed?.toLocaleString(), l: 'Issues Closed' },
            ].map((s, i) => (
              <div key={s.l} className={styles.statCell} style={{ animationDelay: `${i*0.07}s` }}>
                <span className={styles.statV}>{s.v ?? '—'}</span>
                <span className={styles.statL}>{s.l}</span>
              </div>
            ))}
          </div>
        )}

        {/* FORMULA */}
        <div className={styles.formula}>
          <span className={styles.fHead}>Score =</span>
          {[
            ['PRs ×8','var(--cyan)'],['Catching Issues ×4','var(--red)'],
            ['Reviews ×3','var(--purple)'],['Issues ×2','var(--gold)'],
            ['Commits ×1','var(--green)'],['Approvals ×1','var(--silver)'],
          ].map(([l, c], i) => (
            <span key={l} className={styles.fChip} style={{ '--c': c }}>
              {l}{i < 5 && <span className={styles.fPlus}>+</span>}
            </span>
          ))}
        </div>

        {/* PODIUM — decorative, top 3 only */}
        {!isLoading && top3.length === 3 && (
          <Podium engineers={top3} />
        )}

        {/* FULL RANKINGS 1–10, all clickable */}
        {!isLoading && engineers.length > 0 && (
          <div className={styles.rankSection}>
            <div className={styles.divider}>
              <span className={styles.divLine} />
              <span className={styles.divTitle}>Full Rankings — click any row to expand</span>
              <button className={styles.legendBtn} onClick={() => setShowLegend(v => !v)}>
                {showLegend ? '▲' : '▼'} Badge Guide
              </button>
              <span className={styles.divLine} />
            </div>

            {showLegend && <BadgeLegend />}

            <RankTable engineers={engineers} days={days} />
          </div>
        )}

        {isLoading && (
          <div className={styles.skels}>
            {[...Array(7)].map((_, i) => <div key={i} className={styles.skel} style={{ animationDelay: `${i*0.07}s` }} />)}
          </div>
        )}

        {/* TEAM INSIGHT */}
        {summary && engineers.length > 0 && (
          <TeamInsight summary={summary} engineers={engineers} days={days} />
        )}

        {/* FOOTER */}
        <footer className={styles.footer}>
          <span>PostHog/posthog</span><span>·</span>
          <span>Last {days} days</span><span>·</span>
          <span>GitHub API → Postgres → dbt → FastAPI → Redis → React</span>
          {lastRun && <><span>·</span><span>{lastRun.commits_loaded} commits · {lastRun.prs_loaded} PRs loaded</span></>}
        </footer>
      </main>
    </div>
  )
}
