"""
airflow/dags/github_pipeline.py

Daily DAG that extracts GitHub data for PostHog and loads it into
the raw Postgres schema. dbt transformations run after extraction.

Schedule: Daily at 2am UTC
"""

import os
import sys
from datetime import datetime, timedelta, timezone

from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.operators.bash import BashOperator
from airflow.utils.dates import days_ago

# Make extraction module importable inside Airflow
sys.path.insert(0, "/opt/airflow/extraction")

REPO = "PostHog/posthog"
DAYS_BACK = 90
WAREHOUSE_URL = os.getenv("WAREHOUSE_CONN", "postgresql://warehouse:warehouse@postgres/github_warehouse")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
# How many recent PRs to fetch reviews for — balances coverage vs API cost
REVIEW_SAMPLE_SIZE = 50

default_args = {
    "owner": "airflow",
    "retries": 2,
    "retry_delay": timedelta(minutes=5),
    "email_on_failure": False,
}


def _since_iso() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)).isoformat()


# ── Task functions ────────────────────────────────────────────────────────────

def extract_commits(**context):
    from github_client import GitHubClient
    from db_loader import get_connection, load_commits

    client = GitHubClient(token=GITHUB_TOKEN)
    since = _since_iso()

    commits = client.get_commits(REPO, since, max_pages=5)
    conn = get_connection(WAREHOUSE_URL)
    count = load_commits(conn, commits, REPO)
    conn.close()

    # Push count to XCom for the logging task
    context["ti"].xcom_push(key="commits_count", value=count)
    return count


def extract_pull_requests(**context):
    from github_client import GitHubClient
    from db_loader import get_connection, load_pull_requests

    client = GitHubClient(token=GITHUB_TOKEN)
    since = _since_iso()

    prs = client.get_merged_prs(REPO, since, max_pages=5)
    conn = get_connection(WAREHOUSE_URL)
    count = load_pull_requests(conn, prs, REPO)
    conn.close()

    # Store PR numbers for the reviews task
    pr_numbers = [pr["pr_number"] for pr in prs]
    context["ti"].xcom_push(key="pr_numbers", value=pr_numbers[:REVIEW_SAMPLE_SIZE])
    context["ti"].xcom_push(key="prs_count", value=count)
    return count


def extract_reviews(**context):
    from github_client import GitHubClient
    from db_loader import get_connection, load_reviews

    # Pull PR numbers from previous task via XCom
    pr_numbers = context["ti"].xcom_pull(task_ids="extract_pull_requests", key="pr_numbers") or []

    if not pr_numbers:
        print("No PR numbers found, skipping reviews extraction")
        return 0

    client = GitHubClient(token=GITHUB_TOKEN)
    reviews = client.get_reviews_for_prs(REPO, pr_numbers)

    conn = get_connection(WAREHOUSE_URL)
    count = load_reviews(conn, reviews, REPO)
    conn.close()

    context["ti"].xcom_push(key="reviews_count", value=count)
    return count


def extract_issues(**context):
    from github_client import GitHubClient
    from db_loader import get_connection, load_issues

    client = GitHubClient(token=GITHUB_TOKEN)
    since = _since_iso()

    issues = client.get_closed_issues(REPO, since, max_pages=3)
    conn = get_connection(WAREHOUSE_URL)
    count = load_issues(conn, issues, REPO)
    conn.close()

    context["ti"].xcom_push(key="issues_count", value=count)
    return count


def log_run(**context):
    from db_loader import get_connection, log_pipeline_run

    ti = context["ti"]
    counts = {
        "commits":  ti.xcom_pull(task_ids="extract_commits",       key="commits_count")  or 0,
        "prs":      ti.xcom_pull(task_ids="extract_pull_requests",  key="prs_count")      or 0,
        "reviews":  ti.xcom_pull(task_ids="extract_reviews",        key="reviews_count")  or 0,
        "issues":   ti.xcom_pull(task_ids="extract_issues",         key="issues_count")   or 0,
    }

    conn = get_connection(WAREHOUSE_URL)
    log_pipeline_run(conn, REPO, "success", counts)
    conn.close()

    print(f"Pipeline complete: {counts}")


# ── DAG definition ────────────────────────────────────────────────────────────

with DAG(
    dag_id="github_engineering_impact",
    default_args=default_args,
    description="Extract PostHog GitHub data and compute engineering impact metrics",
    schedule_interval="0 2 * * *",  # Daily at 2am UTC
    start_date=days_ago(1),
    catchup=False,
    tags=["github", "engineering-metrics"],
) as dag:

    t_commits = PythonOperator(
        task_id="extract_commits",
        python_callable=extract_commits,
    )

    t_prs = PythonOperator(
        task_id="extract_pull_requests",
        python_callable=extract_pull_requests,
    )

    t_reviews = PythonOperator(
        task_id="extract_reviews",
        python_callable=extract_reviews,
    )

    t_issues = PythonOperator(
        task_id="extract_issues",
        python_callable=extract_issues,
    )

    # Run dbt transformations after all raw data is loaded
    t_dbt = BashOperator(
        task_id="run_dbt_transformations",
        bash_command="cd /opt/airflow/dbt && /home/airflow/.local/bin/dbt run --profiles-dir /opt/airflow/dbt",
    )

    t_log = PythonOperator(
        task_id="log_pipeline_run",
        python_callable=log_run,
        trigger_rule="all_done",  # Log even if some tasks fail
    )

    # Extraction tasks run in parallel, then dbt, then log
    [t_commits, t_prs, t_issues] >> t_dbt
    t_prs >> t_reviews >> t_dbt
    t_dbt >> t_log
