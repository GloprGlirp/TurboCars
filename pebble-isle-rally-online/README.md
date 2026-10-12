# Pebble Isle Rally (online version)

A cartoon open-world drift and racing game that anyone can play in the browser. There are no accounts: players just pick a username. Each player's money, XP, cars and parts are saved in their own browser. The small game server shares live car positions, starts races between players and keeps the lap records board.

## What's in here

- `public/index.html` is the whole game in one page.
- `server.js` serves the page and runs multiplayer over a WebSocket at `/ws`.
- `package.json` needs Node 18 or newer and one package (`ws`).

## Try it on your own computer

```
npm install
npm start
```

Open http://localhost:3000. Friends on the same Wi-Fi can join at `http://YOUR-COMPUTER-IP:3000`.

## Put it online for free (Render)

1. Create a free GitHub account and a new repository, then upload everything in this folder **except** `node_modules`.
2. Sign up at https://render.com with your GitHub account.
3. Click **New → Web Service** and pick your repository.
4. Use these settings:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
5. Click **Create Web Service**. After a minute or two you get a link like `https://pebble-isle-rally.onrender.com`. Share that link and anyone can join.

Things to know about the free plan:

- After 15 minutes with nobody playing, the server goes to sleep. The next visitor waits about a minute while it wakes up.
- The lap records board is kept in a file on the server, and free hosting doesn't keep files. The board resets whenever the server restarts or you upload a new version. Player saves are not affected, because they live in each player's browser.

Railway, Fly.io and any other host that runs Node work the same way: run `npm install`, then `npm start`. The server listens on the `PORT` the host gives it.

## Settings

| Environment variable | Default | What it does |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `MAX_PLAYERS` | 40 | Players on the island at once |
| `RECORDS_FILE` | `records.json` | Where lap records are stored |

## Good to know

- Saves live in each browser. Clearing browser data or switching device starts a player fresh.
- The redeem code works once per browser. Anyone who has it can use it.
- Only the lap records are checked by the server. Money and XP live in the player's browser, so a determined player could edit their own save. That's fine for a game among friends.
