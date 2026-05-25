"""
api/main.py — GitHub Engineering Impact API v2
Supports ?days= for time-window filtering (7, 15, 30, 60, 90).
"""

from hashlib import sha256
import json
import os
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis import Redis
from redis.exceptions import RedisError

app = FastAPI(title="GitHub Engineering Impact API", version="2.0.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://warehouse:warehouse@postgres/github_warehouse")
VALID_DAYS = {7, 15, 30, 60, 90}
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", os.getenv("CACHE_TTL", "300")))
REDIS_URL = os.getenv("REDIS_URL")
redis_client = Redis.from_url(REDIS_URL, decode_responses=True) if REDIS_URL else None

def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)

def since_date(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def cache_key(namespace: str, **params) -> str:
    serialized = "&".join(f"{key}={params[key]}" for key in sorted(params))
    digest = sha256(serialized.encode("utf-8")).hexdigest()
    return f"posthog-impact:{namespace}:{digest}"


def read_cache(key: str):
    if not redis_client:
        return None
    try:
        cached = redis_client.get(key)
        return json.loads(cached) if cached else None
    except (RedisError, json.JSONDecodeError):
        return None


def write_cache(key: str, payload) -> None:
    if not redis_client:
        return
    try:
        redis_client.setex(key, CACHE_TTL_SECONDS, json.dumps(jsonable_encoder(payload)))
    except RedisError:
        return


def cached_response(key: str, response: Response):
    payload = read_cache(key)
    if payload is None:
        response.headers["X-Cache"] = "MISS" if redis_client else "BYPASS"
        return None
    return JSONResponse(content=payload, headers={"X-Cache": "HIT"})


@app.get("/")
def root():
    return {
        "status": "ok",
        "service": "PostHog Impact Dashboard API",
        "version": "2.0.0",
        "serverless": True,
        "cache": "redis" if redis_client else "disabled",
    }


@app.get("/health")
def health():
    return {"status": "ok", "cache": "redis" if redis_client else "disabled"}


@app.get("/api/leaderboard")
def leaderboard(
    response: Response,
    repo: str = Query(default="PostHog/posthog"),
    limit: int = Query(default=10, le=20),
    days: int = Query(default=90),
):
    if days not in VALID_DAYS:
        raise HTTPException(400, detail=f"days must be one of {sorted(VALID_DAYS)}")
    key = cache_key("leaderboard", repo=repo, limit=limit, days=days)
    cached = cached_response(key, response)
    if cached:
        return cached
    since = since_date(days)
    sql = """
        SELECT * FROM marts.fct_engineer_impact
        WHERE repo = %(repo)s
        ORDER BY impact_score DESC
        LIMIT %(limit)s
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, {"repo": repo, "since": since, "limit": limit})
            rows = cur.fetchall()
        conn.close()
        payload = {"repo": repo, "days": days, "engineers": [dict(r) for r in rows]}
        write_cache(key, payload)
        return payload
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.get("/api/trends/{engineer_login}")
def engineer_trends(
    response: Response,
    engineer_login: str,
    repo: str = Query(default="PostHog/posthog"),
    days: int = Query(default=90),
):
    if days not in VALID_DAYS:
        raise HTTPException(400, detail=f"days must be one of {sorted(VALID_DAYS)}")
    key = cache_key("trends", repo=repo, login=engineer_login.lower(), days=days)
    cached = cached_response(key, response)
    if cached:
        return cached
    since = since_date(days)
    sql = """
        SELECT week_start, commits, prs_merged, reviews, changes_requested, weekly_impact_score
        FROM marts.fct_engineer_weekly_trends
        WHERE repo = %(repo)s AND engineer_login = %(login)s
        ORDER BY week_start
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, {"repo": repo, "login": engineer_login.lower(), "since": since})
            rows = cur.fetchall()
        conn.close()
        if not rows:
            raise HTTPException(404, detail=f"No data for {engineer_login} in last {days} days")
        payload = {"engineer": engineer_login, "days": days, "trends": [dict(r) for r in rows]}
        write_cache(key, payload)
        return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.get("/api/team-summary")
def team_summary(
    response: Response,
    repo: str = Query(default="PostHog/posthog"),
    days: int = Query(default=90),
):
    if days not in VALID_DAYS:
        raise HTTPException(400, detail=f"days must be one of {sorted(VALID_DAYS)}")
    key = cache_key("team-summary", repo=repo, days=days)
    cached = cached_response(key, response)
    if cached:
        return cached
    since = since_date(days)
    sql = """
        SELECT total_engineers, total_commits, total_prs_merged, total_reviews, total_issues_closed
        FROM marts.fct_team_summary
        WHERE repo = %(repo)s AND days = %(days)s
    """
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql, {"repo": repo, "since": since})
            row = cur.fetchone()
        conn.close()
        payload = dict(row)
        write_cache(key, payload)
        return payload
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.get("/api/pipeline-status")
def pipeline_status(response: Response):
    key = cache_key("pipeline-status")
    cached = cached_response(key, response)
    if cached:
        return cached
    sql = "SELECT repo, status, commits_loaded, prs_loaded, reviews_loaded, issues_loaded, run_at, error_message FROM raw.pipeline_runs ORDER BY run_at DESC LIMIT 5"
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
        conn.close()
        payload = {"runs": [dict(r) for r in rows]}
        write_cache(key, payload)
        return payload
    except Exception as e:
        raise HTTPException(500, detail=str(e))
