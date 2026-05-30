"""
extraction/db_loader.py

Handles loading extracted GitHub data into the raw Postgres schema.
Uses upsert logic so the pipeline is idempotent — safe to re-run.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
import psycopg2
import psycopg2.extras
from psycopg2.extensions import connection as PgConnection

logger = logging.getLogger(__name__)


def get_connection(database_url: str) -> PgConnection:
    return psycopg2.connect(database_url)


def ensure_warehouse_schema(conn: PgConnection) -> None:
    """Create raw warehouse objects in the currently connected database."""
    statements = [
        "CREATE SCHEMA IF NOT EXISTS raw",
        "CREATE SCHEMA IF NOT EXISTS staging",
        "CREATE SCHEMA IF NOT EXISTS marts",
        """
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
        )
        """,
        """
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
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS raw.reviews (
            id                  SERIAL PRIMARY KEY,
            pr_number           INTEGER NOT NULL,
            repo                VARCHAR(255) NOT NULL,
            reviewer_login      VARCHAR(255) NOT NULL,
            reviewer_type       VARCHAR(50),
            state               VARCHAR(50) NOT NULL,
            submitted_at        TIMESTAMPTZ NOT NULL,
            extracted_at        TIMESTAMPTZ DEFAULT NOW()
        )
        """,
        """
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
        )
        """,
        """
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
        )
        """,
        """
        DO $$
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
        $$
        """,
    ]

    with conn.cursor() as cur:
        for statement in statements:
            cur.execute(statement)
    conn.commit()


def load_commits(conn: PgConnection, commits: list[dict], repo: str) -> int:
    """Upsert commits into raw.commits. Returns count inserted/updated."""
    if not commits:
        return 0

    sql = """
        INSERT INTO raw.commits (sha, author_login, author_avatar_url, author_type, message, committed_at, repo)
        VALUES (%(sha)s, %(author_login)s, %(author_avatar_url)s, %(author_type)s, %(message)s, %(committed_at)s, %(repo)s)
        ON CONFLICT (sha) DO UPDATE SET
            author_login      = EXCLUDED.author_login,
            author_avatar_url = EXCLUDED.author_avatar_url,
            extracted_at      = NOW()
    """

    rows = [{**c, "repo": repo} for c in commits]

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, rows, page_size=500)
    conn.commit()

    logger.info(f"Loaded {len(rows)} commits for {repo}")
    return len(rows)


def load_pull_requests(conn: PgConnection, prs: list[dict], repo: str) -> int:
    """Upsert pull requests into raw.pull_requests."""
    if not prs:
        return 0

    sql = """
        INSERT INTO raw.pull_requests
            (pr_number, repo, title, author_login, author_avatar_url, author_type,
             state, merged_at, created_at, closed_at, review_comments, comments)
        VALUES
            (%(pr_number)s, %(repo)s, %(title)s, %(author_login)s, %(author_avatar_url)s,
             %(author_type)s, %(state)s, %(merged_at)s, %(created_at)s, %(closed_at)s,
             %(review_comments)s, %(comments)s)
        ON CONFLICT (pr_number, repo) DO UPDATE SET
            title             = EXCLUDED.title,
            state             = EXCLUDED.state,
            merged_at         = EXCLUDED.merged_at,
            closed_at         = EXCLUDED.closed_at,
            review_comments   = EXCLUDED.review_comments,
            comments          = EXCLUDED.comments,
            extracted_at      = NOW()
    """

    rows = [{**pr, "repo": repo} for pr in prs]

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, rows, page_size=500)
    conn.commit()

    logger.info(f"Loaded {len(rows)} pull requests for {repo}")
    return len(rows)


def load_reviews(conn: PgConnection, reviews: list[dict], repo: str) -> int:
    """Upsert reviews so overlapping DAG runs cannot wipe each other out."""
    if not reviews:
        return 0

    sql = """
        INSERT INTO raw.reviews (pr_number, repo, reviewer_login, reviewer_type, state, submitted_at)
        VALUES (%(pr_number)s, %(repo)s, %(reviewer_login)s, %(reviewer_type)s, %(state)s, %(submitted_at)s)
        ON CONFLICT (repo, pr_number, reviewer_login, state, submitted_at) DO UPDATE SET
            reviewer_type = EXCLUDED.reviewer_type,
            extracted_at = NOW()
    """

    rows = [{**r, "repo": repo} for r in reviews]

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, rows, page_size=500)
    conn.commit()

    logger.info(f"Upserted {len(rows)} reviews for {repo}")
    return len(rows)


def load_issues(conn: PgConnection, issues: list[dict], repo: str) -> int:
    """Upsert issues into raw.issues."""
    if not issues:
        return 0

    sql = """
        INSERT INTO raw.issues
            (issue_number, repo, title, state, closed_by_login, closed_by_type,
             created_at, closed_at, updated_at)
        VALUES
            (%(issue_number)s, %(repo)s, %(title)s, %(state)s, %(closed_by_login)s,
             %(closed_by_type)s, %(created_at)s, %(closed_at)s, %(updated_at)s)
        ON CONFLICT (issue_number, repo) DO UPDATE SET
            state           = EXCLUDED.state,
            closed_by_login = EXCLUDED.closed_by_login,
            closed_at       = EXCLUDED.closed_at,
            updated_at      = EXCLUDED.updated_at,
            extracted_at    = NOW()
    """

    rows = [{**i, "repo": repo} for i in issues]

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, rows, page_size=500)
    conn.commit()

    logger.info(f"Loaded {len(rows)} issues for {repo}")
    return len(rows)


def log_pipeline_run(
    conn: PgConnection,
    repo: str,
    status: str,
    counts: dict,
    error: Optional[str] = None
) -> None:
    """Record pipeline run metadata for observability."""
    sql = """
        INSERT INTO raw.pipeline_runs
            (repo, status, commits_loaded, prs_loaded, reviews_loaded, issues_loaded, error_message)
        VALUES
            (%(repo)s, %(status)s, %(commits)s, %(prs)s, %(reviews)s, %(issues)s, %(error)s)
    """
    with conn.cursor() as cur:
        cur.execute(sql, {
            "repo": repo,
            "status": status,
            "commits": counts.get("commits", 0),
            "prs": counts.get("prs", 0),
            "reviews": counts.get("reviews", 0),
            "issues": counts.get("issues", 0),
            "error": error,
        })
    conn.commit()
