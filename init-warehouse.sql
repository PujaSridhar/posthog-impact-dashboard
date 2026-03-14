-- Create the data warehouse database and user
CREATE USER warehouse WITH PASSWORD 'warehouse';
CREATE DATABASE github_warehouse OWNER warehouse;
GRANT ALL PRIVILEGES ON DATABASE github_warehouse TO warehouse;

-- Connect to the warehouse database to create schemas
\c github_warehouse;

-- Bronze layer: raw data exactly as it comes from GitHub API
CREATE SCHEMA IF NOT EXISTS raw AUTHORIZATION warehouse;

-- Silver layer: cleaned and typed staging models (managed by dbt)
CREATE SCHEMA IF NOT EXISTS staging AUTHORIZATION warehouse;

-- Gold layer: aggregated mart models ready for the API (managed by dbt)
CREATE SCHEMA IF NOT EXISTS marts AUTHORIZATION warehouse;

-- Grant schema permissions
GRANT ALL ON SCHEMA raw TO warehouse;
GRANT ALL ON SCHEMA staging TO warehouse;
GRANT ALL ON SCHEMA marts TO warehouse;

-- ── Bronze / Raw Tables ──────────────────────────────────────────────────────

\c github_warehouse warehouse;

-- Raw commits
CREATE TABLE IF NOT EXISTS raw.commits (
    id                  SERIAL PRIMARY KEY,
    sha                 VARCHAR(40) UNIQUE NOT NULL,
    author_login        VARCHAR(255),
    author_avatar_url   TEXT,
    author_type         VARCHAR(50),
    message             TEXT,
    committed_at        TIMESTAMPTZ,
    repo                VARCHAR(255) NOT NULL,
    extracted_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Raw pull requests
CREATE TABLE IF NOT EXISTS raw.pull_requests (
    id                  SERIAL PRIMARY KEY,
    pr_number           INTEGER NOT NULL,
    repo                VARCHAR(255) NOT NULL,
    title               TEXT,
    author_login        VARCHAR(255),
    author_avatar_url   TEXT,
    author_type         VARCHAR(50),
    state               VARCHAR(50),
    merged_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,
    review_comments     INTEGER DEFAULT 0,
    comments            INTEGER DEFAULT 0,
    extracted_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pr_number, repo)
);

-- Raw reviews
CREATE TABLE IF NOT EXISTS raw.reviews (
    id                  SERIAL PRIMARY KEY,
    pr_number           INTEGER NOT NULL,
    repo                VARCHAR(255) NOT NULL,
    reviewer_login      VARCHAR(255),
    reviewer_type       VARCHAR(50),
    state               VARCHAR(50),  -- APPROVED, CHANGES_REQUESTED, COMMENTED
    submitted_at        TIMESTAMPTZ,
    extracted_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Raw issues
CREATE TABLE IF NOT EXISTS raw.issues (
    id                  SERIAL PRIMARY KEY,
    issue_number        INTEGER NOT NULL,
    repo                VARCHAR(255) NOT NULL,
    title               TEXT,
    state               VARCHAR(50),
    closed_by_login     VARCHAR(255),
    closed_by_type      VARCHAR(50),
    created_at          TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ,
    extracted_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(issue_number, repo)
);

-- Pipeline run log
CREATE TABLE IF NOT EXISTS raw.pipeline_runs (
    id                  SERIAL PRIMARY KEY,
    run_at              TIMESTAMPTZ DEFAULT NOW(),
    repo                VARCHAR(255),
    status              VARCHAR(50),
    commits_loaded      INTEGER DEFAULT 0,
    prs_loaded          INTEGER DEFAULT 0,
    reviews_loaded      INTEGER DEFAULT 0,
    issues_loaded       INTEGER DEFAULT 0,
    error_message       TEXT
);
