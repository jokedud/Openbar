'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { scan } = require('./swf-auto-merge');

function fixture() {
  const repo = '/repos/jokedud/Openbar';
  const sha = 'head-sha';
  const pr = {
    number: 1, state: 'open', draft: false, title: 'SWF(feat): a feature',
    user: { login: 'jokedud', id: 156004109 }, base: { ref: 'main' },
    head: { sha, ref: 'feature', repo: { full_name: 'jokedud/Openbar' } },
    mergeable_state: 'clean',
  };
  const statuses = [{ context: 'Devin Review', state: 'success', creator: { login: 'devin-ai-integration[bot]' } }];
  const checks = [{
    name: 'windows', app: { slug: 'github-actions' }, check_suite: { id: 4 }, status: 'completed', conclusion: 'success',
  }];
  const build = { check_suite_id: 4, conclusion: 'success' };
  const pageInfo = { hasNextPage: false, endCursor: null };
  const review = {
    state: 'OPEN', headRefOid: sha, mergeStateStatus: 'CLEAN', reviewDecision: null,
    reviewThreads: { nodes: [{ isResolved: true }], pageInfo },
    latestOpinionatedReviews: { nodes: [{ state: 'APPROVED' }], pageInfo },
  };
  const current = structuredClone(pr);
  const comparison = { behind_by: 0 };
  const writes = [];
  const output = [];
  const queries = [];
  const api = async (path, body, method) => {
    switch (path.split('?')[0]) {
      case `${repo}/pulls`: return [pr];
      case `${repo}/commits/${sha}/statuses`: return statuses;
      case `${repo}/commits/${sha}/check-runs`: return { check_runs: checks };
      case `${repo}/actions/workflows/build.yml/runs`: return { workflow_runs: [build] };
      case '/graphql': {
        assert.equal(method, 'POST');
        queries.push(body.variables);
        const result = structuredClone(review);
        if (body.variables.threads === 'next') result.reviewThreads = { nodes: [{ isResolved: false }], pageInfo };
        return { data: { repository: { pullRequest: result } } };
      }
      case `${repo}/pulls/1`: return current;
      case `${repo}/compare/main...${sha}`: return comparison;
      case `${repo}/pulls/1/merge`:
        assert.equal(method, 'PUT');
        writes.push(body);
        return { merged: true };
      default: assert.fail(`Unexpected request: ${path}`);
    }
  };
  return { pr, statuses, checks, build, review, current, comparison, writes, output, queries,
    run: (merge) => scan(api, { merge, log: (line) => output.push(line) }) };
}

test('a ready PR is written only in merge mode, pinned to the checked SHA', async () => {
  const f = fixture();
  f.checks.push({ name: 'optional', status: 'completed', conclusion: 'skipped' });
  f.statuses.push({ ...f.statuses[0], state: 'pending' });
  await f.run();
  assert.deepEqual(f.output, ['#1: would merge']);
  assert.deepEqual(f.writes, []);
  await f.run(true);
  assert.deepEqual(f.writes, [{ sha: 'head-sha', merge_method: 'merge' }]);
  assert.equal(f.output.at(-1), '#1: merged');
});

for (const [reason, alter] of [
  ['not eligible', (f) => { f.pr.title = 'A manual PR'; }],
  ['not eligible', (f) => { f.pr.user.id = 2; }],
  ['not eligible', (f) => { f.pr.base.ref = 'release'; }],
  ['not eligible', (f) => { f.pr.head.repo.full_name = 'contributor/Openbar'; }],
  ['not eligible', (f) => { f.pr.draft = true; }],
  ['waiting — Devin Review has not passed', (f) => { f.statuses[0].state = 'pending'; }],
  ['waiting — Devin Review has not passed', (f) => { f.statuses[0].creator.login = 'someone-else'; }],
  ['waiting — Windows CI has not passed', (f) => { f.build.check_suite_id = 8; }],
  ['waiting — check other CI is in_progress', (f) => { f.checks.push({ name: 'other CI', status: 'in_progress' }); }],
  ['waiting — status other CI is failure', (f) => { f.statuses.push({ context: 'other CI', state: 'failure' }); }],
  ['waiting — changes requested', (f) => { f.review.latestOpinionatedReviews.nodes[0].state = 'CHANGES_REQUESTED'; }],
  ['waiting — unresolved review threads', (f) => { f.review.reviewThreads.nodes[0].isResolved = false; }],
  ['waiting — merge state is DIRTY', (f) => { f.review.mergeStateStatus = 'DIRTY'; }],
  ['waiting — behind main', (f) => { f.comparison.behind_by = 1; }],
  ['eligibility or merge state changed during the scan', (f) => { f.current.head.sha = 'new-sha'; }],
  ['eligibility or merge state changed during the scan', (f) => { f.current.title = 'A manual PR'; }],
]) {
  test(`no merge when ${reason}`, async () => {
    const f = fixture();
    alter(f);
    await f.run(true);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.output, [`#1: ${reason}`]);
  });
}

test('unresolved review threads on later pages block the merge', async () => {
  const f = fixture();
  f.review.reviewThreads.pageInfo = { hasNextPage: true, endCursor: 'next' };
  await f.run(true);
  assert.deepEqual(f.queries.map(({ threads }) => threads), [null, 'next']);
  assert.deepEqual(f.output, ['#1: waiting — unresolved review threads']);
  assert.deepEqual(f.writes, []);
});
