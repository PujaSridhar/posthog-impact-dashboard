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
