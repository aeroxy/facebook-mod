# Facebook Mod

A Chrome extension that automates Facebook group moderation by detecting double-posters and suspending them. Built with [WXT](https://wxt.dev) + React 19 + Tailwind CSS v4.

## How It Works

The extension walks each pending post one-by-one, opens the member's profile, checks for existing approved posts (evidence of double-posting), and — if found — suspends the member for 28 days with reason "One post only" and declines their pending post.

## Quick Start

```bash
bun install
bun run build    # Build for production
bun run dev      # Dev mode with HMR
```

Load the `chrome-mv3` folder inside `.output/` from `chrome://extensions` (Developer mode).

## Usage

1. Open the side panel (click the Shield icon in the Chrome toolbar).
2. Enter the **Group ID** (the slug or numeric ID from your group's URL, e.g. `bayareahouse` or `500939864138258`).
3. (Optional) Give it a friendly name and click **Save Group Configuration**.
4. Click **Start Auto-Moderation**.
5. The extension opens (or refreshes) the group's Pending Posts page and begins processing each profile one-by-one.

## Architecture

```
sidepanel (App.tsx)
  └── Start/Stop, stats, live log console
       │
       ▼ sendMessage
background.ts (service worker)
  └── Orchestrator — one profile at a time
       │
       ├──► pending-posts.content.ts
       │   └── Scans cards, sends next profile URL,
       │       declines post after suspension
       │
       └──► profile-checker.content.ts
           └── Opens profile, checks for existing posts,
               triggers suspension workflow
```

### Key Design Decisions

- **Lockstep**: one profile processed at a time. No queues, no pre-fetching.
- **Active tabs**: profile-checker tabs open as active to prevent Chrome from lazy-loading content scripts.
- **End-of-list detection**: scroll height comparison with retry logic to definitively detect the bottom of the pending posts page.
- **URL sanitization**: compares `origin + pathname` only, ignoring Facebook's tracking parameters.

## Suspension Workflow

When double-posting is detected, the extension:

1. Opens the member's **Profile settings menu** (`aria-label="Profile settings see more options"`)
2. Selects **Suspend** from the dropdown (skips if **Unsuspend** is visible — user already suspended)
3. Chooses **28 Days** as the duration
4. Clicks the intermediate **Suspend** button
5. Checks **One post only** violation reason
6. Clicks **Done** to finalize
7. Scrolls their pending post card into view and clicks the interactive **Decline** button (`div.x1i10hfl`)

## Permissions

- `sidePanel` — extension side panel UI
- `storage` — persist group config and stats
- `activeTab` — interact with Facebook tabs
- `tabs` — open/close/query tabs
- `scripting` — inject content scripts on demand

## Development

```bash
bun run dev      # Dev with HMR
bun run build    # Production build
bun run zip      # Package for store submission
```

Built files go to `.output/chrome-mv3/`.

## Tech Stack

| Layer | Library |
|---|---|
| Framework | [WXT](https://wxt.dev) v0.20 |
| UI | React 19 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Build | Vite 6 |

## Known Limitations

- **English-only UI detection**: the already-suspended check looks for the string "Unsuspend". Facebook in other languages will need the corresponding translation added.
- **Required pending list state**: the group must have pending posts visible for the scraper to work.
