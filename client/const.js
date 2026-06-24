const ORE_TIERS = [
  { type: 'coal',     color: '#444455', minDepth: 1,   maxDepth: 5,     dropChance: 0.3, amount:[1,4], hpMult:1.1 },
  { type: 'copper',   color: '#c87840', minDepth: 3,   maxDepth: 8,     dropChance: 0.2, amount:[1,3], hpMult:1.2 },
  { type: 'iron',     color: '#b8a888', minDepth: 5,   maxDepth: 10,    dropChance: 0.15, amount:[1,3], hpMult:1.3 },
  { type: 'silver',   color: '#b0b8cc', minDepth: 20,  maxDepth: 100,   dropChance: 0.08, amount:[1,2], hpMult:1.5 },
  { type: 'gold',     color: '#e8c030', minDepth: 30,  maxDepth: 100,   dropChance: 0.06, amount:[1,2], hpMult:1.8 },
  { type: 'ruby',     color: '#e02858', minDepth: 50,  maxDepth: 100,   dropChance: 0.04, amount:[1,2], hpMult:2.0 },
  { type: 'sapphire', color: '#2868d0', minDepth: 70,  maxDepth: 100,   dropChance: 0.03, amount:[1,1], hpMult:2.5 },
  { type: 'emerald',  color: '#30b860', minDepth: 90,  maxDepth: 200,   dropChance: 0.025,amount:[1,1], hpMult:3.0 },
  { type: 'diamond',  color: '#80e8ff', minDepth: 120, maxDepth: 200,   dropChance: 0.015,amount:[1,1], hpMult:4.0 },
  { type: 'mythril',  color: '#9868ff', minDepth: 160, maxDepth: 200,   dropChance: 0.01, amount:[1,1], hpMult:5.0 },
];

const PICKAXE_RECIPES = {
  stone:    { damage: 1,  requires: { stone: 5 } },
  coal:     { damage: 2,  requires: { coal: 5 } },
  copper:   { damage: 4,  requires: { copper: 4 } },
  iron:     { damage: 5,  requires: { iron: 4 } },
  silver:   { damage: 80,  requires: { silver: 3 } },
  gold:     { damage: 60,  requires: { gold: 4 } },
  ruby:     { damage: 150, requires: { ruby: 3, iron: 2 } },
  sapphire: { damage: 220, requires: { sapphire: 3, silver: 2 } },
  emerald:  { damage: 300, requires: { emerald: 3, gold: 2 } },
  diamond:  { damage: 500, requires: { diamond: 3, gold: 4 } },
  mythril:  { damage: 900, requires: { mythril: 2, diamond: 2 } },
};

exports.ORE_TIERS = ORE_TIERS;
exports.PICKAXE_RECIPES = PICKAXE_RECIPES;