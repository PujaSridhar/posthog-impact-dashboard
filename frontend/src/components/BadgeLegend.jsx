import { BADGES } from './RankTable'
import styles from './BadgeLegend.module.css'

export default function BadgeLegend() {
  return (
    <div className={styles.wrap}>
      <div className={styles.title}>How badges are assigned — relative to the field</div>
      <div className={styles.grid}>
        {Object.entries(BADGES).map(([name, b]) => (
          <div key={name} className={styles.item} style={{ '--c': b.color, '--bg': b.bg }}>
            <span className={styles.icon}>{b.icon}</span>
            <div>
              <div className={styles.name} style={{ color: b.color }}>{name}</div>
              <div className={styles.desc}>{b.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
