-- DeepDig Database Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Players
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(32) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  xp BIGINT DEFAULT 0,
  level INTEGER DEFAULT 1,
  coins BIGINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW()
);

-- Player inventory
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  item_type VARCHAR(64) NOT NULL,  -- 'stone', 'iron', 'gold', 'diamond', etc.
  quantity INTEGER DEFAULT 0,
  UNIQUE(player_id, item_type)
);

-- Player pickaxes
CREATE TABLE IF NOT EXISTS pickaxes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  material VARCHAR(64) NOT NULL,  -- 'wood', 'stone', 'iron', 'gold', 'diamond'
  damage INTEGER NOT NULL,
  is_equipped BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- World blocks (sparse storage - only excavated or revealed blocks)
-- Unrecorded blocks are generated procedurally client-side from (x, y, z)
CREATE TABLE IF NOT EXISTS world_blocks (
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,  -- how many blocks deep this tile has been dug
  PRIMARY KEY (x, y)
);

-- Active blocks (currently being mined - hp tracked in Redis, synced here on destroy)
CREATE TABLE IF NOT EXISTS block_damage_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  block_x INTEGER NOT NULL,
  block_y INTEGER NOT NULL,
  block_depth INTEGER NOT NULL,
  player_id UUID REFERENCES players(id),
  damage_dealt INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Leaderboard / stats
CREATE TABLE IF NOT EXISTS player_stats (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  blocks_mined BIGINT DEFAULT 0,
  total_damage BIGINT DEFAULT 0,
  deepest_depth INTEGER DEFAULT 0
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_world_blocks_xy ON world_blocks(x, y);
CREATE INDEX IF NOT EXISTS idx_block_damage_player ON block_damage_log(player_id);
CREATE INDEX IF NOT EXISTS idx_block_damage_block ON block_damage_log(block_x, block_y, block_depth);
CREATE INDEX IF NOT EXISTS idx_inventory_player ON inventory(player_id);
CREATE INDEX IF NOT EXISTS idx_pickaxes_player ON pickaxes(player_id);
