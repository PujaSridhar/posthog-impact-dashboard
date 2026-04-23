#!/bin/bash
set -euo pipefail

warehouse_user="${WAREHOUSE_DB_USER:-warehouse}"
warehouse_password="${WAREHOUSE_DB_PASSWORD:-warehouse}"
warehouse_db="${WAREHOUSE_DB_NAME:-github_warehouse}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
DO \$\$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${warehouse_user}'
    ) THEN
        CREATE ROLE "${warehouse_user}" LOGIN PASSWORD '${warehouse_password}';
    ELSE
        ALTER ROLE "${warehouse_user}" WITH LOGIN PASSWORD '${warehouse_password}';
    END IF;
END
\$\$;

SELECT 'CREATE DATABASE "${warehouse_db}" OWNER "${warehouse_user}"'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${warehouse_db}')
\gexec

GRANT ALL PRIVILEGES ON DATABASE "${warehouse_db}" TO "${warehouse_user}";
\connect "${warehouse_db}"

CREATE SCHEMA IF NOT EXISTS raw AUTHORIZATION "${warehouse_user}";
CREATE SCHEMA IF NOT EXISTS staging AUTHORIZATION "${warehouse_user}";
CREATE SCHEMA IF NOT EXISTS marts AUTHORIZATION "${warehouse_user}";

GRANT ALL ON SCHEMA raw TO "${warehouse_user}";
GRANT ALL ON SCHEMA staging TO "${warehouse_user}";
GRANT ALL ON SCHEMA marts TO "${warehouse_user}";

\connect "${warehouse_db}" "${warehouse_user}"

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

CREATE TABLE IF NOT EXISTS raw.reviews (
    id                  SERIAL PRIMARY KEY,
    pr_number           INTEGER NOT NULL,
    repo                VARCHAR(255) NOT NULL,
    reviewer_login      VARCHAR(255) NOT NULL,
    reviewer_type       VARCHAR(50),
    state               VARCHAR(50) NOT NULL,
    submitted_at        TIMESTAMPTZ NOT NULL,
    extracted_at        TIMESTAMPTZ DEFAULT NOW()
);

DO \$\$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'reviews_repo_pr_reviewer_state_submitted_at_key'
    ) THEN
        ALTER TABLE raw.reviews
            ADD CONSTRAINT reviews_repo_pr_reviewer_state_submitted_at_key
            UNIQUE (repo, pr_number, reviewer_login, state, submitted_at);
    END IF;
END
\$\$;

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
EOSQL
