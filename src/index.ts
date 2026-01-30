#!/usr/bin/env bun

type ReviewReason = "review-requested" | "updated";

interface PullRequest {
  repository: {
    nameWithOwner: string;
  };
  title: string;
  url: string;
  author: {
    login: string;
  };
  createdAt: string;
  updatedAt: string;
  reason: ReviewReason;
  commits?: {
    nodes: Array<{
      commit: {
        committedDate: string;
      };
    }>;
  };
  comments?: {
    nodes: Array<{
      author: {
        login: string;
      };
      createdAt: string;
    }>;
  };
  reviews?: {
    nodes: Array<{
      author: {
        login: string;
      };
      submittedAt: string;
    }>;
  };
}

interface GraphQLResponse {
  data: {
    viewer: {
      login: string;
    };
    reviewRequested: {
      edges: Array<{
        node: PullRequest;
      }>;
    };
    interacted: {
      edges: Array<{
        node: PullRequest;
      }>;
    };
  };
}

const ANSI = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  reverse: "\x1b[7m",
  green: "\x1b[32m",
};

// State
let prs: PullRequest[] = [];
let cursorIndex = 0;
let markedUrls = new Set<string>();
let lastFetchTime: Date | null = null;
let isLoading = false;

async function fetchReviewRequests(): Promise<PullRequest[]> {
  const query = `
    query {
      viewer {
        login
      }
      reviewRequested: search(query: "type:pr state:open review-requested:@me draft:false", type: ISSUE, first: 100) {
        edges {
          node {
            ... on PullRequest {
              repository {
                nameWithOwner
              }
              title
              url
              author {
                login
              }
              createdAt
              updatedAt
            }
          }
        }
      }
      interacted: search(query: "type:pr state:open involves:@me -author:@me draft:false", type: ISSUE, first: 100) {
        edges {
          node {
            ... on PullRequest {
              repository {
                nameWithOwner
              }
              title
              url
              author {
                login
              }
              createdAt
              updatedAt
              commits(last: 1) {
                nodes {
                  commit {
                    committedDate
                  }
                }
              }
              comments(last: 100) {
                nodes {
                  author {
                    login
                  }
                  createdAt
                }
              }
              reviews(last: 100) {
                nodes {
                  author {
                    login
                  }
                  submittedAt
                }
              }
            }
          }
        }
      }
    }
  `;

  const proc = Bun.spawn(["gh", "api", "graphql", "-f", `query=${query}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(`gh api failed: ${error}`);
  }

  const response: GraphQLResponse = JSON.parse(output);
  const viewerLogin = response.data.viewer.login;

  // Process review-requested PRs
  const reviewRequestedPrs = response.data.reviewRequested.edges.map(
    (edge) =>
      ({
        ...edge.node,
        reason: "review-requested",
      }) satisfies PullRequest,
  );

  // Process interacted PRs (commented or reviewed)
  const interactedPrs = response.data.interacted.edges.map((edge) => edge.node);

  // Filter PRs with new commits since last comment/review
  const filteredInteracted: PullRequest[] = [];
  for (const pr of interactedPrs) {
    // Get latest commit date
    const latestCommitDate = pr.commits?.nodes[0]?.commit.committedDate;
    if (!latestCommitDate) continue;

    // Get latest interaction date (comment or review)
    const latestInteractionDate = (() => {
      const myComments =
        pr.comments?.nodes.filter((c) => c.author.login === viewerLogin) || [];
      const latestCommentDate = myComments.at(-1)?.createdAt ?? null;

      const myReviews =
        pr.reviews?.nodes.filter((r) => r.author.login === viewerLogin) || [];
      const latestReviewDate = myReviews.at(-1)?.submittedAt ?? null;

      const dates = [latestCommentDate, latestReviewDate].filter(
        (d) => d !== null,
      );
      if (dates.length === 0) return null;

      return dates.reduce((latest, current) =>
        current > latest ? current : latest,
      );
    })();

    if (latestInteractionDate === null) continue;

    // Check if there are new commits since last interaction
    if (latestCommitDate > latestInteractionDate) {
      filteredInteracted.push({
        ...pr,
        reason: "updated",
      });
    }
  }

  // Merge all PRs, deduplicating by URL (review-requested takes priority)
  const finalMap = new Map<string, PullRequest>();
  for (const pr of filteredInteracted) {
    finalMap.set(pr.url, pr);
  }
  for (const pr of reviewRequestedPrs) {
    finalMap.set(pr.url, pr);
  }

  return Array.from(finalMap.values());
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function getSortedAndGroupedPrs(): { repo: string; prs: PullRequest[] }[] {
  const sorted = [...prs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const grouped = new Map<string, PullRequest[]>();
  for (const pr of sorted) {
    const repo = pr.repository.nameWithOwner;
    if (!grouped.has(repo)) {
      grouped.set(repo, []);
    }
    grouped.get(repo)!.push(pr);
  }

  return Array.from(grouped.entries()).map(([repo, prs]) => ({ repo, prs }));
}

function getFlatPrList(): PullRequest[] {
  const groups = getSortedAndGroupedPrs();
  return groups.flatMap((g) => g.prs);
}

function render(): void {
  const now = new Date();
  const timestamp = formatDateTime(now.toISOString());

  let output = `\n=== PRs To Review (${prs.length}) === ${timestamp}\n`;
  output += `${ANSI.dim}↑/k:up ↓/j:down Enter:open p:mark o:open marked r:refresh q:quit${ANSI.reset}\n`;

  if (prs.length === 0) {
    output += "\nNo PRs to review\n";
  } else {
    const groups = getSortedAndGroupedPrs();
    let globalIndex = 0;

    for (const { repo, prs: repoPrs } of groups) {
      output += `\n${ANSI.cyan}${repo}${ANSI.reset}\n`;
      for (const pr of repoPrs) {
        const isSelected = globalIndex === cursorIndex;
        const isMarked = markedUrls.has(pr.url);
        const marker = isMarked ? `${ANSI.green}●${ANSI.reset} ` : "  ";
        const selector = isSelected ? `${ANSI.reverse}` : "";
        const selectorEnd = isSelected ? `${ANSI.reset}` : "";

        const reasonTag =
          pr.reason === "review-requested"
            ? `${ANSI.yellow}[review requested]${ANSI.reset}`
            : `${ANSI.dim}[new commits]${ANSI.reset}`;

        output += `${marker}${selector}${pr.title}${selectorEnd} ${reasonTag}\n`;
        output += `    ${ANSI.dim}@${pr.author.login} | ${formatDateTime(pr.updatedAt)}${ANSI.reset}\n`;
        output += `    ${ANSI.blue}${pr.url}${ANSI.reset}\n`;
        globalIndex++;
      }
    }
  }

  output += "\n";
  if (isLoading) {
    output += `${ANSI.yellow}● Loading...${ANSI.reset}\n`;
  } else if (lastFetchTime) {
    const nextFetch = new Date(lastFetchTime.getTime() + 5 * 60 * 1000);
    output += `Next auto-refresh: ${formatDateTime(nextFetch.toISOString())}\n`;
  } else {
    output += "\n"; // 初期状態でも1行確保してレイアウトを安定させる
  }

  console.clear();
  process.stdout.write(output);
}

async function openUrl(url: string): Promise<void> {
  const proc = Bun.spawn(["open", url], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

async function handleKeypress(key: string): Promise<boolean> {
  const flatList = getFlatPrList();

  switch (key) {
    case "j":
    case "\x1b[B": // Down arrow
      if (flatList.length > 0) {
        cursorIndex = Math.min(cursorIndex + 1, flatList.length - 1);
        render();
      }
      break;
    case "k":
    case "\x1b[A": // Up arrow
      if (flatList.length > 0) {
        cursorIndex = Math.max(cursorIndex - 1, 0);
        render();
      }
      break;
    case "\r": // Enter
      if (flatList.length > 0 && cursorIndex < flatList.length) {
        await openUrl(flatList[cursorIndex].url);
      }
      break;
    case "p":
      if (flatList.length > 0 && cursorIndex < flatList.length) {
        const url = flatList[cursorIndex].url;
        if (markedUrls.has(url)) {
          markedUrls.delete(url);
        } else {
          markedUrls.add(url);
        }
        cursorIndex = Math.min(cursorIndex + 1, flatList.length - 1);
        render();
      }
      break;
    case "o":
      for (const url of markedUrls) {
        await openUrl(url);
      }
      markedUrls.clear();
      render();
      break;
    case "r":
      await refreshData();
      break;
    case "q":
    case "\x03": // Ctrl+C
      return false;
  }
  return true;
}

async function refreshData(): Promise<void> {
  isLoading = true;
  render();
  try {
    prs = await fetchReviewRequests();
    lastFetchTime = new Date();
    const flatList = getFlatPrList();
    if (cursorIndex >= flatList.length) {
      cursorIndex = Math.max(0, flatList.length - 1);
    }
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    isLoading = false;
    render();
  }
}

async function main() {
  console.log("Starting PR Review Watcher...\n");

  // Initial fetch
  await refreshData();

  // Set up stdin for raw mode
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  // Set up refresh interval
  const refreshInterval = setInterval(refreshData, 5 * 60 * 1000);

  // Handle keypress
  process.stdin.on("data", async (key: string) => {
    const shouldContinue = await handleKeypress(key);
    if (!shouldContinue) {
      clearInterval(refreshInterval);
      process.stdin.setRawMode(false);
      console.clear();
      console.log("PR Review Watcher exited.");
      process.exit(0);
    }
  });
}

main();
