// FRAG-like Shooter — Deploy-Ready (CommonJS) for Pterodactyl
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*"} });

// --- Config ---
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// --- Static files ---
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Simple persistence (JSON) for demo login/profile ---
const DB_PATH = path.join(__dirname, "data.json");
let db = { users: {}, sessions: {} }; // users[username] = { passHash, profile }
try {
  if (fs.existsSync(DB_PATH)) db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
} catch (e) {
  console.error("Failed to read DB:", e);
}
function saveDB() {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch(e){ console.error("Failed to save DB:", e); }
}
function defaultProfile(name){
  return { name, coins: 300, ownedHeroes: ["striker"], ownedSkins: ["classic"], selectedHero: "striker", selectedSkin: "classic" };
}
function token(){ return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }

// --- REST: login/signup/save/profile ---
app.post("/api/signup", (req,res)=>{
  const { username, passHash } = req.body || {};
  if (!username || !passHash) return res.status(400).json({ error: "username & passHash required" });
  if (db.users[username]) return res.status(409).json({ error: "username exists" });
  db.users[username] = { passHash, profile: defaultProfile(username) };
  const t = token(); db.sessions[t] = username; saveDB();
  res.json({ token: t, profile: db.users[username].profile });
});
app.post("/api/login", (req,res)=>{
  const { username, passHash } = req.body || {};
  const u = db.users[username];
  if (!u || u.passHash !== passHash) return res.status(401).json({ error: "invalid credentials" });
  const t = token(); db.sessions[t] = username; saveDB();
  res.json({ token: t, profile: u.profile });
});
app.get("/api/profile", (req,res)=>{
  const t = req.query.token;
  const u = db.sessions[t]; if (!u) return res.status(401).json({ error: "invalid token" });
  res.json({ profile: db.users[u].profile });
});
app.post("/api/save", (req,res)=>{
  const { token: t, profile } = req.body || {};
  const u = db.sessions[t]; if (!u) return res.status(401).json({ error: "invalid token" });
  db.users[u].profile = { ...db.users[u].profile, ...profile, name: u };
  saveDB();
  res.json({ ok: true });
});

// --- Game state (authoritative) ---
const TICK = 1000/60;
const ARENA = { w: 2400, h: 1400 };
const HEROES = {
  striker: { speed: 300, maxHp: 100, fireRate: 140, bulletSpeed: 720, dmg: 18 },
  tank:    { speed: 220, maxHp: 170, fireRate: 240, bulletSpeed: 600, dmg: 24 },
  scout:   { speed: 360, maxHp: 80,  fireRate: 110, bulletSpeed: 800, dmg: 14 },
  sniper:  { speed: 280, maxHp: 90,  fireRate: 600, bulletSpeed: 1200,dmg: 60 }
};
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

const players = new Map(); // id -> player
const bullets = []; let nextBulletId = 1;

io.on("connection", (socket)=>{
  let player = null;

  socket.on("join", (data)=>{
    const name = String(data?.name || "Guest").slice(0,16);
    const heroKey = HEROES[data?.hero] ? data.hero : "striker";
    const skin = data?.skin || "classic";
    const color = data?.color || "#6d28d9";

    player = {
      id: socket.id,
      name, hero: heroKey, skin, color,
      x: Math.random()*ARENA.w, y: Math.random()*ARENA.h,
      vx:0, vy:0, angle:0, hp: HEROES[heroKey].maxHp, score: 0,
      lastFire: 0
    };
    players.set(socket.id, player);

    socket.emit("hello", { id: socket.id, arena: ARENA, heroes: HEROES });
    io.emit("join", netPlayer(player));
  });

  socket.on("input", (inp)=>{
    if (!player) return;
    const h = HEROES[player.hero];
    const ax = clamp(+inp.ax || 0, -1, 1), ay = clamp(+inp.ay || 0, -1, 1);
    player.vx = ax * h.speed; player.vy = ay * h.speed;
    if (typeof inp.angle === "number") player.angle = inp.angle;
  });

  socket.on("fire", ()=>{
    if (!player) return;
    const now = Date.now(), h=HEROES[player.hero];
    if (now - player.lastFire < h.fireRate) return;
    player.lastFire = now;
    const angle = player.angle || 0;
    const vx = Math.cos(angle) * h.bulletSpeed;
    const vy = Math.sin(angle) * h.bulletSpeed;
    bullets.push({ id: nextBulletId++, ownerId: player.id, x: player.x, y: player.y, vx, vy, dmg: h.dmg, ttl: 1200 });
    socket.broadcast.emit("shot", { ownerId: player.id, x: player.x, y: player.y, vx, vy });
  });

  socket.on("disconnect", ()=>{
    if (player){ players.delete(player.id); socket.broadcast.emit("leave", { id: player.id }); }
  });
});

setInterval(()=>{
  const dt = TICK/1000;
  // integrate players
  players.forEach(p=>{
    p.x = clamp(p.x + p.vx*dt, 0, ARENA.w);
    p.y = clamp(p.y + p.vy*dt, 0, ARENA.h);
  });

  // bullets
  for (let i=bullets.length-1;i>=0;i--){
    const b = bullets[i];
    b.x += b.vx*dt; b.y += b.vy*dt; b.ttl -= TICK;
    if (b.x<0 || b.x>ARENA.w || b.y<0 || b.y>ARENA.h || b.ttl<=0){ bullets.splice(i,1); continue; }
    // collision
    for (const [,p] of players){
      if (p.id === b.ownerId) continue;
      const dx = p.x - b.x, dy = p.y - b.y;
      if (dx*dx + dy*dy <= 22*22){
        p.hp -= b.dmg;
        if (p.hp <= 0){
          const killer = players.get(b.ownerId);
          if (killer) killer.score += 1;
          // respawn
          p.hp = HEROES[p.hero].maxHp;
          p.x = Math.random()*ARENA.w; p.y = Math.random()*ARENA.h;
          io.emit("frag", { killerId: b.ownerId, victimId: p.id });
        }
        bullets.splice(i,1);
        break;
      }
    }
  }

  // broadcast compact state
  io.emit("state", {
    players: Array.from(players.values()).map(netPlayer),
    bullets: bullets.map(b=>({id:b.id,x:b.x,y:b.y}))
  });
}, TICK);

function netPlayer(p){
  return { id:p.id, name:p.name, x:p.x, y:p.y, angle:p.angle, hp:p.hp, hero:p.hero, score:p.score, skin:p.skin, color:p.color };
}

server.listen(PORT, HOST, ()=>{
  console.log(`✅ Server running at http://${HOST}:${PORT}`);
  console.log(`👉 Make sure you open IP:PORT as shown by your Pterodactyl allocation.`);
});
