import { describe, expect, it } from "vitest";
import { parseGithubUrl } from "./githubUrl";

describe("parseGithubUrl (mirror of code.rs parse_github_url)", () => {
  it("accepts https and ssh repo URLs", () => {
    expect(parseGithubUrl("https://github.com/octocat/Hello-World")).toEqual({ owner: "octocat", repo: "Hello-World" });
    expect(parseGithubUrl(" https://github.com/a/b.git/ ")).toEqual({ owner: "a", repo: "b" });
    expect(parseGithubUrl("https://github.com/a/my.repo_x")).toEqual({ owner: "a", repo: "my.repo_x" });
    expect(parseGithubUrl("git@github.com:owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("rejects everything else", () => {
    for (const bad of [
      "",
      "github.com/a/b",
      "http://github.com/a/b",
      "https://gitlab.com/a/b",
      "https://github.com/a",
      "https://github.com/a/b/tree/main",
      "https://github.com/a/..",
      "https://github.com/-a/b",
      "https://github.com/a/b;rm -rf ~",
      "https://github.com/a/$(whoami)",
      "https://github.com.evil.com/a/b",
      "git@github.com:a/b c.git",
    ])
      expect(parseGithubUrl(bad), bad).toBeNull();
  });
});
