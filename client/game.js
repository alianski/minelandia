'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// WORLD GENERATION  (deterministyczna, identyczna jak server/worldgen.js)
// ═══════════════════════════════════════════════════════════════════════════

function hashCoords(x, y, depth) {
  let h = (x * 374761393 + y * 1367130551 + depth * 982451653) >>> 0;
  h = ((h ^ (h >>> 13)) * 1540483477) >>> 0;
  return h ^ (h >>> 15);
}
function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}


const BLOCK_NAMES = { stone:'Kamień', deepstone:'Głęboki Kamień', granite:'Granit', obsidian:'Obsydian', bedrock:'Bedrock' };

const BLOCK_TIERS = [
  { min: 0,   max: 15,  type: 'stone',     baseHp: 50  },
  { min: 12,  max: 40,  type: 'deepstone', baseHp: 100 },
  { min: 35,  max: 80,  type: 'granite',   baseHp: 200 },
  { min: 70,  max: 150, type: 'obsidian',  baseHp: 400 },
  { min: 140, max: 999, type: 'bedrock',   baseHp: 800 },
];

function depthToColor(depth) {
  // Paleta kolorów przez którą interpolujemy co 20 głębokości
  const palette = [
    [200, 200, 210],  // 0   — jasny szary (kamień)
    [170, 170, 185],  // 20  — szary
    [145, 135, 160],  // 40  — szarofioletowy
    [110, 100, 140],  // 60  — fioletowy
    [ 80,  90, 140],  // 80  — niebieskofioletowy
    [ 60, 100, 130],  // 100 — niebieski
    [ 50, 120, 110],  // 120 — niebieskozielony
    [ 60, 130,  80],  // 140 — zielony
    [ 90, 120,  50],  // 160 — żółtozielony
    [130, 100,  40],  // 180 — brązowożółty
    [150,  70,  30],  // 200 — brązowy
    [160,  40,  20],  // 220 — ciemnoczerwony
    [120,  20,  20],  // 240 — bardzo ciemnoczerwony
    [ 80,  10,  10],  // 260+ — prawie czarny z czerwienią
  ];
  const step = 1;
  const i = Math.min(Math.floor(depth / step), palette.length - 2);
  const t = (depth % step) / step;
  const a = palette[i], b = palette[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function getBlockTier(depth) {
  let best = BLOCK_TIERS[0];
  for (const t of BLOCK_TIERS) if (depth >= t.min && depth <= t.max) best = t;
  return best;
}

function generateBlock(x, y, depth) {
  const rng = seededRandom(hashCoords(x, y, depth));
  const tier = getBlockTier(depth);
  const depthMult = 1 + Math.log1p(depth) * 0.3;
  let maxHp = Math.floor(tier.baseHp * depthMult);
  let ore = null, oreAmount = 0, oreColor = null;
  const eligible = ORE_TIERS.filter(o => depth >= o.minDepth && o.maxDepth >= depth).sort((a,b) => a.dropChance - b.dropChance);
  if (eligible.length) {
    const roll = rng(); let cum = 0;
    for (const o of eligible) {
      cum += o.dropChance;
      if (roll < cum) {
        ore = o.type; oreColor = o.color;
        const depthBonus = Math.round(Math.pow(1.5, depth + 1- o.minDepth));
        oreAmount = o.amount[0] + Math.floor(rng() * (o.amount[1] - o.amount[0] + 1)) + depthBonus;
        maxHp = Math.floor(maxHp * o.hpMult);
        break;
      }
    }
  }
  return { type: tier.type, color: depthToColor(depth), maxHp, ore, oreAmount, oreColor };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

const BASE_TILE = 40;
const ZOOM_MIN = 0.25, ZOOM_MAX = 4;

const state = {
  player: null,
  camX: 0, camY: 0,
  zoom: 1,
  // Only blocks that differ from default (depth > 0 OR have active HP damage)
  dugBlocks: new Map(),   // "x,y" -> depth  (depth > 0 only)
  blockHp:   new Map(),   // "x,y" -> currentHp  (only while being mined)
  selectedBlock: null,
  onlinePlayers: new Map(),
  otherPlayerPos: new Map(),
  mineCooldown: false,
  hitAnims: [],
};

const TILE = () => BASE_TILE * state.zoom;

const socket = io();

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS
// ═══════════════════════════════════════════════════════════════════════════

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx    = mmCanvas.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

function w2s(wx, wy) {
  const T = TILE();
  return { sx: (wx - state.camX) * T + canvas.width/2, sy: (wy - state.camY) * T + canvas.height/2 };
}
function s2w(sx, sy) {
  const T = TILE();
  return { wx: Math.floor((sx - canvas.width/2) / T + state.camX), wy: Math.floor((sy - canvas.height/2) / T + state.camY) };
}
function getDepth(x, y) { return state.dugBlocks.get(`${x},${y}`) || 0; }
function getBlock(x, y) {
  const depth = getDepth(x, y);
  const bd = generateBlock(x, y, depth);
  const hp = state.blockHp.has(`${x},${y}`) ? state.blockHp.get(`${x},${y}`) : bd.maxHp;
  return { ...bd, depth, currentHp: hp };
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════════

function render() {
  const T = TILE();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Light background
  ctx.fillStyle = '#dde0e8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle grid bg pattern
  ctx.fillStyle = '#d4d7e0';
  const gOff = { x: (((-state.camX * T) % T) + T) % T, y: (((-state.camY * T) % T) + T) % T };
  for (let gx = gOff.x - T; gx < canvas.width + T; gx += T)
    for (let gy = gOff.y - T; gy < canvas.height + T; gy += T)
      ctx.fillRect(gx, gy, 1, canvas.height), ctx.fillRect(0, gy, canvas.width, 1);

  const cols = Math.ceil(canvas.width  / T) + 3;
  const rows = Math.ceil(canvas.height / T) + 3;
  const x0   = Math.floor(state.camX - cols/2);
  const y0   = Math.floor(state.camY - rows/2);

  for (let wx = x0; wx < x0 + cols; wx++) {
    for (let wy = y0; wy < y0 + rows; wy++) {
      const { sx, sy } = w2s(wx, wy);
      const bd = getBlock(wx, wy);
      const T1 = Math.ceil(T); // avoid sub-pixel gaps

      // --- Base block ---
      ctx.fillStyle = bd.color;
      ctx.fillRect(sx, sy, T1, T1);

      // --- Depth darkening ---
      if (bd.depth > 0) {
        ctx.fillStyle = `rgba(0,0,0,${Math.min(0.35, bd.depth * 0.006)})`;
        ctx.fillRect(sx, sy, T1, T1);
      }

      // --- Top-light bevel (gives 3D feel) ---
      if (T > 12) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(sx, sy, T1, 2);
        ctx.fillRect(sx, sy, 2, T1);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(sx, sy + T1 - 2, T1, 2);
        ctx.fillRect(sx + T1 - 2, sy, 2, T1);
      }

      // --- Ore dots ---
      if (bd.ore && bd.oreColor && T > 8) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = bd.oreColor;
        const r = Math.max(2, T * 0.10);
        [[0.33,0.33],[0.67,0.55],[0.48,0.70]].forEach(([fx,fy]) => {
          ctx.beginPath(); ctx.arc(sx+T*fx, sy+T*fy, r, 0, Math.PI*2); ctx.fill();
        });
        ctx.globalAlpha = 1;
        // Ore outline ring
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        [[0.33,0.33],[0.67,0.55],[0.48,0.70]].forEach(([fx,fy]) => {
          ctx.beginPath(); ctx.arc(sx+T*fx, sy+T*fy, r, 0, Math.PI*2); ctx.stroke();
        });
      }

      // --- Grid line ---
      if (T > 6) {
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx+0.5, sy+0.5, T1-1, T1-1);
      }

      // --- Selected highlight ---
      if (state.selectedBlock?.x === wx && state.selectedBlock?.y === wy) {
        ctx.strokeStyle = '#e05800';
        ctx.lineWidth = Math.max(2, T * 0.055);
        ctx.strokeRect(sx+2, sy+2, T1-4, T1-4);
        // Corner ticks
        const cs = Math.max(4, T * 0.18);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1.5, T * 0.035);
        ctx.beginPath();
        ctx.moveTo(sx+2,sy+2+cs); ctx.lineTo(sx+2,sy+2); ctx.lineTo(sx+2+cs,sy+2);
        ctx.moveTo(sx+T1-2-cs,sy+2); ctx.lineTo(sx+T1-2,sy+2); ctx.lineTo(sx+T1-2,sy+2+cs);
        ctx.moveTo(sx+2,sy+T1-2-cs); ctx.lineTo(sx+2,sy+T1-2); ctx.lineTo(sx+2+cs,sy+T1-2);
        ctx.moveTo(sx+T1-2-cs,sy+T1-2); ctx.lineTo(sx+T1-2,sy+T1-2); ctx.lineTo(sx+T1-2,sy+T1-2-cs);
        ctx.stroke();
      }
    }
  }

  // --- Hit flash animations ---
  state.hitAnims = state.hitAnims.filter(a => {
    a.t -= 0.07;
    if (a.t <= 0) return false;
    const { sx, sy } = w2s(a.x, a.y);
    ctx.fillStyle = `rgba(255,180,30,${a.t * 0.45})`;
    ctx.fillRect(sx, sy, Math.ceil(T), Math.ceil(T));
    return true;
  });

  // --- Other players ---
  state.otherPlayerPos.forEach((pos, id) => {
    const p = state.onlinePlayers.get(id);
    if (!p) return;
    const { sx, sy } = w2s(pos.x, pos.y);
    ctx.fillStyle = 'rgba(80,60,200,0.35)';
    ctx.beginPath(); ctx.arc(sx+T/2, sy+T/2, T*0.38, 0, Math.PI*2); ctx.fill();
    if (T > 14) {
      ctx.fillStyle = '#4040c0';
      ctx.font = `bold ${Math.max(8, T*0.22)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.username.slice(0,5), sx+T/2, sy+T/2+T*0.08);
      ctx.textAlign = 'left';
    }
  });

  renderMinimap();
  requestAnimationFrame(render);
}

// ─── Minimap ─────────────────────────────────────────────────────────────────
function renderMinimap() {
  const W = mmCanvas.width, H = mmCanvas.height;
  mmCtx.fillStyle = '#c8ccd8';
  mmCtx.fillRect(0, 0, W, H);

  const scale = 2;
  const cx = W/2, cy = H/2;

  // Draw dug blocks (different from default stone)
  state.dugBlocks.forEach((depth, key) => {
    const [wx, wy] = key.split(',').map(Number);
    const bd = generateBlock(wx, wy, depth);
    mmCtx.fillStyle = bd.color;
    mmCtx.fillRect(cx + (wx - state.camX)*scale, cy + (wy - state.camY)*scale, scale, scale);
  });

  // Camera crosshair
  mmCtx.strokeStyle = '#e05800';
  mmCtx.lineWidth = 1;
  mmCtx.beginPath();
  mmCtx.moveTo(cx-4, cy); mmCtx.lineTo(cx+4, cy);
  mmCtx.moveTo(cx, cy-4); mmCtx.lineTo(cx, cy+4);
  mmCtx.stroke();

  // View rectangle
  const T = TILE();
  const vw = (canvas.width / T) * scale;
  const vh = (canvas.height / T) * scale;
  mmCtx.strokeStyle = 'rgba(224,88,0,0.6)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(cx - vw/2, cy - vh/2, vw, vh);
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUT — camera, zoom, click
// ═══════════════════════════════════════════════════════════════════════════

const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; });
window.addEventListener('keyup',   e => { keys[e.key] = false; });

// WASD movement
setInterval(() => {
  if (!state.player) return;
  const spd = 0.18 / state.zoom;
  if (keys['w']||keys['ArrowUp'])    state.camY -= spd;
  if (keys['s']||keys['ArrowDown'])  state.camY += spd;
  if (keys['a']||keys['ArrowLeft'])  state.camX -= spd;
  if (keys['d']||keys['ArrowRight']) state.camX += spd;
}, 16);

// Middle-button or right-button drag
let drag = null;
canvas.addEventListener('mousedown', e => {
  if (e.button === 1 || e.button === 2) {
    drag = { mx: e.clientX, my: e.clientY, cx: state.camX, cy: state.camY };
    e.preventDefault();
  }
});
window.addEventListener('mousemove', e => {
  if (!drag) return;
  const T = TILE();
  state.camX = drag.cx - (e.clientX - drag.mx) / T;
  state.camY = drag.cy - (e.clientY - drag.my) / T;
});
window.addEventListener('mouseup', e => { if (e.button===1||e.button===2) drag=null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// Scroll zoom — zoom toward mouse cursor
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
  const oldZoom = state.zoom;
  state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoom * factor));

  // Zoom toward cursor
  const T_old = BASE_TILE * oldZoom;
  const T_new = BASE_TILE * state.zoom;
  const mx = e.clientX - canvas.width/2;
  const my = e.clientY - canvas.height/2;
  state.camX += mx/T_old - mx/T_new;
  state.camY += my/T_old - my/T_new;
}, { passive: false });

// Left click → select block
canvas.addEventListener('click', e => {
  if (!state.player) return;
  const { wx, wy } = s2w(e.clientX, e.clientY);
  state.selectedBlock = { x: wx, y: wy };
  socket.emit('block:inspect', { x: wx, y: wy });
  document.getElementById('depth-val').textContent =
    `Głęb. ${getDepth(wx,wy)} @ (${wx}, ${wy})`;
});

// ═══════════════════════════════════════════════════════════════════════════
// CHUNK LOADING — only fetch dug-block data from server
// ═══════════════════════════════════════════════════════════════════════════

let lastChunkKey = '';
setInterval(() => {
  if (!state.player) return;
  const cx = Math.round(state.camX), cy = Math.round(state.camY);
  const k = `${cx},${cy}`;
  if (k !== lastChunkKey) {
    socket.emit('world:chunk', { cx, cy, size: 40 });
    lastChunkKey = k;
  }
}, 400);

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ═══════════════════════════════════════════════════════════════════════════

socket.on('auth:ok', data => {
  state.player = data;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('game-ui').style.display = 'block';
  updateHUD();
  socket.emit('world:chunk', { cx: 0, cy: 0, size: 40 });
  render();
  showNotif(`Witaj, ${data.username}! Poziom ${data.level}`, 'info');
});

socket.on('auth:error', msg => {
  document.getElementById('login-error').textContent = msg;
});

// Server sends ONLY blocks that have been dug (depth > 0) or are being mined
socket.on('world:chunk:data', blocks => {
  blocks.forEach(b => {
    if (b.depth > 0) state.dugBlocks.set(`${b.x},${b.y}`, b.depth);
    if (b.currentHp !== undefined && b.currentHp < b.maxHp)
      state.blockHp.set(`${b.x},${b.y}`, b.currentHp);
  });
});

socket.on('block:info', showBlockPopup);

socket.on('block:hit', data => {
  const key = `${data.x},${data.y}`;
  state.blockHp.set(key, data.currentHp);
  state.hitAnims.push({ x: data.x, y: data.y, t: 1 });
  if (state.selectedBlock?.x===data.x && state.selectedBlock?.y===data.y)
    updatePopupHp(data.currentHp, data.maxHp, data.damageRanking);
});

socket.on('block:destroyed', data => {
  const key = `${data.x},${data.y}`;
  if (data.newDepth > 0) state.dugBlocks.set(key, data.newDepth);
  state.blockHp.delete(key);

  if (state.selectedBlock?.x===data.x && state.selectedBlock?.y===data.y) {
    document.getElementById('block-popup').style.display = 'none';
    state.selectedBlock = null;
  }
  if (data.drops?.length) data.drops.forEach(d => addDropFeed(`${d.username} +${d.amount} ${d.ore} (${d.pct}%)`));
});

socket.on('mine:result', data => {
  if (!state.player) return;
  Object.assign(state.player, { xp: data.xp, coins: data.coins, level: data.level, xpNeeded: data.xpNeeded });
  updateHUD();
  if (data.levelUp?.leveledUp)
    showNotif(`⬆ Level Up! Poziom ${data.levelUp.newLevel}! +${data.levelUp.coinsEarned} monet`, 'levelup');
});

socket.on('drop:received',    data => showNotif(`+${data.amount} ${data.ore} (${data.pct}% dmg)`, 'drop'));
socket.on('inventory:update', inv  => { if (state.player) state.player.inventory = inv; });

socket.on('craft:ok', data => {
  if (!state.player) return;
  state.player.inventory = data.inventory;
  state.player.pickaxes.push(data.pickaxe);
  showNotif(`Skraftowano kilof: ${data.pickaxe.material} ⚡${data.pickaxe.damage}`, 'drop');
  renderCraftModal(); renderInventoryModal();
});
socket.on('craft:error',    msg     => showNotif('Brak surowców: '+msg, 'info'));
socket.on('pickaxes:update',pickaxes => {
  if (!state.player) return;
  state.player.pickaxes = pickaxes;
  const eq = pickaxes.find(p=>p.equipped);
  if (eq) { document.getElementById('popup-pickaxe-name').textContent=eq.material; document.getElementById('popup-pickaxe-dmg').textContent=`⚡${eq.damage}`; }
  renderInventoryModal();
});

socket.on('players:list', ps => { state.onlinePlayers.clear(); ps.forEach(p=>state.onlinePlayers.set(p.id,p)); updateOnlinePanel(); });
socket.on('player:joined', p => { state.onlinePlayers.set(p.id,p); updateOnlinePanel(); showNotif(`${p.username} dołączył`,  'info'); });
socket.on('player:left',   p => { state.onlinePlayers.delete(p.id); state.otherPlayerPos.delete(p.id); updateOnlinePanel(); showNotif(`${p.username} wyszedł`,'info'); });
socket.on('player:moved', ({id,x,y}) => state.otherPlayerPos.set(id,{x,y}));

// ═══════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function updateHUD() {
  const p = state.player; if (!p) return;
  document.getElementById('hud-level').textContent  = `Lv.${p.level}`;
  document.getElementById('hud-coins').textContent  = p.coins.toLocaleString();
  document.getElementById('hud-username').textContent = p.username;
  const pct = Math.min(100, p.xp/p.xpNeeded*100);
  document.getElementById('xp-bar').style.width   = pct+'%';
  document.getElementById('xp-label').textContent = `${p.xp} / ${p.xpNeeded} XP`;
}

const ORE_NAMES = {
  coal: 'węgla', iron: 'żelaza', copper: 'miedzi', silver: 'srebra',
  gold: 'złota', ruby: 'rubinu', sapphire: 'szafiru', emerald: 'szmaragdu',
  diamond: 'diamentu', mythril: 'mythrilu',
};


function showBlockPopup(data) {
  document.getElementById('block-popup').style.display = 'block';
  document.getElementById('popup-ore-dot').style.background = data.ore ? data.oreColor : data.color;
  document.getElementById('popup-block-name').textContent = data.ore ? `Ruda ${ORE_NAMES[data.ore] || data.ore}` : 'Kamień';
  document.getElementById('popup-depth-badge').textContent  = `głęb. ${data.depth}`;
  updatePopupHp(data.currentHp, data.maxHp, data.damageRanking);
  document.getElementById('popup-ore-row').style.display = data.ore ? 'flex' : 'none';
  document.getElementById('popup-ore-row').style.display = 'flex';
  if (data.ore) {
    document.getElementById('popup-ore-name').textContent   = `Ruda ${ORE_NAMES[data.ore] || data.ore}`;
    document.getElementById('popup-ore-amount').textContent = `×${data.oreAmount}`;
  } else {
    const stoneAmount = Math.max(1, Math.floor(Math.pow(1.5, data.depth+1)));
    document.getElementById('popup-ore-name').textContent   = 'Kamień';
    document.getElementById('popup-ore-amount').textContent = `×${stoneAmount}`;
  }
  const eq = state.player?.pickaxes?.find(p=>p.equipped) || {material:'Drewniane',damage:5};
  document.getElementById('popup-pickaxe-name').textContent = eq.material;
  document.getElementById('popup-pickaxe-dmg').textContent  = `⚡${eq.damage}`;
}

function updatePopupHp(currentHp, maxHp, ranking) {
  const pct = Math.max(0, Math.min(100, currentHp/maxHp*100));
  const bar = document.getElementById('popup-hp-bar');
  bar.style.width = pct+'%';
  bar.style.background = pct>60?'#30a855':pct>30?'#d09020':'#d03030';
  document.getElementById('popup-hp-text').textContent = `${Math.max(0,currentHp)} / ${maxHp}`;
  const rankEl = document.getElementById('popup-ranking');
  if (ranking?.length) {
    rankEl.innerHTML = `<div class="ranking-title">⚔ Zadany damage</div>` +
      ranking.map((r,i)=>`<div class="ranking-row">
        <span class="ranking-pos">${['①','②','③','④','⑤'][i]||'#'+(i+1)}</span>
        <span class="ranking-name">${r.username}</span>
        <span class="ranking-dmg">${r.damage}</span>
        <span class="ranking-pct">${r.pct}%</span>
      </div>`).join('');
  } else rankEl.innerHTML = '';
}

function showNotif(msg, type='info') {
  const el = document.createElement('div');
  el.className = `notif notif-${type}`; el.textContent = msg;
  document.getElementById('notifications').prepend(el);
  setTimeout(()=>el.remove(), 3200);
}
function addDropFeed(msg) {
  const el = document.createElement('div');
  el.className='drop-item'; el.textContent=msg;
  document.getElementById('drop-feed').prepend(el);
  setTimeout(()=>el.remove(), 4200);
}
function updateOnlinePanel() {
  document.getElementById('online-count').textContent = state.onlinePlayers.size+1;
  const list = document.getElementById('online-list');
  list.innerHTML = '';
  if (state.player) {
    list.insertAdjacentHTML('beforeend', `<div class="online-player"><span class="online-dot"></span><span>${state.player.username}</span><span class="online-lvl">Lv.${state.player.level}</span></div>`);
  }
  state.onlinePlayers.forEach(p => {
    list.insertAdjacentHTML('beforeend', `<div class="online-player"><span class="online-dot" style="background:#6060cc;box-shadow:0 0 5px #6060cc"></span><span>${p.username}</span><span class="online-lvl">Lv.${p.level}</span></div>`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH BAR
// ═══════════════════════════════════════════════════════════════════════════

function doSearch(query) {
  query = query.trim();
  if (!query) return;

  // Format: "x,y" or "x y" → teleport camera
  const coordMatch = query.match(/^(-?\d+)[,\s]+(-?\d+)$/);
  if (coordMatch) {
    state.camX = parseInt(coordMatch[1]) + 0.5;
    state.camY = parseInt(coordMatch[2]) + 0.5;
    showNotif(`Przeniesiono do (${coordMatch[1]}, ${coordMatch[2]})`, 'info');
    return;
  }

  // Format: "block:<name>" → find nearest block of that type
  const blockMatch = query.match(/^block:(.+)$/i);
  if (blockMatch) {
    const name = blockMatch[1].toLowerCase();
    // Check known block types
    const tier = BLOCK_TIERS.find(t => t.type === name || BLOCK_NAMES[t.type]?.toLowerCase() === name);
    if (tier) {
      // Find closest depth that matches and teleport cam to 0,0 with that depth message
      const exampleDepth = tier.min;
      showNotif(`Blok "${name}" pojawia się na głębokości ${tier.min}–${tier.max}. Szukaj w dół!`, 'info');
      // Scan dug blocks for one matching
      let found = null;
      for (const [key, depth] of state.dugBlocks) {
        const [bx, by] = key.split(',').map(Number);
        const bd = generateBlock(bx, by, depth);
        if (bd.type === name || bd.type === tier.type) { found = {x:bx,y:by}; break; }
      }
      if (found) { state.camX=found.x+0.5; state.camY=found.y+0.5; showNotif(`Znaleziono ${name} @ (${found.x}, ${found.y})`, 'drop'); }
      else showNotif(`Brak wykopanych bloków typu "${name}" w pobliżu.`, 'info');
    } else {
      // Search ores
      const ore = ORE_TIERS.find(o => o.type === name);
      if (ore) {
        let found = null;
        for (const [key, depth] of state.dugBlocks) {
          const [bx, by] = key.split(',').map(Number);
          const bd = generateBlock(bx, by, depth);
          if (bd.ore === name) { found={x:bx,y:by}; break; }
        }
        if (found) { state.camX=found.x+0.5; state.camY=found.y+0.5; showNotif(`Znaleziono rudę ${name} @ (${found.x}, ${found.y})`, 'drop'); }
        else showNotif(`Ruda "${name}" pojawia się od głębokości ${ore.minDepth}.`, 'info');
      } else {
        showNotif(`Nieznany blok lub ruda: "${name}"`, 'info');
      }
    }
    return;
  }

  // Format: "depth:<int>" → find nearest block with that depth
  const depthMatch = query.match(/^depth:(\d+)$/i);
  if (depthMatch) {
    const targetDepth = parseInt(depthMatch[1]);
    let best = null, bestDist = Infinity;
    for (const [key, depth] of state.dugBlocks) {
      if (depth === targetDepth) {
        const [bx, by] = key.split(',').map(Number);
        const dist = Math.hypot(bx - state.camX, by - state.camY);
        if (dist < bestDist) { bestDist=dist; best={x:bx,y:by}; }
      }
    }
    if (best) { state.camX=best.x+0.5; state.camY=best.y+0.5; showNotif(`Znaleziono blok głębokości ${targetDepth} @ (${best.x}, ${best.y})`, 'drop'); }
    else showNotif(`Brak wykopanych bloków o głębokości ${targetDepth}.`, 'info');
    return;
  }

  showNotif('Format: "x,y" | "block:nazwa" | "depth:liczba"', 'info');
}

document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { doSearch(e.target.value); e.target.blur(); }
  e.stopPropagation(); // don't let WASD in search field move camera
});
document.getElementById('search-btn').addEventListener('click', () => {
  doSearch(document.getElementById('search-input').value);
});

// ═══════════════════════════════════════════════════════════════════════════
// MINING
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('btn-mine').addEventListener('click', doMine);
window.addEventListener('keydown', e => { if (e.code==='Space' && !e.target.matches('input')) { e.preventDefault(); doMine(); } });

function doMine() {
  if (state.mineCooldown || !state.selectedBlock || !state.player) return;
  socket.emit('block:mine', { x: state.selectedBlock.x, y: state.selectedBlock.y });
  const btn = document.getElementById('btn-mine');
  btn.textContent='⏳'; btn.classList.add('cooldown');
  state.mineCooldown = true;
  setTimeout(()=>{ btn.textContent='⛏ Kop!'; btn.classList.remove('cooldown'); state.mineCooldown=false; }, 350);
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('btn-inventory').addEventListener('click', ()=>{ renderInventoryModal(); document.getElementById('modal-inventory').style.display='flex'; });

function renderInventoryModal() {
  const inv = state.player?.inventory || {};
  const grid = document.getElementById('inv-grid');
  const entries = Object.entries(inv).filter(([,q])=>q>0);
  grid.innerHTML = entries.length
    ? entries.map(([item,qty])=>{ const o=ORE_TIERS.find(x=>x.type===item); return `<div class="inv-item"><div class="inv-item-dot" style="background:${o?.color||'#888'}"></div><span class="inv-item-qty">${qty}</span><span class="inv-item-name">${item}</span></div>`; }).join('')
    : '<span class="inv-empty">Ekwipunek pusty. Wykop coś!</span>';

  const pickaxes = state.player?.pickaxes || [];
  document.getElementById('pickaxe-list').innerHTML = pickaxes.map(p=>`
    <div class="pickaxe-item ${p.equipped?'equipped':''}" data-id="${p.id}">
      <span class="pickaxe-icon">⛏</span>
      <span class="pickaxe-name">${p.material}</span>
      <span class="pickaxe-dmg">⚡${p.damage}</span>
      ${p.equipped?'<span class="pickaxe-equip-badge">WYPOSAŻONY</span>':'<button class="hud-btn" style="font-size:.72rem;padding:3px 8px">Wyposażaj</button>'}
    </div>`).join('');

  document.getElementById('pickaxe-list').querySelectorAll('.pickaxe-item button').forEach(btn=>{
    btn.addEventListener('click', e=>{ e.stopPropagation(); socket.emit('pickaxe:equip',{pickaxeId:btn.closest('.pickaxe-item').dataset.id}); });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CRAFTING
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('btn-craft').addEventListener('click', ()=>{ renderCraftModal(); document.getElementById('modal-craft').style.display='flex'; });

function renderCraftModal() {
  const inv = state.player?.inventory || {};
  const grid = document.getElementById('craft-grid');
  grid.innerHTML = Object.entries(PICKAXE_RECIPES).map(([material,recipe])=>{
    const ok = Object.entries(recipe.requires).every(([i,q])=>(inv[i]||0)>=q);
    return `<div class="craft-item ${ok?'can-craft':'cannot-craft'}">
      <div class="craft-item-header"><span>⛏</span><span class="craft-item-name">${material}</span><span class="craft-item-dmg">⚡${recipe.damage}</span></div>
      <div class="craft-requires">${Object.entries(recipe.requires).map(([i,q])=>{
        const have=inv[i]||0; return `<div class="craft-req-item"><span>${i}</span><span class="${have>=q?'craft-req-ok':'craft-req-bad'}">${have}/${q}</span></div>`;
      }).join('')}</div>
      <button class="craft-btn" ${ok?'':'disabled'} data-material="${material}">${ok?'Skraftuj':'Brak surowców'}</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.craft-btn:not([disabled])').forEach(btn=>{
    btn.addEventListener('click',()=>socket.emit('pickaxe:craft',{material:btn.dataset.material}));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════

document.getElementById('btn-leaderboard').addEventListener('click', async ()=>{
  document.getElementById('modal-leaderboard').style.display='flex';
  const data = await fetch('/api/leaderboard').then(r=>r.json());
  const pos = ['gold','silver','bronze'];
  document.getElementById('leaderboard-list').innerHTML = data.map((p,i)=>`
    <div class="lb-row">
      <span class="lb-pos ${pos[i]||''}">${i+1}.</span>
      <span class="lb-name">${p.username}</span>
      <span class="lb-level">Lv.${p.level}</span>
      <span class="lb-stat">⛏${p.blocksMined}</span>
      <span class="lb-stat">↓${p.deepest}</span>
    </div>`).join('') || '<span class="inv-empty">Brak danych</span>';
});

// ═══════════════════════════════════════════════════════════════════════════
// MODALS & LOGIN
// ═══════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.modal-close').forEach(btn=>btn.addEventListener('click',()=>btn.closest('.modal').style.display='none'));
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.style.display='none';}));

document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', e=>{if(e.key==='Enter')doLogin();});
function doLogin() {
  const u=document.getElementById('login-username').value.trim();
  const p=document.getElementById('login-password').value;
  if (!u||!p){document.getElementById('login-error').textContent='Podaj nazwę i hasło.';return;}
  document.getElementById('login-error').textContent='';
  socket.emit('auth',{username:u,password:p});
}
