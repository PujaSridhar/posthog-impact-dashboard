# GitHub Engineering Impact — Data Pipeline

A production-style data engineering project that extracts GitHub activity data, transforms it through a dbt model layer, and exposes it through a FastAPI API for a React dashboard. The app can run locally with Docker and deploy as a serverless frontend + API with Redis caching.

## Architecture

```
GitHub REST API
      ↓
  Airflow DAG (daily @ 2am UTC)
      ↓
  PostgreSQL — raw schema (bronze)
      ↓
  dbt transformations
      ├── staging schema (silver) — cleaned & typed
      └── marts schema (gold)    — aggregated, scored
            ├── fct_engineer_impact
            └── fct_engineer_weekly_trends
      ↓
  FastAPI (/api/leaderboard, /api/trends, /api/team-summary)
      ↓
  Redis cache
      ↓
  React Dashboard
```

## Stack

| Layer | Technology |
|---|---|
| Orchestration | Apache Airflow 2.8 |
| Warehouse | PostgreSQL 15 |
| Transformation | dbt-core 1.7 |
| API | FastAPI + Uvicorn |
| Infra | Docker Compose (local) + Vercel serverless (deploy) |
| Cache | Redis |

## Getting Started

### Prerequisites
- Docker Desktop
- A GitHub Personal Access Token (`public_repo` scope)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/github-impact-pipeline.git
cd github-impact-pipeline

# 2. Set up environment variables
cp .env.example .env
# Edit .env and add your GITHUB_TOKEN.
# You can also customize local Postgres, warehouse, and Airflow admin credentials there.

# 3. Set your Airflow UID (Mac/Linux)
echo "AIRFLOW_UID=$(id -u)" >> .env

# 4. Start all services
docker compose up -d

# 5. Trigger the first load
docker compose exec airflow-scheduler airflow dags trigger github_engineering_impact

# Wait ~2 minutes for Airflow to initialise, then open:
# Airflow UI:  http://localhost:8080  (admin / admin)
# FastAPI:     http://localhost:8000
# API docs:    http://localhost:8000/docs
# Postgres:    localhost:5432
```

Local credentials are fully env-driven:

```bash
AIRFLOW_DB_USER=airflow
AIRFLOW_DB_PASSWORD=airflow
AIRFLOW_DB_NAME=airflow
WAREHOUSE_DB_USER=warehouse
WAREHOUSE_DB_PASSWORD=warehouse
WAREHOUSE_DB_NAME=github_warehouse
AIRFLOW_ADMIN_USERNAME=admin
AIRFLOW_ADMIN_PASSWORD=admin
AIRFLOW_ADMIN_EMAIL=admin@example.com
```

### Running the pipeline manually

```bash
# DAGs are created unpaused, so scheduled runs can start automatically.
# To kick off an immediate sync from the CLI:
docker compose exec airflow-scheduler airflow dags trigger github_engineering_impact
```

### Running dbt manually

```bash
docker compose exec airflow-scheduler bash -c "cd /opt/airflow/dbt && dbt run --profiles-dir /opt/airflow/dbt"
```

## Serverless Deployment

This repo is configured for a serverless deployment on Vercel:

- `frontend/` builds into a static site.
- `api/index.py` exposes the FastAPI app as a serverless function.
- Redis caches API responses for leaderboard, trends, team summary, and pipeline status.

### Required environment variables

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME
REDIS_URL=redis://default:PASSWORD@HOST:6379
CACHE_TTL_SECONDS=300
```

### Deploy flow

1. Provision managed Postgres and Redis.
2. Import the repo into Vercel.
3. Add the environment variables above.
4. Deploy. The frontend and API will share the same domain, so the React app can call `/api/...` directly.

## Data Model

### Bronze (raw schema)
Raw tables loaded directly from GitHub API — no transformations.

| Table | Description |
|---|---|
| `raw.commits` | All non-bot commits |
| `raw.pull_requests` | All merged PRs |
| `raw.reviews` | PR reviews (sampled) |
| `raw.issues` | Closed issues |
| `raw.pipeline_runs` | Pipeline run log |

### Silver (staging schema)
Cleaned and typed views managed by dbt.

| Model | Description |
|---|---|
| `stg_commits` | Cleaned commits with commit type classification |
| `stg_pull_requests` | Cleaned PRs with discussion level |
| `stg_reviews` | Reviews with boolean flags per state |
| `stg_issues` | Issues with time-to-close |

### Gold (marts schema)
Aggregated tables ready for the API.

| Model | Description |
|---|---|
| `fct_engineer_impact` | Impact scores + full breakdown per engineer |
| `fct_engineer_weekly_trends` | Weekly activity for trend charts |

## Impact Score Formula

```
Score = (PRs Merged × 8) + (Changes Requested × 4) + (Reviews Given × 3)
      + (Issues Closed × 2) + (Commits × 1) + (Approvals × 1)
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/leaderboard` | Top 5 engineers with full score breakdown |
| `GET /api/trends/{login}` | Weekly impact trend for one engineer |
| `GET /api/team-summary` | High-level team stats |
| `GET /api/pipeline-status` | Recent pipeline run logs |

Full docs at `http://localhost:8000/docs` (Swagger UI).

## Project Structure

```
.
├── airflow/
│   └── dags/
│       └── github_pipeline.py      # Main Airflow DAG
├── extraction/
│   ├── github_client.py            # GitHub API client
│   └── db_loader.py                # Postgres loader (upsert logic)
├── dbt/
│   ├── models/
│   │   ├── staging/                # Silver layer models
│   │   └── marts/                  # Gold layer models
│   ├── dbt_project.yml
│   └── profiles.yml
├── api/
│   ├── main.py                     # FastAPI app
│   ├── Dockerfile
│   └── requirements.txt
├── init-warehouse.sql              # DB + schema initialisation
├── docker-compose.yml
└── .env.example
```
