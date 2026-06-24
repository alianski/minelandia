'use strict';

const { ORE_TIERS, PICKAXE_RECIPES } = require('../client/const.js');

// Deterministic pseudo-random from seed
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashCoords(x, y, depth) {
  // Simple integer hash combining x, y, depth
  let h = (x * 374761393 + y * 1367130551 + depth * 982451653) >>> 0;
  h = ((h ^ (h >>> 13)) * 1540483477) >>> 0;
  h = h ^ (h >>> 15);
  return h;
}

/**
 * Generate block data deterministically for (x, y, depth).
 * Returns { type, color, maxHp, ore, oreAmount, oreColor }
 */
function generateBlock(x, y, depth) {
  const hash = hashCoords(x, y, depth);
  const rng = seededRandom(hash);

  let maxHp = Math.floor(Math.pow(1.75, depth+1));

  // Check for ores
  let ore = null;
  let oreAmount = 0;

  // Eligible ores for this depth
  const eligibleOres = ORE_TIERS.filter(
    o => depth >= o.minDepth && depth <= o.maxDepth
  );
  if (eligibleOres.length > 0) {
    // Try each ore from rarest to most common
    const sorted = [...eligibleOres].sort((a, b) => a.dropChance - b.dropChance);
    const roll = rng();
    let cumulative = 0;
    for (const oreDef of sorted) {
      cumulative += oreDef.dropChance;
      if (roll < cumulative) {
        ore = oreDef.type;
        const [min, max] = oreDef.amount;
        const depthBonus = Math.floor(Math.pow(1.5, depth + 1 - oreDef.minDepth));
        oreAmount = min + Math.floor(rng() * (max - min + 1)) + depthBonus;
        // Ore makes block harder
        maxHp = Math.floor(maxHp * oreDef.hpMult);
        break;
      }
    }
  }

  return {
    maxHp,
    ore,
    oreAmount,
    oreColor: ore ? ORE_TIERS.find(o => o.type === ore)?.color : null,
  };
}

module.exports = { generateBlock, PICKAXE_RECIPES, ORE_TIERS, hashCoords };
