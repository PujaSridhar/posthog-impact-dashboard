import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


def configure_dbt_from_url() -> None:
    database_url = os.getenv("WAREHOUSE_CONN") or os.getenv("DATABASE_URL")
    if not database_url:
        return

    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("WAREHOUSE_CONN/DATABASE_URL must be a Postgres connection URL")

    query = parse_qs(parsed.query)
    os.environ.setdefault("DBT_WAREHOUSE_HOST", parsed.hostname or "")
    os.environ.setdefault("DBT_WAREHOUSE_PORT", str(parsed.port or 5432))
    os.environ.setdefault("DBT_WAREHOUSE_DBNAME", unquote(parsed.path.lstrip("/")))
    os.environ.setdefault("DBT_WAREHOUSE_USER", unquote(parsed.username or ""))
    os.environ.setdefault("DBT_WAREHOUSE_PASSWORD", unquote(parsed.password or ""))
    os.environ.setdefault("DBT_WAREHOUSE_SSLMODE", query.get("sslmode", ["require"])[0])


def main() -> int:
    configure_dbt_from_url()

    dbt_bin = shutil.which("dbt")
    if not dbt_bin:
        raise RuntimeError("dbt executable not found. Install dbt-postgres in the Airflow image.")

    project_dir = Path(__file__).resolve().parent
    return subprocess.call(
        [dbt_bin, "run", "--profiles-dir", str(project_dir)],
        cwd=project_dir,
    )


if __name__ == "__main__":
    sys.exit(main())
