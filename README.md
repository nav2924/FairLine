# FairLine (No-Blockchain Demo)

A fair, resilient, real-time digital queue demo with Proof‑of‑Wait (PoW), FIFO/priority buckets, WebSocket updates, admin throttling, and transparent JSONL event logs.
No blockchain code is included in this build.

## Structure
```
fairline/
├── client/
│   ├── index.html            # React (CDN) + Tailwind + Socket.io client
│   └── admin.html            # Simple admin dashboard (browser-only)
│
└── server/
    ├── server.js             # Express + Socket.io + Queue engine
    ├── queueEngine.js        # Queue logic: buckets, pacing, fairness
    ├── logger.js             # JSONL event logger
    ├── middleware/
    │   └── verifyToken.js    # JWT verification helpers
    ├── utils/
    │   └── pow.js            # Hashcash-like PoW verification
    ├── package.json          # Dependencies (no node_modules included)
    └── .env.example          # Copy to .env and fill secrets
```

## Quick Start

1) **Server**
```bash
cd server
cp .env.example .env   # edit values
npm install
npm start
```
Server starts on `http://localhost:4000`.

2) **Client**
Open `client/index.html` in a browser (or serve statically).
It expects the server at `http://localhost:4000`.
You can also open `client/admin.html` for throttling and stats.

## Features included
- Proof‑of‑Wait: client fetches a challenge and solves a small hash puzzle; server verifies.
- Token-based queue identity (JWT).
- FIFO with bucket budgets (e.g., `vip` ≤ 20% of admits).
- Real-time updates via Socket.io.
- Offline resume by reusing the queue token.
- Admin throttle endpoint to change admit rate on the fly.
- JSONL event logs for transparency in `server/logs/queue-events.jsonl`.

## Notes
- This demo keeps in-memory queues by default (Redis/Kafka can be added later).
- For a realistic demo, keep PoW difficulty small (default 3 hex zeros). Increase for load tests.
- No blockchain/components are shipped here.
