"""
api/main.py

FastAPI layer on top of the Postgres mart tables.
Provides clean REST endpoints for the React frontend.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import psycopg2
import psycopg2.extras
import os

app = FastAPI(
    title="GitHub Engineering Impact API",
    description="REST API for the PostHog engineering impact dashboard",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://warehouse:warehouse@postgres/github_warehouse")


def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/leaderboard")
def leaderboard(
    repo: str = Query(default="PostHog/posthog"),
    limit: int = Query(default=5, le=20),
):
    """Top N engineers by impact score with full breakdown."""
    sql = """
        SELECT
            engineer_login,
            repo,
            commits,
            active_days,
            prs_merged,
            reviews,
            approvals,
            changes_requested,
            issues_closed,
            impact_score,
            impact_rank,
            score_from_prs,
            score_from_catching_issues,
            score_from_reviews,
            score_from_issues,
            score_from_commits,
            score_from_approvals,
            recent_pr_titles[1:3]   AS recent_pr_titles,
            avg_discussion_per_pr,
            computed_at
        FROM marts_marts.fct_engineer_impact
        WHERE repo = %s
        ORDER BY impact_rank
        LIMIT %s
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, (repo, limit))
            rows = cur.fetchall()
        conn.close()
        return {"repo": repo, "engineers": [dict(r) for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/trends/{engineer_login}")
def engineer_trends(
    engineer_login: str,
    repo: str = Query(default="PostHog/posthog"),
):
    """Weekly impact trend for a specific engineer."""
    sql = """
        SELECT
            week_start,
            commits,
            prs_merged,
            reviews,
            changes_requested,
            weekly_impact_score
        FROM marts_marts.fct_engineer_weekly_trends
        WHERE engineer_login = %s AND repo = %s
        ORDER BY week_start
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, (engineer_login.lower(), repo))
            rows = cur.fetchall()
        conn.close()
        if not rows:
            raise HTTPException(status_code=404, detail=f"Engineer {engineer_login} not found")
        return {"engineer": engineer_login, "trends": [dict(r) for r in rows]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/team-summary")
def team_summary(repo: str = Query(default="PostHog/posthog")):
    """High-level team stats for the dashboard header."""
    sql = """
        SELECT
            COUNT(DISTINCT engineer_login)  AS total_engineers,
            SUM(commits)                    AS total_commits,
            SUM(prs_merged)                 AS total_prs_merged,
            SUM(reviews)                    AS total_reviews,
            SUM(issues_closed)              AS total_issues_closed,
            MAX(computed_at)                AS last_updated
        FROM marts_marts.fct_engineer_impact
        WHERE repo = %s
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, (repo,))
            row = cur.fetchone()
        conn.close()
        return dict(row)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pipeline-status")
def pipeline_status():
    """Latest pipeline run metadata — useful for showing data freshness."""
    sql = """
        SELECT repo, status, commits_loaded, prs_loaded,
               reviews_loaded, issues_loaded, run_at, error_message
        FROM raw.pipeline_runs
        ORDER BY run_at DESC
        LIMIT 5
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
        conn.close()
        return {"runs": [dict(r) for r in rows]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
