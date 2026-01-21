# reviewus

A CLI tool that fetches PRs awaiting your review every 5 minutes and displays them in a formatted, colorized view.

## Requirements

- [Bun](https://bun.sh/) - JavaScript/TypeScript runtime
- [GitHub CLI (`gh`)](https://cli.github.com/) - Required for GitHub integration

## Setup

1. Authenticate with GitHub CLI:
```bash
gh auth login
```

2. Install dependencies (if needed):
```bash
bun install
```

## Usage

Start the tool with:

```bash
bun run start
```

Or run directly:

```bash
bun run src/index.ts
```

Press `q` to exit.

## Keyboard Shortcuts

| Key | Action |
|------|------|
| `j` | Move cursor down |
| `k` | Move cursor up |
| `Enter` | Open selected PR in browser |
| `p` | Mark/unmark selected PR |
| `o` | Open all marked PRs in browser |
| `r` | Refresh PR list |
| `q` | Exit |

## Display Content

- List of open PRs where you are requested as a reviewer (excludes draft PRs)
- PRs are grouped by repository and sorted by update time (newest first)
- Each PR displays the following information with color coding:
  - Repository name (cyan)
  - PR title (yellow, highlighted when selected)
  - Author name and update time (dim gray)
  - PR URL (blue)
  - Marked PRs show a green ● indicator
- Auto-refreshes every 5 minutes
- Shows "● Loading..." in yellow while fetching data

## Display Example

```
=== PRs Awaiting Review (2) === 2026-01-21 15:30:00
j:down k:up Enter:open p:mark o:open marked r:refresh q:quit

owner/repo-name
● Fix authentication bug        ← marked and selected
    @john-doe | 2026-01-21 14:00
    https://github.com/owner/repo-name/pull/123
  Add new feature
    @jane-doe | 2026-01-21 10:00
    https://github.com/owner/repo-name/pull/120

Next auto-refresh: 2026-01-21 15:35
```

## License

CC0-1.0
