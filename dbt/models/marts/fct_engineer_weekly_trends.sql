-- models/marts/fct_engineer_weekly_trends.sql
-- Weekly activity breakdown per engineer for trend charts in the frontend.

WITH weekly_commits AS (
    SELECT
        engineer_login,
        repo,
        DATE_TRUNC('week', committed_at)    AS week_start,
        COUNT(*)                            AS commits
    FROM {{ ref('stg_commits') }}
    GROUP BY 1, 2, 3
),

weekly_prs AS (
    SELECT
        engineer_login,
        repo,
        DATE_TRUNC('week', merged_at)       AS week_start,
        COUNT(*)                            AS prs_merged
    FROM {{ ref('stg_pull_requests') }}
    GROUP BY 1, 2, 3
),

weekly_reviews AS (
    SELECT
        engineer_login,
        repo,
        DATE_TRUNC('week', submitted_at)    AS week_start,
        COUNT(*)                            AS reviews,
        SUM(is_changes_requested)           AS changes_requested
    FROM {{ ref('stg_reviews') }}
    GROUP BY 1, 2, 3
),

combined AS (
    SELECT
        COALESCE(c.engineer_login, p.engineer_login, r.engineer_login) AS engineer_login,
        COALESCE(c.repo, p.repo, r.repo)                               AS repo,
        COALESCE(c.week_start, p.week_start, r.week_start)             AS week_start,
        COALESCE(c.commits, 0)              AS commits,
        COALESCE(p.prs_merged, 0)           AS prs_merged,
        COALESCE(r.reviews, 0)              AS reviews,
        COALESCE(r.changes_requested, 0)    AS changes_requested,
        -- Weekly impact score
        (COALESCE(p.prs_merged, 0)          * 8 +
         COALESCE(r.changes_requested, 0)   * 4 +
         COALESCE(r.reviews, 0)             * 3 +
         COALESCE(c.commits, 0)             * 1)  AS weekly_impact_score
    FROM weekly_commits   c
    FULL OUTER JOIN weekly_prs     p ON c.engineer_login = p.engineer_login AND c.repo = p.repo AND c.week_start = p.week_start
    FULL OUTER JOIN weekly_reviews r ON COALESCE(c.engineer_login, p.engineer_login) = r.engineer_login
                                     AND COALESCE(c.repo, p.repo) = r.repo
                                     AND COALESCE(c.week_start, p.week_start) = r.week_start
)

SELECT * FROM combined
ORDER BY engineer_login, week_start
