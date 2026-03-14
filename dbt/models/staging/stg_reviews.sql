-- models/staging/stg_reviews.sql
-- Cleans and types raw PR reviews

WITH source AS (
    SELECT * FROM raw.reviews
),

cleaned AS (
    SELECT
        pr_number,
        repo,
        LOWER(reviewer_login)               AS engineer_login,
        state,
        submitted_at::TIMESTAMPTZ           AS submitted_at,
        DATE(submitted_at)                  AS review_date,
        -- Boolean flags for easier aggregation downstream
        CASE WHEN state = 'APPROVED'            THEN 1 ELSE 0 END   AS is_approval,
        CASE WHEN state = 'CHANGES_REQUESTED'   THEN 1 ELSE 0 END   AS is_changes_requested,
        CASE WHEN state = 'COMMENTED'           THEN 1 ELSE 0 END   AS is_comment,
        extracted_at
    FROM source
    WHERE reviewer_login IS NOT NULL
      AND state IN ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED')
)

SELECT * FROM cleaned
