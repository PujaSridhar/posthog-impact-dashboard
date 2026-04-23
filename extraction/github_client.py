"""
extraction/github_client.py

Handles all GitHub REST API calls with pagination, rate limit handling,
and bot filtering. Used by both the Airflow DAG and standalone scripts.
"""

import os
import time
import logging
from datetime import datetime, timezone
from typing import Optional
import requests

logger = logging.getLogger(__name__)

BOT_LOGINS = {
    "dependabot", "dependabot[bot]", "posthog-bot",
    "github-actions[bot]", "renovate[bot]", "codecov[bot]"
}


class GitHubClient:
    BASE_URL = "https://api.github.com"

    def __init__(self, token: Optional[str] = None):
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        if self.token:
            self.session.headers["Authorization"] = f"token {self.token}"

    def _get(self, url: str, params: dict = None) -> list | dict:
        """Single GET with rate limit handling."""
        for attempt in range(3):
            response = self.session.get(url, params=params, timeout=30)

            if response.status_code == 403:
                reset_time = int(response.headers.get("X-RateLimit-Reset", time.time() + 60))
                wait = max(reset_time - time.time(), 0) + 5
                logger.warning(f"Rate limited. Waiting {wait:.0f}s before retry {attempt + 1}/3")
                time.sleep(wait)
                continue

            if response.status_code == 404:
                logger.error(f"Not found: {url}")
                return []

            response.raise_for_status()
            return response.json()

        raise Exception(f"Failed after 3 retries: {url}")

    def paginate(self, endpoint: str, params: dict = None, max_pages: int = 10) -> list:
        """Fetch all pages of a paginated endpoint."""
        params = params or {}
        params["per_page"] = 100
        results = []

        for page in range(1, max_pages + 1):
            params["page"] = page
            data = self._get(f"{self.BASE_URL}{endpoint}", params=params)

            if not isinstance(data, list) or len(data) == 0:
                break

            results.extend(data)
            logger.info(f"  Page {page}: fetched {len(data)} items (total: {len(results)})")

            if len(data) < 100:
                break

        return results

    def is_bot(self, user: dict | None) -> bool:
        if not user:
            return True
        return (
            user.get("type") == "Bot"
            or user.get("login", "").lower() in BOT_LOGINS
            or "[bot]" in user.get("login", "")
        )

    # ── Extraction methods ────────────────────────────────────────────────────

    def get_commits(self, repo: str, since: str, max_pages: int = 5) -> list[dict]:
        """Fetch commits since ISO date string."""
        logger.info(f"Fetching commits for {repo} since {since}")
        raw = self.paginate(f"/repos/{repo}/commits", {"since": since}, max_pages)

        commits = []
        for c in raw:
            author = c.get("author")
            if self.is_bot(author):
                continue
            commits.append({
                "sha": c["sha"],
                "author_login": author["login"] if author else None,
                "author_avatar_url": author.get("avatar_url") if author else None,
                "author_type": author.get("type") if author else None,
                "message": c["commit"]["message"][:500] if c.get("commit") else None,
                "committed_at": c["commit"]["author"]["date"] if c.get("commit") else None,
            })

        logger.info(f"  → {len(commits)} non-bot commits")
        return commits

    def get_merged_prs(self, repo: str, since: str, max_pages: int = 5) -> list[dict]:
        """Fetch merged PRs since ISO date string."""
        logger.info(f"Fetching merged PRs for {repo} since {since}")
        raw = self.paginate(
            f"/repos/{repo}/pulls",
            {"state": "closed", "sort": "updated", "direction": "desc"},
            max_pages
        )

        prs = []
        for pr in raw:
            if not pr.get("merged_at"):
                continue
            if pr["merged_at"] < since:
                continue
            if self.is_bot(pr.get("user")):
                continue

            prs.append({
                "pr_number": pr["number"],
                "title": pr["title"],
                "author_login": pr["user"]["login"],
                "author_avatar_url": pr["user"].get("avatar_url"),
                "author_type": pr["user"].get("type"),
                "state": pr["state"],
                "merged_at": pr["merged_at"],
                "created_at": pr.get("created_at"),
                "closed_at": pr.get("closed_at"),
                # NOTE: additions/deletions are NOT available in list view
                # We use review_comments as a depth proxy instead
                "review_comments": pr.get("review_comments", 0),
                "comments": pr.get("comments", 0),
            })

        logger.info(f"  → {len(prs)} merged PRs in window")
        return prs

    def get_reviews_for_prs(self, repo: str, pr_numbers: list[int]) -> list[dict]:
        """Fetch reviews for a list of PR numbers."""
        logger.info(f"Fetching reviews for {len(pr_numbers)} PRs in {repo}")
        all_reviews = []

        for pr_number in pr_numbers:
            data = self._get(f"{self.BASE_URL}/repos/{repo}/pulls/{pr_number}/reviews")
            if not isinstance(data, list):
                continue

            for r in data:
                reviewer = r.get("user")
                if self.is_bot(reviewer):
                    continue
                reviewer_login = reviewer["login"] if reviewer else None
                submitted_at = r.get("submitted_at")
                state = r.get("state")
                if not reviewer_login or not submitted_at or not state:
                    continue
                all_reviews.append({
                    "pr_number": pr_number,
                    "reviewer_login": reviewer_login,
                    "reviewer_type": reviewer.get("type") if reviewer else None,
                    "state": state,  # APPROVED, CHANGES_REQUESTED, COMMENTED
                    "submitted_at": submitted_at,
                })

        logger.info(f"  → {len(all_reviews)} reviews fetched")
        return all_reviews

    def get_closed_issues(self, repo: str, since: str, max_pages: int = 3) -> list[dict]:
        """
        Fetch closed issues (not PRs) since ISO date string.
        NOTE: GitHub's `since` param filters by updated_at, not closed_at.
        We apply a secondary filter on closed_at for accuracy.
        """
        logger.info(f"Fetching closed issues for {repo} since {since}")
        raw = self.paginate(
            f"/repos/{repo}/issues",
            {"state": "closed", "since": since, "sort": "updated"},
            max_pages
        )

        issues = []
        for issue in raw:
            # Strip PRs — every PR is also an issue in GitHub's model
            if issue.get("pull_request"):
                continue
            # Secondary filter: closed_at must be within our window
            if not issue.get("closed_at") or issue["closed_at"] < since:
                continue

            closed_by = issue.get("closed_by")
            if self.is_bot(closed_by):
                continue

            issues.append({
                "issue_number": issue["number"],
                "title": issue["title"],
                "state": issue["state"],
                "closed_by_login": closed_by["login"] if closed_by else None,
                "closed_by_type": closed_by.get("type") if closed_by else None,
                "created_at": issue.get("created_at"),
                "closed_at": issue.get("closed_at"),
                "updated_at": issue.get("updated_at"),
            })

        logger.info(f"  → {len(issues)} real closed issues in window")
        return issues
