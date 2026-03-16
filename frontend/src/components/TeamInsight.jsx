import styles from './TeamInsight.module.css'

export default function TeamInsight({ summary, engineers, days }) {
  const totalShipping = engineers.reduce((s, e) => s + e.prs_merged * 8, 0)
  const totalReviewing = engineers.reduce((s, e) => s + e.reviews * 3 + e.changes_requested * 4, 0)
  const ratio = totalReviewing > 0 ? (totalShipping / totalReviewing).toFixed(1) : '∞'
  const reviewHeavy = totalReviewing > totalShipping
  const topShipper = engineers.reduce((a, b) => a.prs_merged > b.prs_merged ? a : b, engineers[0])
  const topReviewer = engineers.reduce((a, b) => (a.reviews + a.changes_requested) > (b.reviews + b.changes_requested) ? a : b, engineers[0])

  const insight = reviewHeavy
    ? `This team invests heavily in code review — review activity outweighs raw shipping. Great for quality, watch for throughput.`
    : `This team ships ${ratio}× more than it reviews. Strong velocity — consider whether review coverage is keeping pace.`

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>
        <span className={styles.icon}>◆</span>
        Team Insight — Last {days} Days
      </div>
      <p className={styles.insight}>{insight}</p>
      <div className={styles.callouts}>
        {topShipper && (
          <div className={styles.callout}>
            <span className={styles.calloutIcon} style={{ color: 'var(--cyan)' }}>🚀</span>
            <div>
              <div className={styles.calloutLabel}>Top Shipper</div>
              <div className={styles.calloutVal}>@{topShipper.engineer_login} · {topShipper.prs_merged} PRs</div>
            </div>
          </div>
        )}
        {topReviewer && topReviewer.engineer_login !== topShipper?.engineer_login && (
          <div className={styles.callout}>
            <span className={styles.calloutIcon} style={{ color: 'var(--purple)' }}>◈</span>
            <div>
              <div className={styles.calloutLabel}>Top Reviewer</div>
              <div className={styles.calloutVal}>@{topReviewer.engineer_login} · {topReviewer.reviews + topReviewer.changes_requested} reviews</div>
            </div>
          </div>
        )}
        <div className={styles.callout}>
          <span className={styles.calloutIcon} style={{ color: 'var(--gold)' }}>⬟</span>
          <div>
            <div className={styles.calloutLabel}>Ship:Review Ratio</div>
            <div className={styles.calloutVal}>{ratio}× more shipping than reviewing</div>
          </div>
        </div>
      </div>
    </div>
  )
}
