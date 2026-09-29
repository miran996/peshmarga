/**
 * Weapons, cosmetics and difficulty tuning. Sent to the client via /api/catalog
 * and used server-side to validate purchases and multiplayer shots.
 */
const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Pistol', slot: 'secondary', cost: 0, auto: false,
    damage: 28, headMult: 2.0, fireRate: 5, magSize: 12, reserve: 72, reloadTime: 1.4,
    hipSpread: 0.028, adsSpread: 0.005, range: 45, recoil: 0.018, moveMult: 1.0, adsFov: 58,
    optic: 'reddot',
    description: 'Reliable sidearm with a micro red-dot. Fast handling, fast reload.',
  },
  autorifle: {
    id: 'autorifle', name: 'Automatic Rifle', slot: 'primary', cost: 400, auto: true,
    damage: 24, headMult: 1.6, fireRate: 10, magSize: 30, reserve: 180, reloadTime: 2.1,
    hipSpread: 0.04, adsSpread: 0.006, range: 70, recoil: 0.014, moveMult: 0.95, adsFov: 52,
    optic: 'acog',
    description: 'AR-15 carbine with ACOG optic and suppressor. Balanced mid-range full-auto.',
  },
  machinegun: {
    id: 'machinegun', name: 'Machine Gun', slot: 'primary', cost: 600, auto: true,
    damage: 22, headMult: 1.5, fireRate: 13, magSize: 75, reserve: 225, reloadTime: 4.2,
    hipSpread: 0.06, adsSpread: 0.009, range: 60, recoil: 0.017, moveMult: 0.82, adsFov: 54,
    optic: 'holo',
    description: 'Huge belt and holographic sight for suppressing fire. Painfully slow reload.',
  },
  sniper: {
    id: 'sniper', name: 'Sniper Rifle', slot: 'primary', cost: 750, auto: false,
    damage: 50, headMult: 2.0, fireRate: 0.85, magSize: 5, reserve: 30, reloadTime: 3.0,
    hipSpread: 0.12, adsSpread: 0.0, range: 250, recoil: 0.09, moveMult: 0.88, adsFov: 18,
    optic: 'scope',
    description: 'Headshot kills instantly. Body shots strip half health. Punishing when unscoped.',
  },
  rpg: {
    id: 'rpg', name: 'RPG-7', slot: 'secondary', cost: 900, auto: false,
    damage: 150, headMult: 1, fireRate: 0.45, magSize: 1, reserve: 3, reloadTime: 3.4,
    hipSpread: 0.012, adsSpread: 0.003, range: 150, recoil: 0.08, moveMult: 0.85, adsFov: 50,
    optic: 'iron',
    projectile: { speed: 55, gravity: 3, life: 3.5 },
    blast: { maxDamage: 150, innerRadius: 1.3, radius: 5.5 },
    description: 'Rocket launcher. Explodes on impact with heavy splash damage. Replaces the pistol.',
  },
  smg: {
    id: 'smg', name: 'SMG-9', slot: 'primary', cost: 550, auto: true,
    damage: 18, headMult: 1.55, fireRate: 14, magSize: 32, reserve: 160, reloadTime: 1.7,
    hipSpread: 0.05, adsSpread: 0.01, range: 42, recoil: 0.012, moveMult: 1.05, adsFov: 56,
    optic: 'reddot',
    description: 'Close-quarters spray. Fast reload, weak at range.',
  },
  shotgun: {
    id: 'shotgun', name: 'Combat Shotgun', slot: 'primary', cost: 750, auto: false,
    damage: 78, headMult: 1.35, fireRate: 1.15, magSize: 6, reserve: 30, reloadTime: 2.8,
    hipSpread: 0.09, adsSpread: 0.045, range: 22, recoil: 0.07, moveMult: 0.92, adsFov: 58,
    optic: 'iron',
    description: 'Devastating up close. Spread blooms hard past mid-range.',
  },
  dmr: {
    id: 'dmr', name: 'Marksman Rifle', slot: 'primary', cost: 950, auto: false,
    damage: 48, headMult: 1.85, fireRate: 2.4, magSize: 12, reserve: 60, reloadTime: 2.4,
    hipSpread: 0.07, adsSpread: 0.002, range: 120, recoil: 0.04, moveMult: 0.9, adsFov: 36,
    optic: 'acog',
    description: 'Semi-auto precision. Two body shots or one clean headshot.',
  },
  revolver: {
    id: 'revolver', name: 'Revolver', slot: 'secondary', cost: 400, auto: false,
    damage: 52, headMult: 2.0, fireRate: 2.2, magSize: 6, reserve: 36, reloadTime: 2.2,
    hipSpread: 0.03, adsSpread: 0.006, range: 55, recoil: 0.045, moveMult: 1.0, adsFov: 56,
    optic: 'iron',
    description: 'Heavy sidearm. Hard-hitting, slow cylinder reload.',
  },
  vector: {
    id: 'vector', name: 'Vector .45', slot: 'primary', cost: 2200, auto: true,
    damage: 20, headMult: 1.6, fireRate: 16, magSize: 25, reserve: 150, reloadTime: 1.55,
    hipSpread: 0.038, adsSpread: 0.007, range: 48, recoil: 0.009, moveMult: 1.08, adsFov: 54,
    optic: 'holo',
    description: 'Premium ultra-fast SMG. Expensive unlock for aggressive players.',
  },
  goldar: {
    id: 'goldar', name: 'Gold Carbine', slot: 'primary', cost: 2800, auto: true,
    damage: 26, headMult: 1.65, fireRate: 11, magSize: 35, reserve: 210, reloadTime: 1.9,
    hipSpread: 0.034, adsSpread: 0.005, range: 80, recoil: 0.011, moveMult: 0.98, adsFov: 50,
    optic: 'acog',
    description: 'Gilded AR with a bigger mag and tighter recoil. Status symbol.',
  },
  antimaterial: {
    id: 'antimaterial', name: 'Anti-Materiel', slot: 'primary', cost: 4500, auto: false,
    damage: 95, headMult: 2.0, fireRate: 0.55, magSize: 4, reserve: 16, reloadTime: 3.6,
    hipSpread: 0.14, adsSpread: 0.0, range: 300, recoil: 0.12, moveMult: 0.78, adsFov: 14,
    optic: 'scope',
    description: 'Heavy .50 BMG. One-shot torso. Slow, loud, and expensive.',
  },
};

/**
 * Every outfit is the same special-forces kit (plate carrier, helmet with NVG mount, balaclava) in its own
 * camouflage. camo = [base, blotch 1, blotch 2, blotch 3]; colors drive the 2D shop art.
 */
const COSMETICS = {
  classic: {
    id: 'classic', name: 'Multicam Operator', cost: 0,
    description: 'Standard-issue multicam uniform, coyote plate carrier, helmet with NVG mount.',
    colors: { body: '#8a7f62', limb: '#6f6a4e', accent: '#2b2a27' },
    camo: { pattern: 'multicam', colors: ['#8f8566', '#5f6446', '#a8987a', '#3e3a2c'] },
    vest: '#8a7755', helmet: '#7d7358', balaclava: '#2a2926', gloves: '#2f2c27', boots: '#4a3f31', lens: '#1c2326',
  },
  shadow: {
    id: 'shadow', name: 'Black Ops', cost: 250,
    description: 'Blacked-out night kit with charcoal camo and a crimson IR marker.',
    colors: { body: '#1d1e21', limb: '#2a2b2f', accent: '#c0262d' },
    camo: { pattern: 'multicam', colors: ['#2a2b2e', '#1a1b1d', '#3a3b3f', '#111214'] },
    vest: '#1b1c1f', helmet: '#222326', balaclava: '#121314', gloves: '#141416', boots: '#161618', lens: '#3a0d0f', marker: '#c0262d',
  },
  desert: {
    id: 'desert', name: 'Desert Raider', cost: 300,
    description: 'Arid camo, tan plate carrier and a shemagh wrapped over the balaclava.',
    colors: { body: '#c2a878', limb: '#a38a5e', accent: '#5a3d22' },
    camo: { pattern: 'arid', colors: ['#c4ab7c', '#a88c5e', '#d9c59b', '#7d6644'] },
    vest: '#b39a6c', helmet: '#b59f73', balaclava: '#8f7a55', gloves: '#6e5a3e', boots: '#7a6445', lens: '#2a2418', shemagh: '#d8c7a2',
  },
  arctic: {
    id: 'arctic', name: 'Arctic Ghost', cost: 350,
    description: 'Snow camouflage, white helmet cover and a pale balaclava.',
    colors: { body: '#e6edf3', limb: '#c3d0dc', accent: '#3d7fb8' },
    camo: { pattern: 'snow', colors: ['#e3e8ec', '#b9c3cc', '#f5f7f8', '#8b97a3'] },
    vest: '#cfd6dc', helmet: '#e8edf0', balaclava: '#d9dee2', gloves: '#9aa4ad', boots: '#6d767f', lens: '#1d2a36',
  },
  neon: {
    id: 'neon', name: 'Night Stalker', cost: 500,
    description: 'Black digital camo with glowing cyan IR strobes and NVG lenses.',
    colors: { body: '#0a1418', limb: '#00e5ff', accent: '#ff2bd6' },
    camo: { pattern: 'digital', colors: ['#141a1e', '#0b1013', '#1f292e', '#07484f'] },
    vest: '#10171a', helmet: '#151d21', balaclava: '#0b0f11', gloves: '#0d1215', boots: '#0d1113', lens: '#00e5ff', marker: '#00e5ff', glow: true,
  },
  commander: {
    id: 'commander', name: 'Iron Commander', cost: 800,
    description: 'Woodland camo, olive carrier, gold insignia and a command radio antenna.',
    colors: { body: '#3c4630', limb: '#2e3625', accent: '#d4a93a' },
    camo: { pattern: 'woodland', colors: ['#4e5a3a', '#2f3824', '#6b6a45', '#1f2218'] },
    vest: '#46503a', helmet: '#4b5540', balaclava: '#1f2218', gloves: '#2b2f24', boots: '#2d2a22', lens: '#1f2a1c', insignia: '#d4a93a', antenna: true,
  },
};

/**
 * reaction: seconds before a bot reacts to first sight
 * aimError: radians of aim error at engagement start (shrinks while tracking)
 * trackRate: how quickly aim error decays while tracking
 * burst: [minShots, maxShots] per burst
 * useCover/flank/strafe/seekPlayer: tactical toggles & probabilities
 */
const DIFFICULTY = {
  normal: {
    id: 'normal', name: 'Normal', botCount: 5, reaction: 0.9, aimError: 0.12, trackRate: 0.6,
    damageMult: 0.55, fireRateMult: 0.55, burst: [2, 4], viewDist: 45, fov: 100,
    moveSpeed: 3.6, useCover: 0.1, flank: 0, strafe: 0.2, seekPlayer: 0.25, hearing: 20, aggression: 0.3,
    grenades: 0, grenadeChance: 0, grenadeError: 4, dodgeGrenades: 0.3,
    weapons: ['pistol', 'autorifle'],
  },
  medium: {
    id: 'medium', name: 'Medium', botCount: 7, reaction: 0.5, aimError: 0.07, trackRate: 1.2,
    damageMult: 0.75, fireRateMult: 0.8, burst: [3, 6], viewDist: 65, fov: 130,
    moveSpeed: 4.4, useCover: 0.5, flank: 0.25, strafe: 0.6, seekPlayer: 0.55, hearing: 40, aggression: 0.6,
    grenades: 1, grenadeChance: 0.25, grenadeError: 2.5, dodgeGrenades: 0.7,
    weapons: ['pistol', 'autorifle', 'machinegun', 'smg', 'shotgun'],
  },
  hard: {
    id: 'hard', name: 'Hard', botCount: 9, reaction: 0.22, aimError: 0.04, trackRate: 2.4,
    damageMult: 0.95, fireRateMult: 1.0, burst: [4, 9], viewDist: 90, fov: 160,
    moveSpeed: 5.2, useCover: 0.9, flank: 0.6, strafe: 1.0, seekPlayer: 0.9, hearing: 70, aggression: 0.9,
    grenades: 2, grenadeChance: 0.45, grenadeError: 1.2, dodgeGrenades: 1,
    weapons: ['autorifle', 'machinegun', 'sniper', 'dmr', 'smg', 'shotgun'],
  },
};

/** Everyone carries these; they are not bought. Used for killfeed names and damage rules. */
const EQUIPMENT = {
  knife: { id: 'knife', name: 'Knife', damage: 100, range: 2.3, cooldown: 0.75 },
  // Lethal within ~10 m (soft edge to 11 m). Cover still blocks.
  frag: { id: 'frag', name: 'Frag Grenade', lethal: true, maxDamage: 200, innerRadius: 10, radius: 11, fuse: 2.5, speed: 17, perLife: 2 },
  molotov: {
    id: 'molotov', name: 'Molotov', lethal: true, speed: 15, perLife: 2, flight: 4,
    radius: 3.5, duration: 7, dps: 40,
  },
  airstrike: { id: 'airstrike', name: 'Airstrike', maxDamage: 200, innerRadius: 10, radius: 11, bombs: 5, spacing: 5, delay: 2, interval: 0.25 },
};

/** Rewards for kills in a row without dying. Kills made by a reward do not count toward the streak. */
const KILLSTREAKS = {
  uav: { id: 'uav', name: 'UAV', kills: 3, key: '3', duration: 20, description: 'Reveals every enemy on the radar for 20 seconds.' },
  // First ready at 5, again at 15 if the streak keeps going after using the first.
  airstrike: { id: 'airstrike', name: 'Airstrike', kills: [5, 15], key: '4', description: 'A jet drops five bombs in a line where you are aiming. Ready at 5 and again at 15 kills.' },
};

/**
 * Pick one perk per loadout. Passive bonuses, except Trophy which is activated with X.
 * moveMult / sprintMult stack on walk/sprint; regenDelay / regenRate override health recovery.
 */
const PERKS = {
  doubletime: {
    id: 'doubletime', name: 'Double Time', key: null,
    moveMult: 1.12, sprintMult: 1.22,
    description: 'Move and sprint faster. Great for rotating and flanking.',
  },
  quickfix: {
    id: 'quickfix', name: 'Quick Fix', key: null,
    regenDelay: 1.6, regenRate: 55,
    description: 'Health starts regenerating sooner and fills faster after you stop taking damage.',
  },
  trophy: {
    id: 'trophy', name: 'Trophy System', key: 'X',
    trophy: { duration: 8, radius: 7, cooldown: 28 },
    description: 'Press X to deploy a shield that destroys enemy grenades and molotovs nearby for 8 s.',
  },
};

const COINS_PER_KILL = 15;
const HEADSHOT_BONUS = 10;
const STARTING_COINS = 1000;
/** Coins gifted each time a player levels up. */
const LEVEL_UP_COINS = 250;
/** Kills needed while at `level` to reach the next level: L1→30, L2→50, L3→70, … (+20 each). */
function killsNeededAtLevel(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  return 30 + (lv - 1) * 20;
}

/**
 * Shoulder / chest patches. stripes: horizontal bands top→bottom; kurdistan draws a sun on the white band.
 * cost 0 = free “none”; others are permanent unlocks.
 */
const FLAGS = {
  none: { id: 'none', name: 'No Flag', cost: 0, description: 'No national patch on the vest.' },
  kurdistan: {
    id: 'kurdistan', name: 'Kurdistan', cost: 400,
    description: 'Red–white–green with a golden sun. Wear it on your plate carrier.',
    stripes: ['#ce1126', '#ffffff', '#008000'], sun: '#fcb514',
  },
  iraq: {
    id: 'iraq', name: 'Iraq', cost: 300,
    description: 'Iraqi tricolour patch.',
    stripes: ['#ce1126', '#ffffff', '#000000'],
  },
  usa: {
    id: 'usa', name: 'United States', cost: 350,
    description: 'Stars-and-stripes inspired patch (stylized).',
    stripes: ['#b22234', '#ffffff', '#3c3b6e'],
  },
  uk: {
    id: 'uk', name: 'United Kingdom', cost: 350,
    description: 'Union-inspired blue / white / red patch.',
    stripes: ['#012169', '#ffffff', '#c8102e'],
  },
  turkey: {
    id: 'turkey', name: 'Türkiye', cost: 320,
    description: 'Red field with a white crescent mark.',
    stripes: ['#e30a17', '#e30a17', '#e30a17'], mark: '#ffffff',
  },
  germany: {
    id: 'germany', name: 'Germany', cost: 300,
    description: 'Black–red–gold tricolour.',
    stripes: ['#000000', '#dd0000', '#ffce00'],
  },
  france: {
    id: 'france', name: 'France', cost: 300,
    description: 'Blue–white–red (drawn as bands).',
    stripes: ['#002395', '#ffffff', '#ed2939'],
  },
  palestine: {
    id: 'palestine', name: 'Palestine', cost: 320,
    description: 'Black–white–green with a red triangle mark.',
    stripes: ['#000000', '#ffffff', '#007a3d'], triangle: '#ce1126',
  },
  saudi: {
    id: 'saudi', name: 'Saudi Arabia', cost: 340,
    description: 'Green field patch.',
    stripes: ['#006c35', '#006c35', '#006c35'], mark: '#ffffff',
  },
  iran: {
    id: 'iran', name: 'Iran', cost: 320,
    description: 'Green–white–red tricolour.',
    stripes: ['#239f40', '#ffffff', '#da0000'],
  },
  japan: {
    id: 'japan', name: 'Japan', cost: 300,
    description: 'White field with a red disc.',
    stripes: ['#ffffff', '#ffffff', '#ffffff'], sun: '#bc002d',
  },
  brazil: {
    id: 'brazil', name: 'Brazil', cost: 320,
    description: 'Green field with a gold band.',
    stripes: ['#009c3b', '#ffdf00', '#009c3b'],
  },
};

/** Coin top-ups priced in Iraqi dinar. Admin confirms payment, then coins are credited. */
const COIN_PACKS = {
  starter: { id: 'starter', name: 'Starter Pack', coins: 800, iqd: 5000, bonus: 0, description: '800 coins' },
  assault: { id: 'assault', name: 'Assault Pack', coins: 2500, iqd: 12000, bonus: 200, description: '2,500 + 200 bonus' },
  operator: { id: 'operator', name: 'Operator Pack', coins: 6000, iqd: 25000, bonus: 800, description: '6,000 + 800 bonus' },
  legend: { id: 'legend', name: 'Legend Pack', coins: 15000, iqd: 55000, bonus: 3000, description: '15,000 + 3,000 bonus' },
};

/**
 * Local Iraqi payment rails. Numbers can be overridden with env vars
 * (PAY_FIB_PHONE, PAY_NBI_PHONE, …) without code changes.
 */
const PAYMENT_METHODS = {
  fib: {
    id: 'fib', name: 'Fib',
    phone: process.env.PAY_FIB_PHONE || '0750 000 0000',
    hint: 'Open Fib → Transfer to the merchant number → send the transfer ID in chat/order note.',
  },
  nbi: {
    id: 'nbi', name: 'NBI / Mobile Payment',
    phone: process.env.PAY_NBI_PHONE || '0770 000 0000',
    hint: 'Pay via NBI mobile banking to the merchant account, then keep the receipt ID.',
  },
  asiapay: {
    id: 'asiapay', name: 'AsiaPay',
    phone: process.env.PAY_ASIAPAY_PHONE || '0780 000 0000',
    hint: 'Send the IQD amount through AsiaPay to the listed wallet.',
  },
  zaincash: {
    id: 'zaincash', name: 'ZainCash',
    phone: process.env.PAY_ZAINCASH_PHONE || '0781 000 0000',
    hint: 'ZainCash wallet transfer — include your username in the note.',
  },
  fastpay: {
    id: 'fastpay', name: 'FastPay',
    phone: process.env.PAY_FASTPAY_PHONE || '0751 000 0000',
    hint: 'FastPay transfer to merchant, then wait for admin confirmation.',
  },
  qicard: {
    id: 'qicard', name: 'Qi Card',
    phone: process.env.PAY_QICARD_PHONE || '0771 000 0000',
    hint: 'Qi Card / Qi Services transfer. Admin credits coins after verification.',
  },
};

const TDM = {
  scoreLimit: Number(process.env.TDM_SCORE_LIMIT) || 50,
  timeLimitSec: Number(process.env.TDM_TIME_LIMIT) || 600,
  intermissionSec: Number(process.env.TDM_INTERMISSION) || 8,
};

module.exports = {
  WEAPONS, COSMETICS, DIFFICULTY, EQUIPMENT, KILLSTREAKS, PERKS, FLAGS, COIN_PACKS, PAYMENT_METHODS,
  TDM, COINS_PER_KILL, HEADSHOT_BONUS, STARTING_COINS, LEVEL_UP_COINS, killsNeededAtLevel,
};
