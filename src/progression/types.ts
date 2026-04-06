import type { BalanceConstants, WeaponId, EnemyId } from '../balance/model';
import type { WaveDefinition } from '../balance/schema';
import type { ReferenceWavesConfig } from '../balance/referenceWaves';

export type SegmentId = 'free' | 'payer' | 'whale';

export interface WeaponLevels {
  machineGunLevel: number;
  hydraLevel: number;
  hellfireLevel: number;
}

export interface ProgressionState {
  segmentId: SegmentId;
  softBalance: number;
  playerLevel: number;
  weaponLevels: WeaponLevels;
  unlockedWeapons?: {
    machineGun: boolean;
    hydra70: boolean;
    hellfire: boolean;
  };
  deckSlots?: {
    slots: number;
    lifetimeSoftSpent: number;
  };
  /** Софт, потраченный на покупку ракетниц (Hydra/Hellfire) за весь прогон. */
  lifetimeRocketUnlockSoftSpent?: number;
  /** Софт, потраченный на апгрейд оружия за весь прогон (сумма по `weaponOnlyUpgradePolicy`). */
  lifetimeWeaponUpgradeSoftSpent?: number;
  // Support-cards сейчас не влияют на combat-симуляцию (она weapon-only),
  // но для прогноза мы копим expected-value "чертежей" и повышаем уровни карт.
  supportCardLevels: Record<number, number>; // cardId -> level (0..max)
  supportCardBlueprints: Record<number, number>; // cardId -> expected blueprints/cards
}

export interface CombatOutcome {
  victory: boolean;
  stars: number;
  rewardSoft: number;
}

export interface ProgressionStepContext {
  segmentId: SegmentId;
  levelIndex: number;
  waveIndex: number;
  wave: WaveDefinition;
  attemptIndex: number; // 1..N within level
  /**
   * Заполняет симулятор: учесть покупку платных сундуков (ожидаемое число за тик политики).
   */
  recordPaidChestOpens?: (chestId: string, count: number) => void;
}

export type UpgradePolicy = (args: {
  constants: BalanceConstants;
  state: ProgressionState;
  outcome: CombatOutcome;
  ctx: ProgressionStepContext;
}) => ProgressionState;

export interface ProgressionLevelForecast {
  levelIndex: number;
  unitsByEnemyId: Record<EnemyId, number>;
  /**
   * Сумма юнитов в конструкторе волн (если симуляция с `referenceWavesConfig`).
   */
  unitsRawSumFromEditor?: number;
  /**
   * Суммарное HP врагов по всем волнам уровня (baseHp×кол-во, без масштаба от номера уровня).
   */
  totalEnemyHpScaled?: number;
  /**
   * Суммарная «мощь» уровня по волнам: Σ (0,7×requiredDps + 0,3×входящая угроза), как «Сложность уровня» в графике.
   */
  totalEnemyLevelPowerScaled?: number;
  attemptsTotal: number;
  avgRewardPerAttempt: number;
  totalRewardSoft: number;
  endingSoftBalance: number;
  /** Софт на апгрейд оружия, потраченный за прохождение этого игрового уровня. */
  weaponUpgradeSoftSpentOnLevel: number;
  /** Накопленные траты на оружие после этого уровня. */
  weaponUpgradeSoftSpentCumulative: number;
  /** Покупка ракетниц (софт) на этом уровне (может быть 0). */
  rocketUnlockSoftSpentOnLevel?: number;
  /** Накопленные траты софта на покупку ракетниц. */
  rocketUnlockSoftSpentCumulative?: number;
  /** Покупка слотов деки (софт), которая произошла к моменту завершения уровня (может быть 0). */
  deckSlotsSoftSpentOnLevel?: number;
  /** Накопленные траты софта на слоты деки. */
  deckSlotsSoftSpentCumulative?: number;
  /**
   * Календарный день прогноза: номер дня по лимиту meta.forecastMaxAttemptsPerDay попыток в день (по умолч. 10).
   * Не совпадает с ⌊часов/24⌋, если смотреть только ожидание энергии.
   */
  dayReached: number | null;
  finalWeaponLevels: WeaponLevels;
  passed: boolean;
}

export interface ProgressionForecastResult {
  levels: ProgressionLevelForecast[];
  /** Точки прогноза по каждой попытке (сквозной индекс 1..N по всему прогону). */
  attemptsTimeline?: ProgressionAttemptPowerPoint[];
  finalState: ProgressionState;
  /** Сколько софта (EV) добавляется в сутки от платежей сегмента. */
  segmentSoftIncomePerDay?: number;
  /** Сколько харда (золота) добавляется в сутки от доли доната в iap_gold (прогноз). */
  segmentHardIncomePerDay?: number;
  /**
   * Ожидаемое число открытий бесплатных сундуков за прогон (ключ = id из economy.freeChests).
   * Каждый календарный день прогноза: по одному открытию первых meta.forecastFreeChestsPerDay слотов в порядке списка (по умолч. 3).
   */
  expectedFreeChestOpensById?: Record<string, number>;
  /** Ожидаемое число покупок платных сундуков за прогон (ключ = id из economy.chests). */
  expectedPaidChestOpensById?: Record<string, number>;
  /** Суммарные часы ожидания регенера энергии (бесплатные сундуки в прогнозе от этого не считаются). */
  progressionElapsedHours?: number;
  /**
   * Календарные часы прогноза: ожидание энергии + по 24 ч за каждый переход на новый день из‑за лимита попыток/день.
   * Колонка «День прохода» считается по счётчику попыток, не по этой сумме.
   */
  progressionElapsedCalendarHours?: number;
}

export interface ProgressionAttemptPowerPoint {
  attemptOrdinal: number;
  levelIndex: number;
  attemptInLevel: number;
  forecastDay: number;
  /** Интегральная «мощь игрока» в начале попытки (после pre-upgrade). */
  playerPower: number;
  /** Интегральная «сложность уровня» для этой попытки. */
  enemyPower: number;
  powerDelta: number;
  powerRatio: number;
}

export interface ProgressionSimulatorOptions {
  segmentId: SegmentId;
  playerLevel: number;
  referenceWavesConfig?: ReferenceWavesConfig;
  initialWeaponLevels?: Partial<WeaponLevels>;
  initialSoft?: number;
  /** Лимит попыток на уровень (1 попытка = полный проход уровня со всеми волнами). */
  maxAttemptsPerLevel?: number;
  /** Legacy-ключ (обратная совместимость). */
  maxAttemptsPerWave?: number;
  /**
   * Емкость энергии (максимум).
   */
  energyPerLevel?: number;
  /** Сколько энергии тратится на одну попытку (1 попытка = 1 уровень). */
  energyPerAttempt?: number;
  /** Стартовая энергия в начале прогноза. По умолчанию = energyPerLevel. */
  energyStart?: number;
  /** Реген энергии в час. Если 0, энергия не восстанавливается. */
  energyRegenPerHour?: number;
  /**
   * Сколько подряд попыток без изменения состояния разрешать на одной волне
   * перед ранней остановкой "тупик без прогресса".
   * Нужен для реалистичной модели "переигрываний/обучения" и для калибровки
   * диапазонов попыток в автоподборе.
   */
  deadlockRetryCapPerWave?: number;
  /**
   * Рост боевой эффективности на каждой новой попытке волны (ретрай-адаптация).
   * Пример: 0.1 = +10% к DPS на каждую следующую попытку текущей волны.
   */
  retryPowerGainPerAttempt?: number;
  upgradePolicy: UpgradePolicy;
  /**
   * Если задано — симулировать только уровни 1..maxLevelIndex (включительно).
   * По умолчанию — все уровни из meta.gameLevels.
   */
  maxLevelIndex?: number;
}

