-- models/staging/stg_pull_requests.sql
-- Cleans and types raw pull requests

WITH source AS (
    SELECT * FROM raw.pull_requests
),

cleaned AS (
    SELECT
        pr_number,
        repo,
        TRIM(title)                         AS title,
        LOWER(author_login)                 AS engineer_login,
        author_avatar_url,
        merged_at::TIMESTAMPTZ              AS merged_at,
        created_at::TIMESTAMPTZ             AS created_at,
        closed_at::TIMESTAMPTZ              AS closed_at,
        DATE(merged_at)                     AS merged_date,
        COALESCE(review_comments, 0)        AS review_comments,
        COALESCE(comments, 0)               AS comments,
        review_comments + comments          AS total_discussion,
        -- Classify PR size by discussion volume (proxy since we don't have line counts)
        CASE
            WHEN review_comments + comments = 0  THEN 'no-discussion'
            WHEN review_comments + comments <= 3 THEN 'low'
            WHEN review_comments + comments <= 10 THEN 'medium'
            ELSE 'high'
        END                                 AS discussion_level,
        extracted_at
    FROM source
    WHERE author_login IS NOT NULL
      AND merged_at IS NOT NULL
)

SELECT * FROM cleaned
