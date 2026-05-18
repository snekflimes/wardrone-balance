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
import {
  getKillRewardSoftForWave,
  getMissionRewardSoft,
  getVictoryBonusMultiplier,
  getPremiumRewardMultiplier,
} from './economy';
import type {
  WeaponLevelStats,
  WaveDefinition,
  WaveStats,
  CombatLoadout,
  CombatSimulationInput,
  CombatSimulationResult,
  ThreatEngagementSegment,
  ThreatReachBurst,
} from './schema';
import { simulateCombatWithManaAndSupport } from './supportCardManaCombat';

/** Базовая дистанция спавна: больше → сильнее разводим типы по скорости подхода перед нормализацией в 3–6 с. */
const DEFAULT_SPAWN_DISTANCE_FROM_VIP = 512;

const DEFAULT_WAVE_THREAT_ENGAGE_MIN_SEC = 3;
const DEFAULT_WAVE_THREAT_ENGAGE_MAX_SEC = 6;

function mergeThreatRowsToBuckets(
  rows: { rawTravel: number; dps: number }[],
  lo: number,
  hi: number
): ThreatEngagementSegment[] {
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

function mergeBurstRowsToEvents(
  rows: { rawTravel: number; burstDamage: number }[],
  lo: number,
  hi: number
): ThreatReachBurst[] {
  if (rows.length === 0) return [];
  let rawMin = rows[0]!.rawTravel;
  let rawMax = rows[0]!.rawTravel;
  for (const r of rows) {
    rawMin = Math.min(rawMin, r.rawTravel);
    rawMax = Math.max(rawMax, r.rawTravel);
  }
  const bucketDmg = new Map<number, number>();
  const span = rawMax - rawMin;
  for (const row of rows) {
    let at: number;
    if (span < 1e-6) {
      at = (lo + hi) / 2;
    } else {
      at = lo + ((row.rawTravel - rawMin) / span) * (hi - lo);
    }
    const bucket = Math.round(at * 1000) / 1000;
    bucketDmg.set(bucket, (bucketDmg.get(bucket) ?? 0) + row.burstDamage);
  }
  return [...bucketDmg.entries()]
    .map(([atSec, damage]) => ({ atSec, damage }))
    .sort((a, b) => a.atSec - b.atSec);
}

export interface BuiltWaveThreat {
  sustainedSegments: ThreatEngagementSegment[];
  reachBursts: ThreatReachBurst[];
}

/**
 * Раскладывает угрозу волны по задержкам: порядок по max(0, spawn−range)/speed,
 * абсолютное время — линейно от meta.waveThreatEngageMinSec (первые) до waveThreatEngageMaxSec (последние).
 * reach (камикадзе) даёт разовые всплески урона, без скорострельности.
 */
export function buildWaveThreat(constants: BalanceConstants, wave: WaveDefinition): BuiltWaveThreat {
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

  const sustainedRows: { rawTravel: number; dps: number }[] = [];
  const burstRows: { rawTravel: number; burstDamage: number }[] = [];

  for (const group of wave.enemies) {
    const enemy = constants.enemies[group.enemyId as EnemyId];
    if (!enemy) continue;
    const spawnDist =
      enemy.spawnDistanceFromVip != null && Number.isFinite(enemy.spawnDistanceFromVip)
        ? enemy.spawnDistanceFromVip
        : defaultSpawn;
    const travel = Math.max(0, spawnDist - enemy.range);
    const rawTravel = travel / Math.max(enemy.speed, 1e-3);
    const delivery = enemy.threatDelivery ?? 'sustained';
    if (delivery === 'reach') {
      const burstPerUnit = getEnemyReachBurstDamagePerUnit(enemy);
      burstRows.push({ rawTravel, burstDamage: burstPerUnit * group.count });
    } else {
      const perUnit = getEnemyIncomingThreatPerUnit(enemy);
      sustainedRows.push({ rawTravel, dps: perUnit * group.count });
    }
  }

  return {
    sustainedSegments: mergeThreatRowsToBuckets(sustainedRows, lo, hi),
    reachBursts: mergeBurstRowsToEvents(burstRows, lo, hi),
  };
}

/** @deprecated Используй buildWaveThreat; оставлено для совместимости импортов. */
export function buildThreatEngagementSchedule(
  constants: BalanceConstants,
  wave: WaveDefinition
): ThreatEngagementSegment[] {
  return buildWaveThreat(constants, wave).sustainedSegments;
}

const DEFAULT_RELOAD_SEC: Record<WeaponId, number> = {
  machineGun: 2,
  hydra70: 4,
  hellfire: 6,
};

function clamp01Skill(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Разовый урон reach-юнита при контакте (камикадзе); без скорострельности. */
export function getEnemyReachBurstDamagePerUnit(enemy: EnemyConfig): number {
  const obj = enemy.objectivePressureMultiplier ?? 1;
  let dmg = enemy.baseDamage * obj;
  const windup = enemy.attackWindupFraction ?? 0;
  if (windup > 0) {
    dmg *= Math.max(0.05, 1 - Math.min(1, windup));
  }
  return dmg;
}

/** Вклад одного юнита во входящую угрозу по волне (стрелковый DPS; reach даёт 0 — см. getEnemyReachBurstDamagePerUnit). */
export function getEnemyIncomingThreatPerUnit(enemy: EnemyConfig): number {
  if ((enemy.threatDelivery ?? 'sustained') === 'reach') return 0;
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
 * Вклад волны в «Сложность уровня» на графике прогноза: 0,7×требуемый DPS + 0,3×входящая угроза.
 */
export function getWaveLevelPowerContribution(ws: WaveStats): number {
  return ws.requiredDps * 0.7 + ws.totalEnemyDps * 0.3;
}

/** Мин. «окно подъезда» в секундах (модельные единицы), чтобы не взрывать рейтинг при нулевой дистанции. */
const MIN_APPROACH_TIME_SEC = 0.35;
/** Референс скорости для бонусов к рейтингу (условные ед. как в конфиге врагов). */
const ENEMY_SPEED_REF = 100;
const SPEED_THREAT_FACTOR = 0.14;
const SPEED_SURV_FACTOR = 0.2;

/**
 * Время подъезда с точки спавна до дистанции атаки (range): (spawn − range) / speed.
 * Используется в рейтинге: быстрые юниты сжимают окно реакции.
 */
export function getEnemyApproachTimeSec(constants: BalanceConstants, enemy: EnemyConfig): number {
  const meta = constants.meta;
  const defaultSpawn =
    meta.defaultSpawnDistanceFromVip != null && Number.isFinite(meta.defaultSpawnDistanceFromVip)
      ? meta.defaultSpawnDistanceFromVip
      : DEFAULT_SPAWN_DISTANCE_FROM_VIP;
  const spawnDist =
    enemy.spawnDistanceFromVip != null && Number.isFinite(enemy.spawnDistanceFromVip)
      ? enemy.spawnDistanceFromVip
      : defaultSpawn;
  const travel = Math.max(0, spawnDist - enemy.range);
  const t = travel / Math.max(enemy.speed, 1e-3);
  return Math.max(MIN_APPROACH_TIME_SEC, t);
}

function speedRatingMultiplier(speed: number): number {
  const x = Math.min(Math.max(0, speed) / ENEMY_SPEED_REF, 2.5);
  return 1 + SPEED_SURV_FACTOR * x;
}

function speedThreatMultiplier(speed: number): number {
  const x = Math.min(Math.max(0, speed) / ENEMY_SPEED_REF, 2.5);
  return 1 + SPEED_THREAT_FACTOR * x;
}

/**
 * Рейтинг для конструктора / «Мощь»: выживаемость + угроза.
 * — Подъезд (reach): урон взрыва и HP относятся к окну подъезда, не ко всей волне.
 * — DPS: к входящему DPS добавляется бонус от скорости (раньше начинают стрелять).
 * — Выживаемость sustained: HP/T_волны с бонусом за скорость (сложнее «добить по дороге»).
 */
export function getEnemyLevelPowerBreakdownPerUnit(
  constants: BalanceConstants,
  enemy: EnemyConfig
): { survivabilityPressure: number; threat: number; power: number } {
  const waveSec = constants.meta.baseWaveTimeSec;
  const tClose = getEnemyApproachTimeSec(constants, enemy);
  const delivery = enemy.threatDelivery ?? 'sustained';

  if (delivery === 'reach') {
    const burst = getEnemyReachBurstDamagePerUnit(enemy);
    const threat = burst / tClose;
    const survivabilityPressure = enemy.baseHp / tClose;
    return {
      survivabilityPressure,
      threat,
      power: survivabilityPressure * 0.7 + threat * 0.3,
    };
  }

  const baseDps = getEnemyIncomingThreatPerUnit(enemy);
  const threat = baseDps * speedThreatMultiplier(enemy.speed);

  if (!Number.isFinite(waveSec) || waveSec <= 0) {
    return { survivabilityPressure: 0, threat, power: threat * 0.3 };
  }

  const survivabilityPressure = (enemy.baseHp / waveSec) * speedRatingMultiplier(enemy.speed);
  return {
    survivabilityPressure,
    threat,
    power: survivabilityPressure * 0.7 + threat * 0.3,
  };
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

/** Доля урона стволов, уходящая в эффективное снятие HP при разнесённых целях (не в пул «один босс»). */
export function getSpreadSpatialDamageMultiplier(economy: EconomyConfig): number {
  const skill = economy.combatSkill ?? {};
  const p = skill.spreadSpatialEfficiencyPercent;
  if (p == null || !Number.isFinite(p)) return 1;
  return Math.max(0.05, Math.min(1, p / 100));
}

/**
 * Полный множитель «реализма» исходящего урона стволов в симуляции: промахи/слабые попадания × разброс целей.
 */
export function getOutgoingCombatRealismMultiplier(economy: EconomyConfig): number {
  return Math.max(
    0.02,
    Math.min(1, getOutgoingSkillDamageMultiplier(economy) * getSpreadSpatialDamageMultiplier(economy))
  );
}

/** Прогноз: исходящий урон с калибровкой по уровню (плейтест попыток). */
export function getForecastLevelOutgoingCombatRealism(
  economy: EconomyConfig,
  levelIndex: number
): number {
  const base = getOutgoingCombatRealismMultiplier(economy);
  const table = economy.combatSkill?.forecastCombatRealismByLevel;
  if (!table?.length) return base;
  const idx = Math.max(0, Math.min(table.length - 1, levelIndex - 1));
  const levelMult = table[idx];
  if (levelMult == null || !Number.isFinite(levelMult)) return base;
  return Math.max(0.02, Math.min(1, base * Math.max(0.02, Math.min(1, levelMult))));
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
  const { enemies, meta } = constantsForWaves;

  let totalEnemyHpBase = 0;
  let sustainedDpsSum = 0;
  let reachBurstSum = 0;

  wave.enemies.forEach((group) => {
    const enemy = enemies[group.enemyId as EnemyId];
    if (!enemy) return;
    totalEnemyHpBase += enemy.baseHp * group.count;
    if ((enemy.threatDelivery ?? 'sustained') === 'reach') {
      reachBurstSum += getEnemyReachBurstDamagePerUnit(enemy) * group.count;
    } else {
      sustainedDpsSum += getEnemyIncomingThreatPerUnit(enemy) * group.count;
    }
  });

  // Параметры врагов из конфига (baseHp, baseDamage и т.д.) не масштабируются от номера уровня/волны:
  // сложность задаётся составом волны и типами юнитов.
  const totalEnemyHp = totalEnemyHpBase;
  const waveSec = meta.baseWaveTimeSec;
  const reachAsDps =
    Number.isFinite(waveSec) && waveSec > 0 && reachBurstSum > 0 ? reachBurstSum / waveSec : 0;
  const totalEnemyDps = sustainedDpsSum + reachAsDps;

  const baseRewardSoft = getMissionRewardSoft(constantsForWaves, wave.levelIndex);

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

  const supportCardLevels = input.loadout.supportCardLevels ?? {};

  const getCardValue = (cardId: number, fallbackColumn: string): number => {
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
      baseMissionWithPremiumSoft: 0,
      victoryBonusSoft: 0,
      waveRewardSoft: 0,
      rewardSoft: 0,
      outgoingSkillDamageMultiplier: getOutgoingSkillDamageMultiplier(economy),
      outgoingCombatRealismMultiplier: getOutgoingCombatRealismMultiplier(economy),
    };
  }

  const unlockedWeapons = input.loadout.unlockedWeapons ?? {};
  const isUnlocked = (id: WeaponId) => unlockedWeapons[id] !== false;

  const mg = getWeaponLevelStats(constants, 'machineGun', input.loadout.machineGunLevel);
  const hydra = getWeaponLevelStats(constants, 'hydra70', input.loadout.hydraLevel);
  const hellfire = getWeaponLevelStats(constants, 'hellfire', input.loadout.hellfireLevel);

  const combatPowerMultiplier = Math.max(0.01, input.loadout.combatPowerMultiplier ?? 1);
  const outgoingSkillDamageMultiplier = getOutgoingSkillDamageMultiplier(economy);
  const outgoingCombatRealismMultiplier = input.loadout.useForecastCombatCalibration
    ? getForecastLevelOutgoingCombatRealism(economy, input.wave.levelIndex)
    : getOutgoingCombatRealismMultiplier(economy);

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

  const mgAmmoBonus = getCardValue(10, 'Количество патронов');
  const hydraAmmoBonus = getCardValue(8, 'Количество патронов');
  const hellfireAmmoBonus = getCardValue(9, 'Количество патронов');
  const empDamagePct = getCardValue(12, 'Бонус урона (%)');
  const mgAmmoFactor = mg.ammo > 0 ? 1 + mgAmmoBonus / mg.ammo : 1;
  const hydraAmmoFactor = hydra.ammo > 0 ? 1 + hydraAmmoBonus / hydra.ammo : 1;
  const hellfireAmmoFactor = hellfire.ammo > 0 ? 1 + hellfireAmmoBonus / hellfire.ammo : 1;
  const supportDamageFactor = 1 + Math.max(0, empDamagePct) / 100;

  const playerWeaponDps =
    ((isUnlocked('machineGun') ? mg.sustainedDps * mgAmmoFactor * mgMod : 0) +
      (isUnlocked('hydra70') ? hydra.sustainedDps * hydraAmmoFactor * hydraMod : 0) +
      (isUnlocked('hellfire') ? hellfire.sustainedDps * hellfireAmmoFactor * hellfireMod : 0)) *
    combatPowerMultiplier *
    supportDamageFactor *
    outgoingCombatRealismMultiplier;

  const { sustainedSegments, reachBursts } = buildWaveThreat(constants, input.wave);
  const threatSegments =
    sustainedSegments.length > 0
      ? sustainedSegments
      : waveStats.totalEnemyDps > 0 && reachBursts.length === 0
        ? [{ engageAfterSec: 0, dps: waveStats.totalEnemyDps }]
        : [];

  const mc = simulateCombatWithManaAndSupport({
    constants,
    waveDurationSec: meta.baseWaveTimeSec,
    playerWeaponDps,
    totalEnemyHp: waveStats.totalEnemyHp,
    threatSegments,
    reachBursts,
    vipMaxHp: playerHp,
    supportCardLevels,
    combatPowerMultiplier,
    outgoingCombatRealism: outgoingCombatRealismMultiplier,
    mg,
    hydra,
    hellfire,
    unlocked: {
      machineGun: isUnlocked('machineGun'),
      hydra70: isUnlocked('hydra70'),
      hellfire: isUnlocked('hellfire'),
    },
  });
  const victory = mc.victory;
  const timeToKillSec = mc.victory ? mc.timeToKillSec : Number.POSITIVE_INFINITY;
  const incomingDps = mc.peakVipIncomingDps;

  const missionBase = getMissionRewardSoft(constants, input.wave.levelIndex);
  const hasPrem = input.loadout.hasPremiumReward === true;
  const premMult = hasPrem ? getPremiumRewardMultiplier(economy) : 1;
  const baseMissionWithPremiumSoft = Math.round(missionBase * premMult);
  const killRewardBase = getKillRewardSoftForWave(constants, input.wave);

  let stars = 0;
  if (victory) {
    const waveTime = meta.baseWaveTimeSec;
    if (timeToKillSec <= waveTime * (1 / 3)) stars = 3;
    else if (timeToKillSec <= waveTime * (2 / 3)) stars = 2;
    else stars = 1;
  }

  // Нет частичного добивания по врагам: killReward — по полному составу противников в бою.
  // Поражение: база×премиум + убийства, без бонуса за победу. Победа: + бонус от суммы базы и убийств.
  const killRewardSoft = killRewardBase;
  const vb = getVictoryBonusMultiplier(economy);
  const core = baseMissionWithPremiumSoft + killRewardSoft;
  const victoryBonusSoft = victory ? Math.round(vb * core) : 0;
  const rewardSoft = core + victoryBonusSoft;
  const waveRewardSoft = baseMissionWithPremiumSoft + victoryBonusSoft;

  return {
    timeToKillSec,
    playerHp,
    incomingDps,
    victory,
    stars,
    killRewardSoft,
    baseMissionWithPremiumSoft,
    victoryBonusSoft,
    waveRewardSoft,
    rewardSoft,
    outgoingSkillDamageMultiplier,
    outgoingCombatRealismMultiplier,
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

