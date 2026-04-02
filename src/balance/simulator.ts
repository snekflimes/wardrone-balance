import {
  type BalanceConstants,
  type EconomyConfig,
  type WeaponId,
  type EnemyId,
  type EnemyConfig,
} from './model';
import { getMaxWeaponLevelForWeapon } from './weaponMeta';
import {
  getFormulaExpression,
  evaluateFormula,
} from './formulaEvaluator';
import { getWaveRewardSoft } from './economy';
import type {
  WeaponLevelStats,
  WaveDefinition,
  WaveStats,
  CombatLoadout,
  CombatSimulationInput,
  CombatSimulationResult,
  ThreatEngagementSegment
} from './schema';
import { simulateCombatWithManaAndSupport } from './supportCardManaCombat';

/** Базовая дистанция спавна: больше → сильнее разводим типы по скорости подхода перед нормализацией в 3–6 с. */
const DEFAULT_SPAWN_DISTANCE_FROM_VIP = 512;

const DEFAULT_WAVE_THREAT_ENGAGE_MIN_SEC = 3;
const DEFAULT_WAVE_THREAT_ENGAGE_MAX_SEC = 6;

/**
 * Раскладывает угрозу волны по задержкам: порядок по max(0, spawn−range)/speed,
 * абсолютное время — линейно от meta.waveThreatEngageMinSec (первые) до waveThreatEngageMaxSec (последние).
 */
export function buildThreatEngagementSchedule(
  constants: BalanceConstants,
  wave: WaveDefinition
): ThreatEngagementSegment[] {
  const meta = constants.meta;
  const defaultSpawn =
    meta.defaultSpawnDistanceFromVip != null && Number.isFinite(meta.defaultSpawnDistanceFromVip)
      ? meta.defaultSpawnDistanceFromVip
      : DEFAULT_SPAWN_DISTANCE_FROM_VIP;

  const engageLo =
    meta.waveThreatEngageMinSec != null && Number.isFinite(meta.waveThreatEngageMinSec)
      ? meta.waveThreatEngageMinSec
      : DEFAULT_WAVE_THREAT_ENGAGE_MIN_SEC;
  const engageHi =
    meta.waveThreatEngageMaxSec != null && Number.isFinite(meta.waveThreatEngageMaxSec)
      ? meta.waveThreatEngageMaxSec
      : DEFAULT_WAVE_THREAT_ENGAGE_MAX_SEC;
  const lo = Math.min(engageLo, engageHi);
  const hi = Math.max(engageLo, engageHi);

  const rows: { rawTravel: number; dps: number }[] = [];
  for (const group of wave.enemies) {
    const enemy = constants.enemies[group.enemyId as EnemyId];
    if (!enemy) continue;
    const perUnit = getEnemyIncomingThreatPerUnit(enemy);
    const spawnDist =
      enemy.spawnDistanceFromVip != null && Number.isFinite(enemy.spawnDistanceFromVip)
        ? enemy.spawnDistanceFromVip
        : defaultSpawn;
    const travel = Math.max(0, spawnDist - enemy.range);
    const rawTravel = travel / Math.max(enemy.speed, 1e-3);
    rows.push({ rawTravel, dps: perUnit * group.count });
  }

  if (rows.length === 0) return [];

  let rawMin = rows[0]!.rawTravel;
  let rawMax = rows[0]!.rawTravel;
  for (const r of rows) {
    rawMin = Math.min(rawMin, r.rawTravel);
    rawMax = Math.max(rawMax, r.rawTravel);
  }

  const bucketDps = new Map<number, number>();
  const span = rawMax - rawMin;
  for (const row of rows) {
    let engageAfter: number;
    if (span < 1e-6) {
      engageAfter = (lo + hi) / 2;
    } else {
      engageAfter = lo + ((row.rawTravel - rawMin) / span) * (hi - lo);
    }
    const bucket = Math.round(engageAfter * 1000) / 1000;
    bucketDps.set(bucket, (bucketDps.get(bucket) ?? 0) + row.dps);
  }

  return [...bucketDps.entries()]
    .map(([engageAfterSec, dps]) => ({ engageAfterSec, dps }))
    .sort((a, b) => a.engageAfterSec - b.engageAfterSec);
}

const DEFAULT_RELOAD_SEC: Record<WeaponId, number> = {
  machineGun: 2,
  hydra70: 4,
  hellfire: 6,
};

function clamp01Skill(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Вклад одного юнита во входящую угрозу по волне (учёт залпов, разворота РСЗО, давления на VIP). */
export function getEnemyIncomingThreatPerUnit(enemy: EnemyConfig): number {
  const rpm = enemy.baseFireRatePerMin ?? 60;
  let dps = enemy.baseDamage * (rpm / 60);
  const windup = enemy.attackWindupFraction ?? 0;
  if (windup > 0) {
    dps *= Math.max(0.05, 1 - Math.min(1, windup));
  }
  const obj = enemy.objectivePressureMultiplier ?? 1;
  return dps * obj;
}

/**
 * Ожидаемый множитель исходящего урона при «промах / слабое попадание».
 * miss% — полный ноль урона; среди оставшихся попыток partial% наносят partialDmg% от полного.
 */
export function getOutgoingSkillDamageMultiplier(economy: EconomyConfig): number {
  const skill = economy.combatSkill ?? {};
  const miss = clamp01Skill((skill.missChancePercent ?? 0) / 100);
  const partial = clamp01Skill((skill.partialHitChancePercent ?? 0) / 100);
  const partialDmg = clamp01Skill((skill.partialDamagePercent ?? 50) / 100);
  const hit = 1 - miss;
  const avgOnHit = partial * partialDmg + (1 - partial) * 1;
  return Math.max(0.01, Math.min(1, hit * avgOnHit));
}

export function getWeaponLevelStats(
  constants: BalanceConstants,
  weaponId: WeaponId,
  level: number
): WeaponLevelStats {
  const { weapons, meta } = constants;
  const weapon = weapons[weaponId];
  const growth = weapon.growth ?? weapons.growth;

  const cap = getMaxWeaponLevelForWeapon(constants, weaponId);
  const lvl = Math.max(1, Math.min(level, cap));
  const levelIndex = lvl - 1;

  const scope = {
    baseDamage: weapon.baseDamage,
    damageMultiplierPerLevel: growth.damageMultiplierPerLevel,
    baseFireRatePerMin: weapon.baseFireRatePerMin,
    fireRateMultiplierPerLevel: growth.fireRateMultiplierPerLevel,
    baseAmmo: weapon.baseAmmo,
    ammoMultiplierPerLevel: growth.ammoMultiplierPerLevel,
    levelIndex,
    /** Номер уровня оружия 1…N (для кастомных формул: левел−1 = levelIndex). */
    weaponLevel: lvl,
  };

  const damageExpr = getFormulaExpression(
    constants,
    'weapons',
    'damage',
    'baseDamage + baseDamage * damageMultiplierPerLevel * levelIndex'
  );
  const fireRateExpr = getFormulaExpression(
    constants,
    'weapons',
    'fireRate',
    'baseFireRatePerMin * pow(fireRateMultiplierPerLevel, levelIndex)'
  );
  const ammoExpr = getFormulaExpression(
    constants,
    'weapons',
    'ammo',
    'baseAmmo + baseAmmo * ammoMultiplierPerLevel * levelIndex'
  );

  const damagePerShot = evaluateFormula(damageExpr, scope);
  const fireRatePerMin = evaluateFormula(fireRateExpr, scope);
  const ammo = Math.round(evaluateFormula(ammoExpr, scope));

  const dps = (damagePerShot * fireRatePerMin) / 60;
  const maxDamageOverWave = damagePerShot * ammo;
  const reloadSec =
    weapon.reloadTimeSec != null ? weapon.reloadTimeSec : DEFAULT_RELOAD_SEC[weaponId];
  const shotsPerSec = fireRatePerMin / 60;
  const timeEmptyMagSec = ammo > 0 && shotsPerSec > 0 ? ammo / shotsPerSec : 0;
  const magDamage = damagePerShot * ammo;
  let sustainedDps: number;
  if (reloadSec > 0 && timeEmptyMagSec > 0) {
    // Референс: J = E * I / (I + H), эквивалентно magDamage / (timeEmpty + reload)
    sustainedDps = Math.min(dps, magDamage / (timeEmptyMagSec + reloadSec));
  } else {
    sustainedDps = Math.min(dps, maxDamageOverWave / meta.baseWaveTimeSec);
  }

  return {
    weaponId,
    level: lvl,
    damagePerShot,
    fireRatePerMin,
    ammo,
    dps,
    sustainedDps
  };
}

export function getWaveStats(
  constantsForWaves: BalanceConstants,
  wave: WaveDefinition
): WaveStats {
  const { enemies, economy, meta } = constantsForWaves;

  let totalEnemyHpBase = 0;
  let totalEnemyDpsBase = 0;

  wave.enemies.forEach((group) => {
    const enemy = enemies[group.enemyId as EnemyId];
    if (!enemy) return;
    totalEnemyHpBase += enemy.baseHp * group.count;
    totalEnemyDpsBase += getEnemyIncomingThreatPerUnit(enemy) * group.count;
  });

  // Параметры врагов из конфига (baseHp, baseDamage и т.д.) не масштабируются от номера уровня/волны:
  // сложность задаётся составом волны и типами юнитов.
  const totalEnemyHp = totalEnemyHpBase;
  const totalEnemyDps = totalEnemyDpsBase;

  const baseRewardSoft = getWaveRewardSoft(constantsForWaves, wave.levelIndex, wave.waveIndex);

  const requiredDps = totalEnemyHp / meta.baseWaveTimeSec;

  return {
    definition: wave,
    totalEnemyHp,
    totalEnemyDps,
    baseRewardSoft,
    requiredDps
  };
}

export function simulateCombat(
  constants: BalanceConstants,
  input: Omit<CombatSimulationInput, 'constants' | 'economy' | 'meta'>
): CombatSimulationResult {
  const { player, meta, economy } = constants;

  const supportCardLevels = input.loadout.supportCardLevels;

  const getCardValue = (cardId: number, fallbackColumn: string): number => {
    if (!supportCardLevels) return 0;
    const lvl = supportCardLevels[cardId] ?? 0;
    if (lvl <= 0) return 0;
    const card = constants.supportCards.find((c) => c.id === cardId);
    const row =
      card?.manualLevels?.find((r) => r.level === lvl) ??
      (card?.manualLevels?.slice().sort((a, b) => a.level - b.level).reverse().find((r) => r.level <= lvl) ?? null);
    if (!row) return 0;
    const val = row.values?.[fallbackColumn] ?? row.values?.[card?.param1Name ?? fallbackColumn];
    return typeof val === 'number' ? val : 0;
  };

  // Если по референсу волна пустая (нет данных/состав скрыт) — считаем, что бой не состоялся:
  // победы/звёзд и награды не выдаём.
  if (!input.wave.enemies || input.wave.enemies.length === 0) {
    return {
      timeToKillSec: Number.POSITIVE_INFINITY,
      playerHp: player.baseAllyHp,
      incomingDps: 0,
      victory: false,
      stars: 0,
      killRewardSoft: 0,
      waveRewardSoft: 0,
      resultMultiplier: 0,
      rewardSoft: 0,
      outgoingSkillDamageMultiplier: getOutgoingSkillDamageMultiplier(economy),
    };
  }

  const unlockedWeapons = input.loadout.unlockedWeapons ?? {};
  const isUnlocked = (id: WeaponId) => unlockedWeapons[id] !== false;

  const mg = getWeaponLevelStats(constants, 'machineGun', input.loadout.machineGunLevel);
  const hydra = getWeaponLevelStats(constants, 'hydra70', input.loadout.hydraLevel);
  const hellfire = getWeaponLevelStats(constants, 'hellfire', input.loadout.hellfireLevel);

  const combatPowerMultiplier = Math.max(0.01, input.loadout.combatPowerMultiplier ?? 1);
  const outgoingSkillDamageMultiplier = getOutgoingSkillDamageMultiplier(economy);

  let totalBlendHp = 0;
  const hpByEnemyType: Partial<Record<EnemyId, number>> = {};
  for (const group of input.wave.enemies) {
    const enemy = constants.enemies[group.enemyId as EnemyId];
    if (!enemy) continue;
    const hp = enemy.baseHp * group.count;
    totalBlendHp += hp;
    const id = group.enemyId as EnemyId;
    hpByEnemyType[id] = (hpByEnemyType[id] ?? 0) + hp;
  }
  const weaponModifierBlend = (weaponId: WeaponId): number => {
    if (totalBlendHp <= 0) return 1;
    const table = constants.weaponVsEnemyModifiers[weaponId] ?? {};
    let acc = 0;
    for (const [eid, hp] of Object.entries(hpByEnemyType)) {
      const share = hp / totalBlendHp;
      const mod = table[eid as EnemyId] ?? 1;
      acc += share * mod;
    }
    return acc;
  };
  const mgMod = weaponModifierBlend('machineGun');
  const hydraMod = weaponModifierBlend('hydra70');
  const hellfireMod = weaponModifierBlend('hellfire');

  const waveStats = getWaveStats(constants, input.wave);
  const playerHp = player.baseAllyInfantryHp ?? player.baseAllyHp;

  let timeToKillSec: number;
  let victory: boolean;
  let incomingDps: number;

  if (supportCardLevels !== undefined) {
    const playerWeaponDps =
      ((isUnlocked('machineGun') ? mg.sustainedDps * mgMod : 0) +
        (isUnlocked('hydra70') ? hydra.sustainedDps * hydraMod : 0) +
        (isUnlocked('hellfire') ? hellfire.sustainedDps * hellfireMod : 0)) *
      outgoingSkillDamageMultiplier;

    const threatSegments = buildThreatEngagementSchedule(constants, input.wave);
    const mc = simulateCombatWithManaAndSupport({
      constants,
      waveDurationSec: meta.baseWaveTimeSec,
      playerWeaponDps,
      totalEnemyHp: waveStats.totalEnemyHp,
      threatSegments:
        threatSegments.length > 0
          ? threatSegments
          : waveStats.totalEnemyDps > 0
            ? [{ engageAfterSec: 0, dps: waveStats.totalEnemyDps }]
            : [],
      vipMaxHp: playerHp,
      supportCardLevels,
      combatPowerMultiplier,
      mg,
      hydra,
      hellfire,
      unlocked: {
        machineGun: isUnlocked('machineGun'),
        hydra70: isUnlocked('hydra70'),
        hellfire: isUnlocked('hellfire'),
      },
    });
    victory = mc.victory;
    timeToKillSec = mc.victory ? mc.timeToKillSec : Number.POSITIVE_INFINITY;
    incomingDps = mc.peakVipIncomingDps;
  } else {
    const mgAmmoBonus = getCardValue(10, 'Количество патронов');
    const hydraAmmoBonus = getCardValue(8, 'Количество патронов');
    const hellfireAmmoBonus = getCardValue(9, 'Количество патронов');
    const empDamagePct = getCardValue(12, 'Бонус урона (%)');
    const mgAmmoFactor = mg.ammo > 0 ? 1 + mgAmmoBonus / mg.ammo : 1;
    const hydraAmmoFactor = hydra.ammo > 0 ? 1 + hydraAmmoBonus / hydra.ammo : 1;
    const hellfireAmmoFactor = hellfire.ammo > 0 ? 1 + hellfireAmmoBonus / hellfire.ammo : 1;
    const supportDamageFactor = 1 + Math.max(0, empDamagePct) / 100;

    const incomingDpsReductionFactor = 1;

    const totalDps =
      ((isUnlocked('machineGun') ? mg.sustainedDps * mgAmmoFactor * mgMod : 0) +
        (isUnlocked('hydra70') ? hydra.sustainedDps * hydraAmmoFactor * hydraMod : 0) +
        (isUnlocked('hellfire') ? hellfire.sustainedDps * hellfireAmmoFactor * hellfireMod : 0)) *
      combatPowerMultiplier *
      supportDamageFactor *
      outgoingSkillDamageMultiplier;

    timeToKillSec =
      totalDps > 0 ? waveStats.totalEnemyHp / totalDps : Number.POSITIVE_INFINITY;
    incomingDps =
      (waveStats.totalEnemyDps * incomingDpsReductionFactor) / combatPowerMultiplier;
    victory = timeToKillSec <= meta.baseWaveTimeSec && incomingDps <= playerHp;
  }

  const baseWaveReward = waveStats.baseRewardSoft;
  const killRewardBase = input.wave.enemies.reduce((sum, group) => {
    const enemyCfg = constants.enemies[group.enemyId];
    const perEnemyReward = enemyCfg?.reward ?? 0;
    return sum + perEnemyReward * group.count;
  }, 0);
  const lossPenalty = (economy.lossPenaltyPercent ?? 15) / 100;

  let stars = 0;
  if (victory) {
    const waveTime = meta.baseWaveTimeSec;
    if (timeToKillSec <= waveTime * (1 / 3)) stars = 3;
    else if (timeToKillSec <= waveTime * (2 / 3)) stars = 2;
    else stars = 1;
  }

  const defaultStarPolicy: Required<Record<1 | 2 | 3, number>> = {
    1: 1,
    2: 1.25,
    3: 1.5,
  };
  const policy = input.starRewardPolicy ?? defaultStarPolicy;
  const starMultiplier = stars > 0 ? (policy[stars as 1 | 2 | 3] ?? 1) : 1;
  const resultMultiplier = victory ? starMultiplier : (1 - lossPenalty);
  // В текущей модели симуляции нет частичного "добивания" волны по врагам.
  // Чтобы не было бесконечного фарма на повторных поражениях, награду за юнитов
  // выдаём только за успешное завершение волны.
  const killRewardSoft = victory ? killRewardBase : 0;
  const waveRewardSoft = baseWaveReward * resultMultiplier;
  const rewardSoft = killRewardSoft + waveRewardSoft;

  return {
    timeToKillSec,
    playerHp,
    incomingDps,
    victory,
    stars,
    killRewardSoft,
    waveRewardSoft,
    resultMultiplier,
    rewardSoft,
    outgoingSkillDamageMultiplier,
  };
}

export function buildExampleWave(
  levelIndex: number,
  waveIndex: number
): WaveDefinition {
  const multip = 1 + (levelIndex - 1) * 0.3;

  const infantryCount = Math.round(5 * multip + waveIndex * 2);
  const jeepCount = Math.round(2 * multip + waveIndex);
  const apcCount = Math.max(0, Math.round((levelIndex - 1) / 2));

  return {
    levelIndex,
    waveIndex,
    enemies: [
      { enemyId: 'infantry', count: infantryCount },
      { enemyId: 'jeep', count: jeepCount },
      { enemyId: 'apc', count: apcCount }
    ]
  };
}

