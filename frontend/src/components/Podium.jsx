import { useState, useEffect } from 'react'
import styles from './Podium.module.css'

const TIERS = {
  1: { medal: '🥇', color: 'var(--gold)',   glow: 'var(--gold-g)',   label: 'Champion',  height: 130 },
  2: { medal: '🥈', color: 'var(--silver)', glow: 'var(--silver-g)', label: '2nd Place', height: 100 },
  3: { medal: '🥉', color: 'var(--bronze)', glow: 'var(--bronze-g)', label: '3rd Place', height: 76 },
}

function PodiumCard({ engineer: e, rank, delay }) {
  const t = TIERS[rank]
  const [show, setShow] = useState(false)
  useEffect(() => { const id = setTimeout(() => setShow(true), delay); return () => clearTimeout(id) }, [delay])

  return (
    <div className={`${styles.spotWrap} ${show ? styles.show : ''}`}>
      <div className={styles.card} style={{ '--color': t.color, '--glow': t.glow }}>
        <div className={styles.medal}>{t.medal}</div>
        <div className={styles.avatarRing}>
          <img src={`https://github.com/${e.engineer_login}.png?size=80`} alt={e.engineer_login} className={styles.avatar} />
        </div>
        <div className={styles.name}>@{e.engineer_login}</div>
        <div className={styles.score}>{Math.round(e.impact_score)}</div>
        <div className={styles.scoreLabel}>impact pts</div>
        <div className={styles.hint}>↓ see full breakdown below</div>
      </div>
      <div className={styles.base} style={{ height: t.height, '--color': t.color, '--glow': t.glow }}>
        <span className={styles.rankLabel} style={{ color: t.color }}>{t.label}</span>
      </div>
    </div>
  )
}

export default function Podium({ engineers }) {
  const order = [engineers[1], engineers[0], engineers[2]]
  const ranks = [2, 1, 3]
  const delays = [400, 100, 600]
  return (
    <div className={styles.podium}>
      {order.map((e, i) => (
        <PodiumCard key={e.engineer_login} engineer={e} rank={ranks[i]} delay={delays[i]} />
      ))}
    </div>
  )
}
