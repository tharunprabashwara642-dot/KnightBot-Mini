/**
 * GitHub API Client — read access + SAFE write access.
 *
 * Safety design (intentional):
 *   - Never pushes directly to the default branch (main/master).
 *   - Never deletes a repository, and never deletes files.
 *   - Every code change goes: new branch -> commit file(s) -> Pull Request.
 *     A human (the bot owner) must review and merge on GitHub themselves.
 *   - Token is read ONLY from the GITHUB_TOKEN env var — never store it
 *     in config.js or anywhere in the repo.
 *
 * Required GitHub token scope: "repo" (Contents: Read and write,
 * Pull requests: Read and write). Do NOT grant "Delete repositories".
 * Create it at: https://github.com/settings/tokens
 */

const axios = require('axios');

const API_BASE = 'https://api.github.com';

function getToken() {
  return (process.env.GITHUB_TOKEN || '').trim();
}

function hasToken() {
  return !!getToken();
}

function client() {
  const token = getToken();
  if (!token) {
    throw new Error('No GitHub token configured. Set GITHUB_TOKEN as an environment variable.');
  }
  return axios.create({
    baseURL: API_BASE,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'KnightBot-Mini-Agent',
    },
    timeout: 30000,
  });
}

/** List repositories the token's owner has access to. */
async function listRepos() {
  const api = client();
  const { data } = await api.get('/user/repos', { params: { per_page: 50, sort: 'updated' } });
  return data.map((r) => ({
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    updatedAt: r.updated_at,
    url: r.html_url,
  }));
}

/** List open issues for a repo. */
async function listIssues(owner, repo) {
  const api = client();
  const { data } = await api.get(`/repos/${owner}/${repo}/issues`, { params: { state: 'open', per_page: 20 } });
  return data
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, title: i.title, url: i.html_url, body: i.body }));
}

/** Get repo default branch. */
async function getDefaultBranch(owner, repo) {
  const api = client();
  const { data } = await api.get(`/repos/${owner}/${repo}`);
  return data.default_branch;
}

/** Recursively list all file paths in a branch (for giving Gemini context). */
async function listFileTree(owner, repo, branch) {
  const api = client();
  const { data } = await api.get(`/repos/${owner}/${repo}/git/trees/${branch}`, { params: { recursive: 1 } });
  return (data.tree || [])
    .filter((entry) => entry.type === 'blob')
    .map((entry) => entry.path);
}

/** Get a single file's content (decoded) and its sha (needed to update it). */
async function getFile(owner, repo, filePath, branch) {
  const api = client();
  const { data } = await api.get(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, {
    params: { ref: branch },
  });
  if (Array.isArray(data)) throw new Error(`${filePath} is a directory, not a file`);
  const content = Buffer.from(data.content, data.encoding || 'base64').toString('utf8');
  return { content, sha: data.sha };
}

/** Create a new branch pointing at the tip of `fromBranch`. Returns the new branch name. */
async function createBranch(owner, repo, newBranch, fromBranch) {
  const api = client();
  const { data: ref } = await api.get(`/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`);
  const sha = ref.object.sha;
  await api.post(`/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${newBranch}`,
    sha,
  });
  return newBranch;
}

/**
 * Create or update a single file on a branch (one commit).
 * Pass `sha` (from getFile) when updating an existing file; omit for a new file.
 */
async function commitFile(owner, repo, filePath, content, message, branch, sha) {
  const api = client();
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;
  await api.put(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, body);
}

/** Open a Pull Request from `head` branch into `base` branch. Returns the PR URL. */
async function createPullRequest(owner, repo, title, head, base, body) {
  const api = client();
  const { data } = await api.post(`/repos/${owner}/${repo}/pulls`, { title, head, base, body });
  return data.html_url;
}

module.exports = {
  hasToken,
  listRepos,
  listIssues,
  getDefaultBranch,
  listFileTree,
  getFile,
  createBranch,
  commitFile,
  createPullRequest,
};
