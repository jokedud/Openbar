'use strict';

const repository = 'jokedud/Openbar';
const repoPath = `/repos/${repository}`;
const accepted = new Set(['success', 'skipped', 'neutral']);
const reviewQuery = `query ($number: Int!, $threads: String, $reviews: String) {
  repository(owner: "jokedud", name: "Openbar") {
    pullRequest(number: $number) {
      state headRefOid mergeStateStatus reviewDecision
      reviewThreads(first: 100, after: $threads) {
        nodes { isResolved }
        pageInfo { hasNextPage endCursor }
      }
      latestOpinionatedReviews(first: 100, after: $reviews) {
        nodes { state }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

function isEligible(pr) {
  return pr.state === 'open' && !pr.draft &&
    pr.title.startsWith('SWF(') && pr.user?.login === 'jokedud' && pr.user.id === 156004109 &&
    pr.base.ref === 'main' && pr.head.repo?.full_name === repository;
}

function checkBlocker(statuses, checks, build) {
  const review = statuses.find(({ context }) => context === 'Devin Review');
  if (review?.state !== 'success' || review.creator?.login !== 'devin-ai-integration[bot]') {
    return 'Devin Review has not passed';
  }
  if (build?.conclusion !== 'success' || !checks.some((check) =>
    check.name === 'windows' && check.app?.slug === 'github-actions' &&
    check.check_suite?.id === build.check_suite_id && check.conclusion === 'success')) {
    return 'Windows CI has not passed';
  }
  const status = statuses.find(({ state }) => !accepted.has(state));
  if (status) return `status ${status.context} is ${status.state}`;
  const check = checks.find(({ status, conclusion }) => status !== 'completed' || !accepted.has(conclusion));
  if (check) return `check ${check.name} is ${check.conclusion || check.status}`;
}

async function* list(api, path, select = (body) => body) {
  const separator = path.includes('?') ? '&' : '?';
  for (let page = 1; ; page++) {
    const items = select(await api(`${path}${separator}per_page=100&page=${page}`));
    yield* items;
    if (items.length < 100) return;
  }
}

async function latestStatuses(api, commit) {
  const byContext = new Map();
  for await (const status of list(api, `${commit}/statuses`)) {
    if (!byContext.has(status.context)) byContext.set(status.context, status);
  }
  return [...byContext.values()];
}

async function reviewBlocker(api, pr) {
  let threads = null;
  let reviews = null;
  do {
    const result = await api('/graphql', { query: reviewQuery, variables: { number: pr.number, threads, reviews } }, 'POST');
    const current = result.data.repository.pullRequest;
    if (current.state !== 'OPEN' || current.headRefOid !== pr.head.sha) return 'PR changed during the scan';
    if (current.reviewDecision === 'CHANGES_REQUESTED' ||
        current.latestOpinionatedReviews.nodes.some(({ state }) => state === 'CHANGES_REQUESTED')) {
      return 'changes requested';
    }
    if (current.reviewThreads.nodes.some(({ isResolved }) => !isResolved)) return 'unresolved review threads';
    if (current.mergeStateStatus !== 'CLEAN') return `merge state is ${current.mergeStateStatus}`;
    const threadPage = current.reviewThreads.pageInfo;
    const reviewPage = current.latestOpinionatedReviews.pageInfo;
    if (!threadPage.hasNextPage && !reviewPage.hasNextPage) return;
    if (threadPage.hasNextPage) threads = threadPage.endCursor;
    if (reviewPage.hasNextPage) reviews = reviewPage.endCursor;
  } while (true);
}

async function scan(api, { merge = false, log = console.log } = {}) {
  const candidates = await Array.fromAsync(list(api, `${repoPath}/pulls?state=open&base=main&sort=created&direction=asc`));
  for (const pr of candidates) {
    const label = `#${pr.number}`;
    if (!isEligible(pr)) {
      log(`${label}: not eligible`);
      continue;
    }

    const commit = `${repoPath}/commits/${pr.head.sha}`;
    const pull = `${repoPath}/pulls/${pr.number}`;
    const params = new URLSearchParams({ head_sha: pr.head.sha, branch: pr.head.ref, event: 'pull_request', per_page: '1' });
    const [statuses, checks, builds] = await Promise.all([
      latestStatuses(api, commit),
      Array.fromAsync(list(api, `${commit}/check-runs?filter=latest`, (body) => body.check_runs)),
      api(`${repoPath}/actions/workflows/build.yml/runs?${params}`),
    ]);
    const blocker = checkBlocker(statuses, checks, builds.workflow_runs[0]) || await reviewBlocker(api, pr);
    if (blocker) {
      log(`${label}: waiting — ${blocker}`);
      continue;
    }
    const current = await api(pull);
    if (!isEligible(current) || current.head.sha !== pr.head.sha || current.mergeable_state !== 'clean') {
      log(`${label}: eligibility or merge state changed during the scan`);
      continue;
    }
    const comparison = await api(`${repoPath}/compare/main...${pr.head.sha}?per_page=1`);
    if (comparison.behind_by !== 0) {
      log(`${label}: waiting — behind main`);
      continue;
    }
    if (!merge) {
      log(`${label}: would merge`);
      continue;
    }
    const result = await api(`${pull}/merge`, { sha: pr.head.sha, merge_method: 'merge' }, 'PUT');
    if (!result.merged) throw new Error(`${label}: ${result.message}`);
    log(`${label}: merged`);
  }
}

async function main() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('Set GH_TOKEN to a GitHub token for jokedud/Openbar');
  const api = async (path, body, method = 'GET') => {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || result.errors?.length) {
      throw new Error(`${method} ${path}: ${response.status} ${result.message || result.errors?.[0]?.message || response.statusText}`);
    }
    return result;
  };
  const merge = process.argv.slice(2).includes('--merge');
  console.log(merge ? 'SWF auto-merge' : 'SWF auto-merge dry run');
  await scan(api, { merge });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { scan };
