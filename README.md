# Granny Co-op
Multiplayer escape-the-granny game. Node + Express + WebSocket (server-authoritative), HTML5 canvas client.

## Run locally
    npm install
    npm start        # http://localhost:3000

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render > New > Web Service > pick the repo (render.yaml is auto-detected).
3. Build: `npm install`, Start: `node server.js`. WebSockets work out of the box.
Free instances sleep after inactivity, so the first load can take ~30s.

## Controls
WASD/Arrows move, Shift sprint (noisy), E hide in wardrobe / hold near downed friend to revive. Touch controls on mobile.
Share a room with `?room=CODE` in the URL.
