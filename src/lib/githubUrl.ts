// GitHub repo URL check shared by the Code UI and the browser mock (no imports: safe from cycles).
const GITHUB_HTTPS = /^https:\/\/(www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(\.git)?\/?$/;
const GITHUB_SSH = /^git@github\.com:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(\.git)?$/;

/** Client-side mirror of code.rs parse_github_url (the backend re-validates). */
export function parseGithubUrl(input: string): { owner: string; repo: string } | null {
  const s = input.trim();
  const m = GITHUB_HTTPS.exec(s);
  const [owner, repo] = m ? [m[2], m[3]] : (GITHUB_SSH.exec(s) ?? []).slice(1, 3);
  if (!owner || !repo || repo === "." || repo === ".." || repo.startsWith("-")) return null;
  return { owner, repo };
}
