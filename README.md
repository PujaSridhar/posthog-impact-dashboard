# PostHog Engineering Impact Dashboard

An interactive dashboard that identifies the most impactful engineers in the [PostHog](https://github.com/PostHog/posthog) open-source repository over the last 90 days, built using live GitHub API data.

> Built as part of a take-home assessment for [Weave](https://workweave.ai).

---

## Live Demo

🔗 https://posthog-impact-dashboard-qb2jnek12-pujasridhar2001.vercel.app

---

## What It Does

The dashboard fetches real data from the GitHub REST API and ranks the top 5 engineers by a weighted **Impact Score** that captures three dimensions:

| Dimension | Signals | Rationale |
|---|---|---|
| **Shipping** | PRs merged | Primary output signal — code that actually lands |
| **Quality** | Changes requested, reviews given | Catching bugs + raising team quality |
| **Breadth** | Commits, issues closed | Activity across the codebase |

### Impact Score Formula

```
Score = (PRs Merged × 8) + (Changes Requested × 4) + (Reviews Given × 3) + (Issues Closed × 2) + (Commits × 1) + (Approvals × 1)
```

PRs carry the highest weight because shipping is the primary job. Changes Requested is weighted higher than approvals because it signals the reviewer actually read the diff and caught a real problem.

### Impact Profiles

Each engineer is automatically assigned a profile based on their strongest dimension:

| Profile | Meaning |
|---|---|
| 🏆 The All-Rounder | Ships features AND actively catches bugs in review |
| 🔵 The Quality Guardian | Primarily catches bugs before they land in main |
| 🟢 The Shipping Reviewer | Delivers features while keeping teammates unblocked |
| 🟣 The Code Reviewer | Keeps team quality high through thorough reviews |
| 🟠 The Code Engine | High commit breadth across the codebase |
| 🟢 The Feature Shipper | Consistently delivers merged work at pace |

---

## Data Sources

All data is fetched **client-side** directly from the GitHub REST API:

- `/repos/PostHog/posthog/commits?since=<90 days ago>` — commit activity
- `/repos/PostHog/posthog/pulls?state=closed` — merged PRs (filtered to last 90 days)
- `/repos/PostHog/posthog/pulls/:id/reviews` — review data (sampled from 25 most recent PRs to stay within rate limits)
- `/repos/PostHog/posthog/issues?state=closed` — closed issues (filtered by `closed_at`, not `updated_at`)

### Rate Limit Note

Without a GitHub token: **60 requests/hour**. The app is designed to stay within this budget (commits + PRs use ~8 requests, 25 review fetches = ~33 total).

With a token: **5,000 requests/hour**. Strongly recommended for accurate review data.

---

## Token Security

Your GitHub token is **never stored or transmitted anywhere** other than directly to the GitHub API from your browser. It lives only in React component state and is gone when you close the tab. The app has no backend.

---

## Tech Stack

- **React** (Vite)
- **GitHub REST API** — no third-party data libraries
- **Vercel** — deployment

---

## Running Locally

```bash
# Clone the repo
git clone https://github.com/PujaSridhar/posthog-impact-dashboard.git
cd posthog-impact-dashboard

# Install dependencies
npm install

# Start dev server
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173), optionally paste a GitHub Personal Access Token, and click **Load Data**.

### Generating a GitHub Token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Check the `public_repo` scope
4. Copy the token and paste it into the dashboard

---

## Deployment

```bash
npm run build
npx vercel
```

---

## Caveats & Known Limitations

- **Review data is sampled** from the 25 most recent merged PRs only, to protect the unauthenticated rate limit. This means review counts are an undercount of true review activity — use a token for more complete data.
- **Issues closed** uses `closed_by` (the person who closed the issue), not `assignee`, for more accurate attribution.
- **Bot accounts** (`dependabot`, `github-actions[bot]`, `renovate[bot]`, etc.) are filtered out.
- The GitHub pulls list API does **not** return `additions`/`deletions` per PR — fetching those individually would require one API request per PR and would instantly exhaust the rate limit. This field is intentionally excluded.
