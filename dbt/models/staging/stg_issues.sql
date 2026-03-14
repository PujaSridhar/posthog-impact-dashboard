-- models/staging/stg_issues.sql
-- Cleans and types raw closed issues

WITH source AS (
    SELECT * FROM raw.issues
),

cleaned AS (
    SELECT
        issue_number,
        repo,
        TRIM(title)                         AS title,
        LOWER(closed_by_login)              AS engineer_login,
        created_at::TIMESTAMPTZ             AS created_at,
        closed_at::TIMESTAMPTZ              AS closed_at,
        DATE(closed_at)                     AS closed_date,
        -- Time to close in hours
        EXTRACT(EPOCH FROM (
            closed_at::TIMESTAMPTZ - created_at::TIMESTAMPTZ
        )) / 3600.0                         AS hours_to_close,
        extracted_at
    FROM source
    WHERE closed_by_login IS NOT NULL
      AND closed_at IS NOT NULL
)

SELECT * FROM cleaned
