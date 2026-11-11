# Gridwalkers

Gridwalkers is a nonogram for one to four players. Solve a grid by walking over cells in Fill mode or marking them with your mouse. To play together, create a private room and share its six-character code.

**Play Solo** generates and runs a puzzle in your browser. It uses no room, WebSocket, or Redis connection. Solo progress lasts until you leave the game or reload.

Each puzzle starts with three lives. In multiplayer, the room shares them. Filling an empty cell or crossing a cell that needs a fill costs one life and leaves the cell as it was. Walk mode and clearing a mark cost no lives. Completed rows and columns automatically cross their remaining empty cells.

## Run locally

Install Node.js 24, npm, and Docker with Compose. A running Redis instance works in place of Docker.

```sh
docker compose up -d redis
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies the Socket.IO WebSocket at `/api/ws` to the Node server on port 3000. The dev command starts both processes. The default Redis endpoint is `redis://127.0.0.1:6379`. Copy `.env.example` to `.env` to override the connection, Redis namespace, or public application URL. Redis persists across local Node restarts.

Use separate browser profiles or private windows when testing different players. Tabs in the same browser profile share the saved room session.

| Control | Action |
| --- | --- |
| WASD or arrows | Move one tile, or hold to keep moving |
| Q | Switch between Walk and Fill |
| Left click | Toggle fill on a cell |
| Right click | Toggle a manual X on a cell |
| Drag or middle-mouse drag | Pan and pause camera follow |
| Center on Character | Recenter and resume camera follow |
| Esc | Close a dialog |

## Deployment and backend architecture

Deploy the repository as **one Vercel project**. Vercel serves the React/Vite build from `dist` and runs `api/ws.ts` as a Node.js Function with Fluid Compute and native WebSocket support. Socket.IO uses the WebSocket transport directly, so it needs no sticky routing for polling. The room invite rewrite serves the app for direct links such as `/room/ABC234`. [Vercel WebSockets](https://vercel.com/changelog/websocket-support-is-now-generally-available) · [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)

1. Import the repository into Vercel with the Vite preset, the repository root as the project root, and Node.js 24. The included `vercel.json` configures the build, function duration, and invite route.
2. Provision managed Redis from the Vercel Marketplace or your Redis provider. Choose a Redis region near your Vercel Function region. The application uses Redis commands and Pub/Sub over a TCP connection.
3. Configure the environment variables below in Vercel. Use a separate namespace or Redis database for previews. If preview Deployment Protection is enabled, invitees need access to that preview.
4. Deploy. Open the deployment URL, create a room, and open its invitation in a second browser profile. Verify cell updates in both profiles, then reload one profile to verify session restoration.

| Variable | Purpose |
| --- | --- |
| `REDIS_URL` | Server-only Redis connection URI. Use the provider's authenticated `rediss://` endpoint for deployment. |
| `REDIS_NAMESPACE` | Prefix to isolate deployments that share Redis. |
| `PUBLIC_APP_URL` | Public HTTPS origin used by the server's origin check. Same-origin deployment URLs are also accepted. |
| `GENERATION_CANDIDATES` | Candidate limit, default 1,600. |
| `GENERATION_OPERATIONS` | Solver operation limit, default 120 million. |
| `GENERATION_MS` | Solver wall-clock budget, default 4,500 ms. |

### Room state and recovery

- Redis holds the private puzzle, manual marks, derived line status, players, leases, settings, and game timestamps. Active room solutions stay on the server and are omitted by the public snapshot type and serializer.
- Each mutation reads the latest room, validates the authenticated socket session, and attempts a Lua compare-and-set. On contention it retries against the latest room. The Redis transaction commits the updated room and publishes the public update in order. Concurrent explicit writes to the same cell resolve in commit order.
- Clients reconcile optimistic clicks against the committed result. Motion and board patches carry a room version, and board patches also carry a monotonic revision. A version gap triggers a fresh snapshot. Heartbeats provide a version check even when the board is idle.
- An opaque random token is saved per room in the browser. Redis stores its digest and binds each identity to its current socket. A reconnect receives the current snapshot and restores its character and movement mode. Function duration limits can cause routine reconnects. [Vercel connection lifecycle](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- Heartbeats renew presence leases. A disconnected host retains host status for a 30-second grace period before the longest-connected eligible player takes over. If a Function terminates abruptly, lease expiry detects the disconnect first. Inactive room keys expire after about 15 minutes. A disconnected player's seat can be reused after the grace period when a room needs space.
- A generation job runs in a worker thread with candidate, time, operation, and memory limits. Its Redis job lease lets another instance recover the lobby if a Function terminates mid-generation. The Vercel build includes the worker bundle alongside the Function.

### Puzzle and rendering decisions

`shared/puzzle.ts` uses dynamic programming to find the forced values common to all valid line arrangements. It propagates deductions to a fixed point and scores the solution path using initial forced cells, propagation passes, and deduction depth. A separate bounded search counts solutions up to two. A generated puzzle must pass both solvers and match the requested difficulty. Solo runs this generator in a browser worker. Multiplayer runs it in a server worker and keeps multiplayer solutions on the server.

`shared/board.ts` keeps manual marks and derives automatic X marks from completed crossing lines. Removing a supporting fill reopens its line and withdraws only the crosses with no remaining source. A partial clue greys out when every compatible arrangement places that clue's filled run at the same bounded position.

`client` renders the board, pixel characters, and effects on Canvas. React handles the lobby, camera controls, focused clues, and dialogs. `shared` defines the public Socket.IO protocol.

### Known limits

- Generation can exhaust its budget, especially on unusual board sizes or Expert puzzles. Retrying uses a new random seed. A validated 5×5 Expert fallback is available. The room reports failure if no validated puzzle meets the requested settings.
- Redis Pub/Sub delivers live events without history. Clients repair missed events with an authoritative snapshot.
- The MVP targets desktop keyboard and mouse play. Rooms are temporary and depend on the availability and retention policy of your Redis provider.

## Verification

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Run the browser suite with Redis available and ports 3000 and 5173 free. Set `REDIS_URL` in the shell if using a custom Redis endpoint. Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Edge browser.

Set `RUN_REDIS_TESTS=1` and run `npm test` to include the integration test against two independent Socket.IO servers sharing Redis. The browser suite covers two independent browser sessions, invite joins, appearance changes, movement, Fill mode, mouse markings, reconnection, victory, and large-board camera controls. Test namespaces are isolated from normal rooms.
