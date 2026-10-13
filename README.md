# Pebble Isle Rally (online version)

A cartoon open-world drift and racing game that anyone can play in the browser. There are no accounts: players just pick a username. Each player's money, XP, car collection (with every car's own parts and upgrades), businesses and homes are saved in their own browser. The small game server shares live car positions, starts races between players, keeps the lap records board and runs the car market where players sell cars to each other.

## In the game

- It is always night, with a 90s film-grain look and a Japanese-style island, city and mountain pass.
- Underground street races: drive onto a pink MEET pad in the city, on the coast road or up the touge to race the local crew for cash, or challenge other players at the meet (winner takes the pot).

- Drift, race other players and take on missions across the island, the city, farm roads and the mountain pass.
- Press F to get out of your car and walk. Walk into Pebble Motors in Pebble City to look at the cars on their turntables and buy one.
- Buy businesses and upgrade them. Legit ones (car wash, taxi company, tuning shop) pay you automatically, even while you're offline. Shady ones (grow shed, chop shop, Fizz lab) fill up with stock that you drive to buyers, with the police on your tail if someone tips them off.
- Buy homes. They work as garages and fast travel spots, and you start at the one you set as home.
- Press T to chat with everyone on the island and C to switch between first and third person. Usernames and chat go through a word filter (German and English) in the game and again on the server.

## What's in here

- `public/index.html` is the whole game in one page.
- `server.js` serves the page and runs multiplayer and the car market over a WebSocket at `/ws`.
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
- The lap records and the car market are kept in `data.json` on the server, and free hosting doesn't keep files. They reset whenever the server restarts or you upload a new version. Cars that were up for sale go back to their sellers the next time they play. A sale whose seller hasn't been online since can lose its coins in a reset. Player saves are not affected, because they live in each player's browser.

Railway, Fly.io and any other host that runs Node work the same way: run `npm install`, then `npm start`. The server listens on the `PORT` the host gives it.

## Settings

| Environment variable | Default | What it does |
|---|---|---|
| `PORT` | 3000 | Port to listen on |
| `MAX_PLAYERS` | 40 | Players on the island at once |
| `DATA_FILE` | `data.json` | Where lap records and market listings are stored |

## Good to know

- Saves live in each browser. Clearing browser data or switching device starts a player fresh.
- The redeem code works once per browser. Anyone who has it can use it.
- Each browser gets a secret key the first time it connects, so nobody else can take back or collect payment for its market listings.
- Only lap records and market trades are checked by the server. Money and XP live in the player's browser, so a determined player could edit their own save. That's fine for a game among friends.

## Sound credits

The car sounds come from [Bungee Engine Audio](https://github.com/leonmaniora/bungee-engine-audio) by Leon (MIT License). They are built into `public/index.html`. See `SOUNDS-LICENSE.txt`.
