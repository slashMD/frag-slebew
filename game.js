// Client for FRAG-like Shooter
const $ = (q)=>document.querySelector(q);
const $$ = (q)=>document.querySelectorAll(q);
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const auth = $("#auth"), heroPanel = $("#heroPanel"), shopPanel = $("#shopPanel");
const coinsEl = $("#coins"), hudCoins = $("#hudCoins"), hpEl = $("#hp"), scoreEl = $("#score"), pingEl = $("#ping");
const btnLogin = $("#btnLogin"), btnGuest = $("#btnGuest"), authMsg = $("#authMsg");
const btnBackAuth = $("#btnBackAuth"), btnToShop = $("#btnToShop"), btnBackHero = $("#btnBackHero"), btnPlay = $("#btnPlay");
const heroesGrid = $("#heroes"), shopGrid = $("#shop");

const store = loadStore();
let socket = null;
const state = {
  me: null, players: {}, bullets: [], arena:{w:2400,h:1400}, heroes:{},
  input:{ax:0,ay:0,angle:0,firing:false},
  cam:{x:0,y:0,zoom:1},
  ping:0, lastPingAt:0
};

function loadStore(){
  try {
    const raw = localStorage.getItem("fragStoreV3");
    if (raw) return JSON.parse(raw);
  } catch {}
  const init = { user:null, token:null, coins:300, ownedHeroes:["striker"], ownedSkins:["classic"], selectedHero:"striker", selectedSkin:"classic" };
  localStorage.setItem("fragStoreV3", JSON.stringify(init));
  return init;
}
function saveStore(){ localStorage.setItem("fragStoreV3", JSON.stringify(store)); }
function hash(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))|0; return String(h); }

// Auth
btnLogin.onclick = async ()=>{
  const name = $("#username").value.trim() || "Player";
  const pass = $("#password").value.trim();
  if (!pass){ authMsg.textContent="Masukkan password atau pilih Guest"; return; }
  const passHash = hash(pass);
  let resp = await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:name, passHash})});
  if (resp.status===401) resp = await fetch("/api/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:name, passHash})});
  if (!resp.ok){ authMsg.textContent="Gagal login/signup"; return; }
  const data = await resp.json();
  store.user = { name }; store.token = data.token;
  Object.assign(store, data.profile); saveStore();
  openHeroes();
};
btnGuest.onclick = ()=>{ const name = $("#username").value.trim() || "Guest"; store.user = { name }; store.token = null; saveStore(); openHeroes(); };
btnBackAuth.onclick = ()=>{ heroPanel.classList.add("hidden"); auth.classList.remove("hidden"); };

function openHeroes(){
  auth.classList.add("hidden"); heroPanel.classList.remove("hidden");
  renderHeroes(); btnPlay.disabled = !store.selectedHero;
}

const HERO_DESCS = {
  striker:{n:"Striker",desc:"Serba bisa. DPS stabil.", c:"#60a5fa"},
  tank:{n:"Titan",desc:"HP tebal, tembakan berat.", c:"#f59e0b"},
  scout:{n:"Dash",desc:"Lari kencang, burst cepat.", c:"#34d399"},
  sniper:{n:"Viper",desc:"Jarak jauh, damage tinggi.", c:"#a78bfa"}
};
const SHOP = {
  heroes:[{key:"striker",price:0},{key:"tank",price:350},{key:"scout",price:280},{key:"sniper",price:500}],
  skins:[{key:"classic",price:0},{key:"neon",price:150},{key:"ember",price:150},{key:"ocean",price:150}]
};

function renderHeroes(){
  heroesGrid.innerHTML = "";
  Object.keys(HERO_DESCS).forEach(k=>{
    const m = HERO_DESCS[k];
    const card = document.createElement("div"); card.className="card";
    const avatar = document.createElement("div"); avatar.className="avatar";
    avatar.style.background = `linear-gradient(135deg, ${m.c}55, #ffffff11)`; avatar.textContent = m.n[0];
    const h3 = document.createElement("h3"); h3.textContent = m.n;
    const p = document.createElement("p"); p.textContent = m.desc;
    const row = document.createElement("div"); row.className="row";
    const pick = document.createElement("button"); pick.textContent="Pilih";
    pick.onclick = async ()=>{
      if (!store.ownedHeroes.includes(k)){ toast("Belum dimiliki. Beli di Shop."); return; }
      store.selectedHero = k; saveStore(); await saveProfile(); renderHeroes();
    };
    if (store.selectedHero === k) card.style.outline = "2px solid #4f46e5";
    row.appendChild(pick); card.append(avatar,h3,p,row); heroesGrid.appendChild(card);
  });
}
btnToShop.onclick = ()=>{ heroPanel.classList.add("hidden"); shopPanel.classList.remove("hidden"); renderShop(); };
btnBackHero.onclick = ()=>{ shopPanel.classList.add("hidden"); heroPanel.classList.remove("hidden"); renderHeroes(); };
btnPlay.onclick = ()=> startGame();

function renderShop(){
  coinsEl.textContent = store.coins; shopGrid.innerHTML = "";
  // heroes
  SHOP.heroes.forEach(it=>{
    const m = HERO_DESCS[it.key];
    const card = document.createElement("div"); card.className="card";
    card.innerHTML = `<div class="avatar" style="background:linear-gradient(135deg,${m.c}55,#fff1)">${m.n[0]}</div><h3>${m.n}</h3><p>${m.desc}</p>`;
    const row = document.createElement("div"); row.className="row";
    if (store.ownedHeroes.includes(it.key)){ const b=document.createElement("button"); b.className="ghost"; b.textContent="Dimiliki"; b.disabled=true; row.appendChild(b); }
    else { const b=document.createElement("button"); b.innerHTML=`Beli <span class="price">${it.price}</span>`; b.onclick=()=>buy("hero", it.key, it.price); row.appendChild(b); }
    card.appendChild(row); shopGrid.appendChild(card);
  });
  // skins
  SHOP.skins.forEach(it=>{
    const card = document.createElement("div"); card.className="card";
    const name = skinName(it.key);
    const preview = document.createElement("div"); preview.className="avatar"; preview.textContent="S"; preview.style.background = skinGrad(it.key);
    const h3 = document.createElement("h3"); h3.textContent = name;
    const p = document.createElement("p"); p.textContent = "Skin kosmetik";
    const row = document.createElement("div"); row.className="row";
    if (store.ownedSkins.includes(it.key)){ const b=document.createElement("button"); b.textContent="Pakai"; b.onclick=async()=>{ store.selectedSkin = it.key; saveStore(); await saveProfile(); toast("Skin dipakai: "+name); }; row.appendChild(b); }
    else { const b=document.createElement("button"); b.innerHTML=`Beli <span class="price">${it.price}</span>`; b.onclick=()=>buy("skin", it.key, it.price); row.appendChild(b); }
    card.append(preview,h3,p,row); shopGrid.appendChild(card);
  });
}
async function buy(type, key, price){
  if (store.coins < price) { toast("Koin kurang"); return; }
  store.coins -= price;
  if (type==="hero" && !store.ownedHeroes.includes(key)) store.ownedHeroes.push(key);
  if (type==="skin" && !store.ownedSkins.includes(key)) store.ownedSkins.push(key);
  saveStore(); await saveProfile();
  coinsEl.textContent = store.coins; hudCoins.textContent = store.coins; renderShop(); toast("Pembelian berhasil!");
}
function skinName(k){ return {classic:"Classic", neon:"Neon", ember:"Ember", ocean:"Ocean"}[k] || k; }
function skinGrad(k){
  switch(k){
    case "neon": return "linear-gradient(135deg,#00ffe055,#6ee7ff33)";
    case "ember": return "linear-gradient(135deg,#ff7a1855,#ff006633)";
    case "ocean": return "linear-gradient(135deg,#1e90ff55,#00e0ff33)";
    default: return "linear-gradient(135deg,#a7a7a722,#ffffff11)";
  }
}

async function saveProfile(){
  if (!store.token) return;
  const profile = { coins: store.coins, ownedHeroes: store.ownedHeroes, ownedSkins: store.ownedSkins, selectedHero: store.selectedHero, selectedSkin: store.selectedSkin };
  try { await fetch("/api/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ token: store.token, profile })}); } catch{}
}

// Game
function startGame(){
  heroPanel.classList.add("hidden"); shopPanel.classList.add("hidden");
  $("#hud").classList.remove("hidden");
  hudCoins.textContent = store.coins;

  canvas.style.display = "block";
  resize(); window.addEventListener("resize", resize);

  socket = io({ transports:["websocket","polling"] });
  socket.on("connect", ()=>{
    socket.emit("join", { name: store.user?.name || "Guest", hero: store.selectedHero || "striker", skin: store.selectedSkin || "classic" });
    pingSend();
  });
  socket.on("hello", (msg)=>{ state.me = msg.id; state.arena = msg.arena; state.heroes = msg.heroes; });
  socket.on("state", (msg)=>{
    state.players = {}; msg.players.forEach(p=> state.players[p.id]=p);
    state.bullets = msg.bullets;
    const me = state.players[state.me];
    if (me){ hpEl.textContent = me.hp; scoreEl.textContent = me.score; }
  });
  socket.on("frag", (e)=>{ if (e.killerId === state.me){ store.coins += 20; saveStore(); saveProfile(); hudCoins.textContent = store.coins; toast("+20 Koin!"); } });

  setupInputs();
  loop();
}

function setupInputs(){
  const keys = new Set();
  window.addEventListener("keydown", e=>{ keys.add(e.code); updateAxis(); });
  window.addEventListener("keyup", e=>{ keys.delete(e.code); updateAxis(); });
  function updateAxis(){
    state.input.ax = (keys.has("KeyD")||keys.has("ArrowRight")?1:0) + (keys.has("KeyA")||keys.has("ArrowLeft")?-1:0);
    state.input.ay = (keys.has("KeyS")||keys.has("ArrowDown")?1:0) + (keys.has("KeyW")||keys.has("ArrowUp")?-1:0);
  }
  canvas.addEventListener("mousemove", e=>{
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const me = state.players[state.me]; if (!me) return;
    const world = screenToWorld(mx,my);
    state.input.angle = Math.atan2(world.y - me.y, world.x - me.x);
  });
  canvas.addEventListener("mousedown", ()=> state.input.firing = true);
  window.addEventListener("mouseup", ()=> state.input.firing = false);
}

function sendInput(){
  if (!socket || socket.disconnected) return;
  socket.emit("input", { ax: state.input.ax, ay: state.input.ay, angle: state.input.angle });
  if (state.input.firing) socket.emit("fire");
}

function loop(){
  requestAnimationFrame(loop);
  draw(); sendInput();
}

function resize(){ canvas.width = innerWidth; canvas.height = innerHeight; }

function worldToScreen(x,y){ return { x:(x - state.cam.x)*state.cam.zoom + canvas.width/2, y:(y - state.cam.y)*state.cam.zoom + canvas.height/2 }; }
function screenToWorld(x,y){ return { x:(x - canvas.width/2)/state.cam.zoom + state.cam.x, y:(y - canvas.height/2)/state.cam.zoom + state.cam.y }; }

function draw(){
  const me = state.players[state.me];
  if (me){ state.cam.x = me.x; state.cam.y = me.y; }
  // bg
  const g = ctx.createLinearGradient(0,0,0,canvas.height);
  g.addColorStop(0,"#0d1430"); g.addColorStop(1,"#0a0e22");
  ctx.fillStyle = g; ctx.fillRect(0,0,canvas.width,canvas.height);
  drawGrid();

  // bullets
  for (const b of state.bullets){
    const s = worldToScreen(b.x,b.y);
    ctx.globalAlpha=.95; ctx.beginPath(); ctx.arc(s.x,s.y,3,0,Math.PI*2);
    ctx.fillStyle="#ffd166"; ctx.fill(); ctx.globalAlpha=1;
  }

  // players
  for (const id in state.players){
    const p = state.players[id];
    const s = worldToScreen(p.x,p.y);
    const maxHp = p.hero==="tank"?170: p.hero==="scout"?80: p.hero==="sniper"?90:100;
    const ratio = clamp(p.hp/maxHp,0,1);
    const col = skinColor(p.skin);

    ctx.save();
    ctx.translate(s.x,s.y); ctx.rotate(p.angle||0);
    const r=16;
    const grd=ctx.createLinearGradient(-r,-r,r,r);
    grd.addColorStop(0,col); grd.addColorStop(1,"#1b2551");
    ctx.fillStyle=grd; ctx.strokeStyle="rgba(255,255,255,.25)"; ctx.lineWidth=2;
    roundedRect(-18,-14,36,28,10); ctx.fill(); ctx.stroke();
    ctx.fillStyle="#e5e7eb"; roundedRect(10,-5,18,10,3); ctx.fill();
    ctx.restore();

    // hp bar + name
    ctx.fillStyle="rgba(0,0,0,.4)"; ctx.fillRect(s.x-20,s.y-30,40,6);
    ctx.fillStyle="#34d399"; ctx.fillRect(s.x-20,s.y-30,40*ratio,6);
    ctx.font="12px Inter,system-ui,sans-serif"; ctx.textAlign="center";
    ctx.fillStyle="rgba(255,255,255,.9)"; ctx.fillText(p.name, s.x, s.y-38);
  }
}

function drawGrid(){
  ctx.strokeStyle="rgba(255,255,255,.05)";
  const step=80;
  const start = screenToWorld(0,0);
  const end = screenToWorld(canvas.width,canvas.height);
  const x0 = Math.floor(start.x/step)*step;
  const y0 = Math.floor(start.y/step)*step;
  for (let x=x0; x<end.x; x+=step){
    const a = worldToScreen(x,0).x;
    ctx.beginPath(); ctx.moveTo(a,0); ctx.lineTo(a,canvas.height); ctx.stroke();
  }
  for (let y=y0; y<end.y; y+=step){
    const b = worldToScreen(0,y).y;
    ctx.beginPath(); ctx.moveTo(0,b); ctx.lineTo(canvas.width,b); ctx.stroke();
  }
}

function roundedRect(x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function skinColor(key){
  switch(key){
    case "neon": return "#6ee7ff";
    case "ember": return "#ff7a18";
    case "ocean": return "#22d3ee";
    default: return "#a6b2ff";
  }
}

// ping
function pingSend(){
  if (!socket || socket.disconnected) return;
  const t0 = performance.now();
  socket.timeout(1000).emit("ping", ()=>{}); // noop
  setTimeout(()=>{
    const rtt = performance.now()-t0;
    state.ping = Math.round(rtt);
    pingEl.textContent = state.ping;
    if (socket && !socket.disconnected) setTimeout(pingSend, 1000);
  }, 150);
}

// toast
let toastEl=null, toastT=0;
function toast(msg){
  if (!toastEl){ toastEl=document.createElement("div"); toastEl.className="toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.style.opacity = 1; toastT = Date.now();
  setTimeout(()=>{ if (Date.now()-toastT>1200) toastEl.style.opacity = 0; }, 1400);
}
