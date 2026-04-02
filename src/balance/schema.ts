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
}

export interface CombatSimulationInput {
  constants: BalanceConstants;
  economy: EconomyConfig;
  meta: MetaConfig;
  loadout: CombatLoadout;
  wave: WaveDefinition;
  /**
   * Политика умножения награды за победу по количеству звёзд.
   * Ключи: 1..3. Для defeat и stars=0 применяется 1.
   */
  starRewardPolicy?: StarRewardPolicy;
}

export interface CombatSimulationResult {
  timeToKillSec: number;
  playerHp: number;
  incomingDps: number;
  victory: boolean;
  stars: number;
  /** Отдельная награда за юнитов в волне (сумма enemy.reward * count). */
  killRewardSoft: number;
  /** Отдельная награда за результат волны (база волны * resultMultiplier). */
  waveRewardSoft: number;
  /** Множитель результата: победа/поражение (+ звёзды при победе). */
  resultMultiplier: number;
  rewardSoft: number;
  /** Ожидаемый множитель исходящего DPS из-за промахов/слабых попаданий (economy.combatSkill). */
  outgoingSkillDamageMultiplier?: number;
}

export type StarRewardPolicy = Partial<Record<1 | 2 | 3, number>>;

export type WeaponsIndex = Record<WeaponId, WeaponConfig>;
export type EnemiesIndex = Record<EnemyId, EnemyConfig>;

