'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { generateBlock, PICKAXE_RECIPES, ORE_TIERS } = require('./worldgen');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// ─── In-memory "database" (replace with PostgreSQL + Redis in production) ───
const players = new Map();       // socketId -> player data
const accounts = new Map();      // username -> account
const worldBlocks = new Map();   // "x,y" -> depth
const activeBlocks = new Map();  // "x,y" -> { maxHp, currentHp, damage: Map(playerId -> dmg), blockData }
const sessions = new Map();      // token -> playerId

// World is infinite - all blocks start at depth 0 (stone), no pre-init needed

function getOrCreateAccount(username, password) {
  if (accounts.has(username)) {
    const acc = accounts.get(username);
    if (acc.password !== password) return null;
    return acc;
  }
  const acc = {
    id: uuidv4(),
    username,
    password,
    xp: 0,
    level: 1,
    coins: 100,
    inventory: {},
    pickaxes: [
      { id: uuidv4(), material: 'stone', damage: 1, equipped: true }
    ],
    stats: { blocksMined: 0, totalDamage: 0, deepestDepth: 0 }
  };
  accounts.set(username, acc);
  return acc;
}

function getEquippedPickaxe(account) {
  return account.pickaxes.find(p => p.equipped) || account.pickaxes[0] || { damage: 1, material: 'fist' };
}

function xpForLevel(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

function checkLevelUp(account) {
  const needed = xpForLevel(account.level);
  if (account.xp >= needed) {
    account.xp -= needed;
    account.level += 1;
    const reward = account.level * 50;
    account.coins += reward;
    return { leveledUp: true, newLevel: account.level, coinsEarned: reward };
  }
  return { leveledUp: false };
}

function isBlockAccessible(x, y) {
  // All blocks are accessible - world is fully open
  return true;
}

function getBlockState(x, y) {
  const key = `${x},${y}`;
  const depth = worldBlocks.has(key) ? worldBlocks.get(key) : 0;
  const blockData = generateBlock(x, y, depth);
  
  if (activeBlocks.has(key)) {
    return { ...activeBlocks.get(key).blockData, currentHp: activeBlocks.get(key).currentHp, depth };
  }
  
  return { ...blockData, currentHp: blockData.maxHp, depth };
}

function distributeDrops(blockKey, activeBlock) {
  const { blockData, damage } = activeBlock;
  const totalDamage = [...damage.values()].reduce((a, b) => a + b, 0);
  const drops = [];
  const sorted = [...damage.entries()].sort((a, b) => b[1] - a[1]);

  function allocate(item, total) {
    const reversed = [...sorted].reverse();
    let carryover = 0;
    const shares = new Map();
    for (const [playerId, dmg] of reversed) {
      const exact = (dmg / totalDamage) * total + carryover;
      const floored = Math.floor(exact);
      carryover = exact - floored;
      shares.set(playerId, floored);
    }
    // Dodaj całą resztę (nie floor!) do top gracza
    const topId = sorted[0][0];
    shares.set(topId, shares.get(topId) + Math.ceil(carryover));

    for (const [playerId, amount] of shares) {
      if (amount > 0) {
        const pct = Math.round(damage.get(playerId) / totalDamage * 100);
        drops.push({ playerId, ore: item, amount, pct });
      }
    }
  }

  if (blockData.ore && blockData.oreAmount > 0) {
    allocate(blockData.ore, blockData.oreAmount);
  } else {
    const depth = activeBlock.depth ?? 0;
    const totalStone = Math.max(1, Math.floor(Math.pow(1.5, depth + 1)));
    console.log(`[drops] depth=${depth} totalStone=${totalStone}`);
    allocate('stone', totalStone);
  }

  return drops;
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // ── Auth ──────────────────────────────────────────────────────────────────
  socket.on('auth', ({ username, password }) => {
    if (!username || !password || username.length < 2 || username.length > 20) {
      return socket.emit('auth:error', 'Invalid username (2-20 chars)');
    }
    
    const account = getOrCreateAccount(username.trim(), password);
    if (!account) {
      return socket.emit('auth:error', 'Wrong password');
    }

    players.set(socket.id, { socketId: socket.id, account, x: 0, y: 0 });
    socket.emit('auth:ok', {
      id: account.id,
      username: account.username,
      xp: account.xp,
      level: account.level,
      coins: account.coins,
      inventory: account.inventory,
      pickaxes: account.pickaxes,
      stats: account.stats,
      xpNeeded: xpForLevel(account.level),
    });

    // Send current online players
    const onlinePlayers = [...players.values()].map(p => ({
      id: p.account.id,
      username: p.account.username,
      x: p.x,
      y: p.y,
      level: p.account.level,
    }));
    socket.emit('players:list', onlinePlayers);
    socket.broadcast.emit('player:joined', {
      id: account.id, username: account.username, level: account.level, x: 0, y: 0
    });
  });

  // ── World: get chunk of blocks — only dug (depth>0) or actively damaged ──
  socket.on('world:chunk', ({ cx, cy, size = 40 }) => {
    const blocks = [];
    const half = Math.floor(size / 2);
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        const x = cx + dx, y = cy + dy;
        const key = `${x},${y}`;
        const depth = worldBlocks.has(key) ? worldBlocks.get(key) : 0;
        const hasActiveDamage = activeBlocks.has(key);
        // Only send blocks that differ from default (depth>0 or being mined)
        if (depth > 0 || hasActiveDamage) {
          const block = getBlockState(x, y);
          blocks.push({ x, y, depth, ...block });
        }
      }
    }
    socket.emit('world:chunk:data', blocks);
  });

  // ── Block: select / inspect ────────────────────────────────────────────────
  socket.on('block:inspect', ({ x, y }) => {
    if (!isBlockAccessible(x, y)) {
      return socket.emit('block:inspect:error', 'Block not accessible');
    }
    
    const key = `${x},${y}`;
    const depth = worldBlocks.has(key) ? worldBlocks.get(key) : 0;
    const blockData = generateBlock(x, y, depth);
    
    let currentHp = blockData.maxHp;
    let damageRanking = [];
    
    if (activeBlocks.has(key)) {
      const ab = activeBlocks.get(key);
      currentHp = ab.currentHp;
      const totalDmg = [...ab.damage.values()].reduce((a,b)=>a+b,0);
      damageRanking = [...ab.damage.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([pid, dmg]) => {
          const player = [...players.values()].find(p => p.account.id === pid);
          return {
            username: player?.account.username || '???',
            damage: dmg,
            pct: totalDmg > 0 ? Math.round(dmg / totalDmg * 100) : 0
          };
        });
    }
    
    socket.emit('block:info', {
      x, y, depth,
      type: blockData.type,
      color: blockData.color,
      ore: blockData.ore,
      oreAmount: blockData.oreAmount,
      oreColor: blockData.oreColor,
      maxHp: blockData.maxHp,
      currentHp,
      damageRanking,
    });
  });

  // ── Block: mine ───────────────────────────────────────────────────────────
  socket.on('block:mine', ({ x, y }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return socket.emit('error', 'Not authenticated');

    if (!isBlockAccessible(x, y)) {
      return socket.emit('mine:error', 'Block not accessible');
    }

    const { account } = playerData;
    const pickaxe = getEquippedPickaxe(account);
    const key = `${x},${y}`;
    const depth = worldBlocks.has(key) ? worldBlocks.get(key) : 0;
    const blockData = generateBlock(x, y, depth);

    // Init active block if needed
    if (!activeBlocks.has(key)) {
      activeBlocks.set(key, {
        x, y, depth,
        blockData,
        currentHp: blockData.maxHp,
        damage: new Map(),
      });
    }

    const ab = activeBlocks.get(key);
    const actualDamage = Math.min(pickaxe.damage, ab.currentHp);
    ab.currentHp -= actualDamage;

    // Track damage per player
    const prevDmg = ab.damage.get(account.id) || 0;
    ab.damage.set(account.id, prevDmg + actualDamage);

    // XP gain
    const xpGain = Math.floor(actualDamage * 0.1 + depth * 0.5 + 1);
    const coinGain = Math.floor(actualDamage * 0.05 + 1);
    account.xp += xpGain;
    account.coins += coinGain;
    account.stats.totalDamage += actualDamage;
    if (depth > account.stats.deepestDepth) account.stats.deepestDepth = depth;

    const levelResult = checkLevelUp(account);

    // Build updated ranking
    const totalDmg = [...ab.damage.values()].reduce((a,b)=>a+b,0);
    const damageRanking = [...ab.damage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pid, dmg]) => {
        const p = [...players.values()].find(p => p.account.id === pid);
        return { username: p?.account.username || '???', damage: dmg, pct: Math.round(dmg/totalDmg*100) };
      });

    // Broadcast mining hit to all
    io.emit('block:hit', {
      x, y,
      currentHp: ab.currentHp,
      maxHp: blockData.maxHp,
      minedBy: account.username,
      damage: actualDamage,
      damageRanking,
    });

    // Tell miner their reward
    socket.emit('mine:result', {
      xpGained: xpGain,
      coinsGained: coinGain,
      xp: account.xp,
      coins: account.coins,
      level: account.level,
      xpNeeded: xpForLevel(account.level),
      levelUp: levelResult,
      damageDealt: actualDamage,
    });

    // Block destroyed?
    if (ab.currentHp <= 0) {
      const drops = distributeDrops(key, ab);
      const newDepth = depth + 1;
      worldBlocks.set(key, newDepth);
      activeBlocks.delete(key);

      // Award drops to players
      drops.forEach(({ playerId, ore, amount, pct }) => {
        const p = [...players.values()].find(p => p.account.id === playerId);
        if (p) {
          p.account.inventory[ore] = (p.account.inventory[ore] || 0) + amount;
          p.account.stats.blocksMined++;
          const playerSocket = [...io.sockets.sockets.values()].find(s => players.get(s.id)?.account.id === playerId);
          if (playerSocket) {
            playerSocket.emit('drop:received', { ore, amount, pct, x, y });
            playerSocket.emit('inventory:update', p.account.inventory);
          }
        }
      });

      // Generate new block data for the revealed block
      const newBlock = generateBlock(x, y, newDepth);

      io.emit('block:destroyed', {
        x, y,
        newDepth,
        newBlock,
        drops: drops.map(d => ({ username: [...players.values()].find(p=>p.account.id===d.playerId)?.account.username||'???', ore: d.ore, amount: d.amount, pct: d.pct })),
      });
    }
  });

  // ── Pickaxe: craft ────────────────────────────────────────────────────────
  socket.on('pickaxe:craft', ({ material }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    const { account } = playerData;

    const recipe = PICKAXE_RECIPES[material];
    if (!recipe) return socket.emit('craft:error', 'Unknown material');

    // Check resources
    for (const [item, qty] of Object.entries(recipe.requires)) {
      if ((account.inventory[item] || 0) < qty) {
        return socket.emit('craft:error', `Need ${qty} ${item}, have ${account.inventory[item] || 0}`);
      }
    }

    // Consume resources
    for (const [item, qty] of Object.entries(recipe.requires)) {
      account.inventory[item] -= qty;
      if (account.inventory[item] <= 0) delete account.inventory[item];
    }

    // Add pickaxe
    const newPickaxe = { id: uuidv4(), material, damage: recipe.damage, equipped: false };
    account.pickaxes.push(newPickaxe);

    socket.emit('craft:ok', { pickaxe: newPickaxe, inventory: account.inventory });
  });

  // ── Pickaxe: equip ────────────────────────────────────────────────────────
  socket.on('pickaxe:equip', ({ pickaxeId }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    const { account } = playerData;

    account.pickaxes.forEach(p => { p.equipped = p.id === pickaxeId; });
    socket.emit('pickaxes:update', account.pickaxes);
  });

  // ── Player position (for showing other players on map) ───────────────────
  socket.on('player:move', ({ x, y }) => {
    const playerData = players.get(socket.id);
    if (!playerData) return;
    playerData.x = x;
    playerData.y = y;
    socket.broadcast.emit('player:moved', { id: playerData.account.id, x, y });
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const playerData = players.get(socket.id);
    if (playerData) {
      socket.broadcast.emit('player:left', { id: playerData.account.id, username: playerData.account.username });
      players.delete(socket.id);
    }
    console.log(`[-] Socket disconnected: ${socket.id}`);
  });
});

// ── REST: leaderboard ─────────────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const board = [...accounts.values()]
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, 20)
    .map(a => ({ username: a.username, level: a.level, blocksMined: a.stats.blocksMined, deepest: a.stats.deepestDepth }));
  res.json(board);
});

app.get('/api/recipes', (req, res) => {
  res.json(PICKAXE_RECIPES);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🪨 DeepDig server running on http://localhost:${PORT}`);
});
