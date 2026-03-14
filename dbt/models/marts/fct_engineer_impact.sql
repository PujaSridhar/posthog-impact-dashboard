-- models/marts/fct_engineer_impact.sql
-- Final impact score table. This is what the API reads from.
--
-- Impact Score Formula:
--   PRs Merged        × 8   primary shipping signal
--   Changes Requested × 4   highest review weight: proves real code reading
--   Reviews Given     × 3   collaboration & knowledge sharing
--   Issues Closed     × 2   delivery completion
--   Commits           × 1   activity breadth
--   Approvals         × 1   participation in review process

WITH commits_agg AS (
    SELECT
        engineer_login,
        repo,
        COUNT(*)                                    AS total_commits,
        COUNT(DISTINCT commit_date)                 AS active_days,
        COUNT(CASE WHEN commit_type = 'feature' THEN 1 END) AS feature_commits,
        COUNT(CASE WHEN commit_type = 'fix'     THEN 1 END) AS fix_commits,
        MIN(committed_at)                           AS first_commit_at,
        MAX(committed_at)                           AS last_commit_at
    FROM {{ ref('stg_commits') }}
    GROUP BY engineer_login, repo
),

prs_agg AS (
    SELECT
        engineer_login,
        repo,
        COUNT(*)                                    AS prs_merged,
        AVG(total_discussion)                       AS avg_discussion_per_pr,
        MAX(merged_at)                              AS last_pr_merged_at,
        -- Collect up to 3 recent PR titles as an array for the API
        ARRAY_AGG(title ORDER BY merged_at DESC)
            FILTER (WHERE title IS NOT NULL)        AS recent_pr_titles
    FROM (
        SELECT *, ROW_NUMBER() OVER (
            PARTITION BY engineer_login, repo ORDER BY merged_at DESC
        ) AS rn
        FROM {{ ref('stg_pull_requests') }}
    ) ranked
    GROUP BY engineer_login, repo
),

reviews_agg AS (
    SELECT
        engineer_login,
        repo,
        COUNT(*)                                    AS total_reviews,
        SUM(is_approval)                            AS approvals,
        SUM(is_changes_requested)                   AS changes_requested,
        SUM(is_comment)                             AS review_comments
    FROM {{ ref('stg_reviews') }}
    GROUP BY engineer_login, repo
),

issues_agg AS (
    SELECT
        engineer_login,
        repo,
        COUNT(*)                                    AS issues_closed,
        AVG(hours_to_close)                         AS avg_hours_to_close
    FROM {{ ref('stg_issues') }}
    GROUP BY engineer_login, repo
),

-- Combine all dimensions
combined AS (
    SELECT
        COALESCE(c.engineer_login, p.engineer_login, r.engineer_login, i.engineer_login) AS engineer_login,
        COALESCE(c.repo, p.repo, r.repo, i.repo)                                          AS repo,
        COALESCE(c.total_commits, 0)        AS commits,
        COALESCE(c.active_days, 0)          AS active_days,
        COALESCE(p.prs_merged, 0)           AS prs_merged,
        COALESCE(p.avg_discussion_per_pr, 0) AS avg_discussion_per_pr,
        COALESCE(p.recent_pr_titles, ARRAY[]::TEXT[]) AS recent_pr_titles,
        COALESCE(r.total_reviews, 0)        AS reviews,
        COALESCE(r.approvals, 0)            AS approvals,
        COALESCE(r.changes_requested, 0)    AS changes_requested,
        COALESCE(r.review_comments, 0)      AS review_comments_given,
        COALESCE(i.issues_closed, 0)        AS issues_closed,
        COALESCE(i.avg_hours_to_close, 0)   AS avg_hours_to_close_issue
    FROM commits_agg c
    FULL OUTER JOIN prs_agg      p ON c.engineer_login = p.engineer_login AND c.repo = p.repo
    FULL OUTER JOIN reviews_agg  r ON COALESCE(c.engineer_login, p.engineer_login) = r.engineer_login
                                   AND COALESCE(c.repo, p.repo) = r.repo
    FULL OUTER JOIN issues_agg   i ON COALESCE(c.engineer_login, p.engineer_login, r.engineer_login) = i.engineer_login
                                   AND COALESCE(c.repo, p.repo, r.repo) = i.repo
),

scored AS (
    SELECT
        *,
        -- Core impact score
        (prs_merged         * 8 +
         changes_requested  * 4 +
         reviews            * 3 +
         issues_closed      * 2 +
         commits            * 1 +
         approvals          * 1)::FLOAT      AS impact_score,

        -- Component scores for breakdown transparency
        prs_merged          * 8              AS score_from_prs,
        changes_requested   * 4              AS score_from_catching_issues,
        reviews             * 3              AS score_from_reviews,
        issues_closed       * 2              AS score_from_issues,
        commits             * 1              AS score_from_commits,
        approvals           * 1              AS score_from_approvals,

        -- Rank within repo
        RANK() OVER (PARTITION BY repo ORDER BY
            (prs_merged * 8 + changes_requested * 4 + reviews * 3 +
             issues_closed * 2 + commits + approvals) DESC
        )                                    AS impact_rank,

        NOW()                                AS computed_at
    FROM combined
    -- Filter out noise: must have at least some meaningful activity
    WHERE commits + prs_merged + reviews > 2
)

SELECT * FROM scored
ORDER BY repo, impact_rank
