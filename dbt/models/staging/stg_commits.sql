-- models/staging/stg_commits.sql
-- Cleans and types raw commits

WITH source AS (
    SELECT * FROM raw.commits
),

cleaned AS (
    SELECT
        sha,
        LOWER(author_login)             AS engineer_login,
        author_avatar_url,
        committed_at::TIMESTAMPTZ       AS committed_at,
        DATE(committed_at)              AS commit_date,
        TRIM(message)                   AS message,
        -- Extract conventional commit type (feat, fix, chore, etc.)
        CASE
            WHEN message ILIKE 'feat%'   THEN 'feature'
            WHEN message ILIKE 'fix%'    THEN 'fix'
            WHEN message ILIKE 'chore%'  THEN 'chore'
            WHEN message ILIKE 'refactor%' THEN 'refactor'
            WHEN message ILIKE 'test%'   THEN 'test'
            WHEN message ILIKE 'docs%'   THEN 'docs'
            ELSE 'other'
        END                             AS commit_type,
        repo,
        extracted_at
    FROM source
    WHERE author_login IS NOT NULL
)

SELECT * FROM cleaned
