"""
api/main.py — GitHub Engineering Impact API v2
Supports ?days= for time-window filtering (7, 15, 30, 60, 90).
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta, timezone
import psycopg2
import psycopg2.extras
import os

app = FastAPI(title="GitHub Engineering Impact API", version="2.0.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://warehouse:warehouse@postgres/github_warehouse")
VALID_DAYS = {7, 15, 30, 60, 90}

def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)

def since_date(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


@app.get("/")
def root():
    return {"status": "ok", "service": "PostHog Impact Dashboard API", "version": "2.0.0"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/leaderboard")
def leaderboard(
    repo: str = Query(default="PostHog/posthog"),
    limit: int = Query(default=10, le=20),
    days: int = Query(default=90),
):
    if days not in VALID_DAYS:
        raise HTTPException(400, detail=f"days must be one of {sorted(VALID_DAYS)}")
    since = since_date(days)
    sql = """
        WITH commits_agg AS (
            SELECT LOWER(author_login) AS engineer_login, author_avatar_url,
                   COUNT(*) AS commits,
                   COUNT(DISTINCT DATE(committed_at)) AS active_days
            FROM raw.commits
            WHERE repo = %(repo)s AND committed_at >= %(since)s AND author_login IS NOT NULL
            GROUP BY LOWER(author_login), author_avatar_url
        ),
        prs_agg AS (
            SELECT LOWER(author_login) AS engineer_login,
                   COUNT(*) AS prs_merged,
                   AVG(COALESCE(review_comments,0)+COALESCE(comments,0)) AS avg_discussion_per_pr,
                   ARRAY_AGG(title ORDER BY merged_at DESC) FILTER (WHERE title IS NOT NULL) AS recent_pr_titles
            FROM raw.pull_requests
            WHERE repo = %(repo)s AND merged_at >= %(since)s AND author_login IS NOT NULL
            GROUP BY LOWER(author_login)
        ),
        reviews_agg AS (
            SELECT LOWER(reviewer_login) AS engineer_login,
                   COUNT(*) AS reviews,
                   SUM(CASE WHEN state='APPROVED' THEN 1 ELSE 0 END) AS approvals,
                   SUM(CASE WHEN state='CHANGES_REQUESTED' THEN 1 ELSE 0 END) AS changes_requested
            FROM raw.reviews
            WHERE repo = %(repo)s AND submitted_at >= %(since)s AND reviewer_login IS NOT NULL
            GROUP BY LOWER(reviewer_login)
        ),
        issues_agg AS (
            SELECT LOWER(closed_by_login) AS engineer_login, COUNT(*) AS issues_closed
            FROM raw.issues
            WHERE repo = %(repo)s AND closed_at >= %(since)s AND closed_by_login IS NOT NULL
            GROUP BY LOWER(closed_by_login)
        ),
        combined AS (
            SELECT
                COALESCE(c.engineer_login, p.engineer_login, r.engineer_login, i.engineer_login) AS engineer_login,
                COALESCE(c.author_avatar_url, '') AS avatar_url,
                COALESCE(c.commits, 0) AS commits,
                COALESCE(c.active_days, 0) AS active_days,
                COALESCE(p.prs_merged, 0) AS prs_merged,
                COALESCE(p.avg_discussion_per_pr, 0) AS avg_discussion_per_pr,
                COALESCE(p.recent_pr_titles, ARRAY[]::TEXT[]) AS recent_pr_titles,
                COALESCE(r.reviews, 0) AS reviews,
                COALESCE(r.approvals, 0) AS approvals,
                COALESCE(r.changes_requested, 0) AS changes_requested,
                COALESCE(i.issues_closed, 0) AS issues_closed
            FROM commits_agg c
            FULL OUTER JOIN prs_agg     p ON c.engineer_login = p.engineer_login
            FULL OUTER JOIN reviews_agg r ON COALESCE(c.engineer_login,p.engineer_login) = r.engineer_login
            FULL OUTER JOIN issues_agg  i ON COALESCE(c.engineer_login,p.engineer_login,r.engineer_login) = i.engineer_login
        ),
        scored AS (
            SELECT *,
                (prs_merged*8 + changes_requested*4 + reviews*3 + issues_closed*2 + commits + approvals)::FLOAT AS impact_score,
                prs_merged*8 AS score_from_prs,
                changes_requested*4 AS score_from_catching_issues,
                reviews*3 AS score_from_reviews,
                issues_closed*2 AS score_from_issues,
                commits AS score_from_commits,
                approvals AS score_from_approvals,
                RANK() OVER (ORDER BY (prs_merged*8+changes_requested*4+reviews*3+issues_closed*2+commits+approvals) DESC) AS impact_rank
            FROM combined
            WHERE commits + prs_merged + reviews > 0
        )
        SELECT * FROM scored ORDER BY impact_rank LIMIT %(limit)s
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, {"repo": repo, "since": since, "limit": limit})
            rows = cur.fetchall()
        conn.close()
        return {"repo": repo, "days": days, "engineers": [dict(r) for r in rows]}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.get("/api/trends/{engineer_login}")
def engineer_trends(
    engineer_login: str,
    repo: str = Query(default="PostHog/posthog"),
    days: int = Query(default=90),
):
    if days not in VALID_DAYS:
        raise HTTPException(400, detail=f"days must be one of {sorted(VALID_DAYS)}")
    since = since_date(days)
    sql = """
        WITH wc AS (
            SELECT DATE_TRUNC('week', committed_at) AS w, COUNT(*) AS commits
            FROM raw.commits WHERE repo=%(repo)s AND LOWER(author_login)=%(login)s AND committed_at>=%(since)s GROUP BY 1
        ),
        wp AS (
            SELECT DATE_TRUNC('week', merged_at) AS w, COUNT(*) AS prs_merged
            FROM raw.pull_requests WHERE repo=%(repo)s AND LOWER(author_login)=%(login)s AND merged_at>=%(since)s GROUP BY 1
        ),
        wr AS (
            SELECT DATE_TRUNC('week', submitted_at) AS w, COUNT(*) AS reviews,
                   SUM(CASE WHEN state='CHANGES_REQUESTED' THEN 1 ELSE 0 END) AS changes_requested
            FROM raw.reviews WHERE repo=%(repo)s AND LOWER(reviewer_login)=%(login)s AND submitted_at>=%(since)s GROUP BY 1
        ),
        weeks AS (SELECT w FROM wc UNION SELECT w FROM wp UNION SELECT w FROM wr)
        SELECT weeks.w AS week_start,
               COALESCE(wc.commits,0) AS commits,
               COALESCE(wp.prs_merged,0) AS prs_merged,
               COALESCE(wr.reviews,0) AS reviews,
               COALESCE(wr.changes_requested,0) AS changes_requested,
               (COALESCE(wp.prs_merged,0)*8 + COALESCE(wr.changes_requested,0)*4 +
                COALESCE(wr.reviews,0)*3 + COALESCE(wc.commits,0)) AS weekly_impact_score
        FROM weeks
        LEFT JOIN wc ON weeks.w=wc.w
        LEFT JOIN wp ON weeks.w=wp.w
        LEFT JOIN wr ON weeks.w=wr.w
        ORDER BY weeks.w
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, {"repo": repo, "login": engineer_login.lower(), "since": since})
            rows = cur.fetchall()
        conn.close()
        if not rows:
            raise HTTPException(404, detail=f"No data for {engineer_login} in last {days} days")
        return {"engineer": engineer_login, "days": days, "trends": [dict(r) for r in rows]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.get("/api/team-summary")
def team_summary(repo: str = Query(default="PostHog/posthog"), days: int = Query(default=90)):
    if days not in VALID_DAYS:
        raise HTTPException(400, detail=f"days must be one of {sorted(VALID_DAYS)}")
    since = since_date(days)
    sql = """
        SELECT
            (SELECT COUNT(DISTINCT LOWER(author_login)) FROM raw.commits WHERE repo=%(repo)s AND committed_at>=%(since)s AND author_login IS NOT NULL) AS total_engineers,
            (SELECT COUNT(*) FROM raw.commits WHERE repo=%(repo)s AND committed_at>=%(since)s) AS total_commits,
            (SELECT COUNT(*) FROM raw.pull_requests WHERE repo=%(repo)s AND merged_at>=%(since)s) AS total_prs_merged,
            (SELECT COUNT(*) FROM raw.reviews WHERE repo=%(repo)s AND submitted_at>=%(since)s) AS total_reviews,
            (SELECT COUNT(*) FROM raw.issues WHERE repo=%(repo)s AND closed_at>=%(since)s) AS total_issues_closed
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, {"repo": repo, "since": since})
            row = cur.fetchone()
        conn.close()
        return dict(row)
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.get("/api/pipeline-status")
def pipeline_status():
    sql = "SELECT repo, status, commits_loaded, prs_loaded, reviews_loaded, issues_loaded, run_at, error_message FROM raw.pipeline_runs ORDER BY run_at DESC LIMIT 5"
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
        conn.close()
        return {"runs": [dict(r) for r in rows]}
    except Exception as e:
        raise HTTPException(500, detail=str(e))
