import type {
  BalanceConstants,
  WeaponId,
  EnemyId,
  WeaponConfig,
  EnemyConfig,
  EconomyConfig,
  MetaConfig
} from './model';

export interface WeaponLevelStats {
  weaponId: WeaponId;
  level: number;
  damagePerShot: number;
  fireRatePerMin: number;
  ammo: number;
  dps: number;
  sustainedDps: number;
}

export interface WaveEnemyGroup {
  enemyId: EnemyId;
  count: number;
}

export interface WaveDefinition {
  levelIndex: number; // 1..meta.gameLevels
  waveIndex: number; // 1..N per level
  enemies: WaveEnemyGroup[];
}

export interface WaveStats {
  definition: WaveDefinition;
  totalEnemyHp: number;
  totalEnemyDps: number;
  baseRewardSoft: number;
  requiredDps: number;
}

/** Вклад во входящий DPS волны после подхода с точки спавна к дистанции стрельбы (VIP). */
export interface ThreatEngagementSegment {
  engageAfterSec: number;
  dps: number;
}

/** Разовый урон по VIP/союзникам в момент подъезда (камикадзе), после деления по пулу как у sustained. */
export interface ThreatReachBurst {
  atSec: number;
  damage: number;
}

export interface CombatLoadout {
  playerLevel: number;
  machineGunLevel: number;
  hydraLevel: number;
  hellfireLevel: number;
  /**
   * Доступность оружия в бою (по правилам прогрессии).
   * Если false — оружие не участвует в DPS, даже если его уровень > 0.
   */
  unlockedWeapons?: Partial<Record<WeaponId, boolean>>;
  /**
   * Временный множитель боевой эффективности на текущую попытку.
   * Используется прогнозом для модели "адаптации игрока на ретраях".
   */
  combatPowerMultiplier?: number;
  /**
   * Уровни support-карт (ключ = cardId).
   * Опционально: в бою могут учитываться эффекты карт (например защита).
   */
  supportCardLevels?: Record<number, number>;
  /** Учитывать premiumRewardMultiplier в базовой части награды (прогноз: payer/whale). */
  hasPremiumReward?: boolean;
  /** Прогноз: единый реализм урона (промахи/разброс) из constants.json, без поуровневой таблицы. */
  useForecastCombatCalibration?: boolean;
  /** Прогноз: готовый множитель исходящего урона (из forecastCalibration.ts). */
  forecastOutgoingRealismMultiplier?: number;
}

export interface CombatSimulationInput {
  constants: BalanceConstants;
  economy: EconomyConfig;
  meta: MetaConfig;
  loadout: CombatLoadout;
  wave: WaveDefinition;
}

export interface CombatSimulationResult {
  timeToKillSec: number;
  playerHp: number;
  incomingDps: number;
  victory: boolean;
  stars: number;
  /** Сумма enemy.reward × count по составу волны (входит в итог и при поражении). */
  killRewardSoft: number;
  /** Базовая награда за уровень с учётом премиума (без убийств и без бонуса победы). */
  baseMissionWithPremiumSoft: number;
  /** Бонус за победу (при поражении 0): victoryBonusMultiplier × (baseMissionWithPremiumSoft + killRewardSoft). */
  victoryBonusSoft: number;
  /** База с премиумом + бонус победы (без строки убийств). Историческое имя поля; по смыслу — часть награды за бой. */
  waveRewardSoft: number;
  rewardSoft: number;
  /** Ожидаемый множитель исходящего DPS из-за промахов/слабых попаданий (economy.combatSkill). */
  outgoingSkillDamageMultiplier?: number;
  /** Промахи/слабые попадания × эффективность урона по разнесённым целям (полный множитель, применённый в симуляции). */
  outgoingCombatRealismMultiplier?: number;
}

export type WeaponsIndex = Record<WeaponId, WeaponConfig>;
export type EnemiesIndex = Record<EnemyId, EnemyConfig>;

