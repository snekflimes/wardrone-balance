import type { FormulaAtomsBuilder } from './formulaEvaluator';

export type WeaponId = 'machineGun' | 'hydra70' | 'hellfire';

export type EnemyId =
  | 'infantry'
  | 'rpgInfantry'
  | 'jeep'
  | 'apc'
  | 'lightTank'
  | 'heavyTank'
  | 'mlrs'
  | 'fuelTruck'
  | 'heli'
  | 'plane'
  | 'heavyInfantry';

export interface MetaConfig {
  /**
   * Общий «потолок» для UI/графиков (рекомендуется = max из трёх видов оружия).
   * Отдельные лимиты — maxMachineGunLevel / maxHydraLevel / maxHellfireLevel.
   */
  maxWeaponLevel: number;
  /** Лимит прокачки пулемёта (референс: 100). */
  maxMachineGunLevel?: number;
  /** Лимит Hydra-70 (референс: 40). */
  maxHydraLevel?: number;
  /** Лимит Hellfire (референс: 20). */
  maxHellfireLevel?: number;
  maxPlayerLevel: number;
  gameLevels: number;
  enemyTypes: number;
  baseWaveTimeSec: number;
  /**
   * Расстояние от точки спавна юнитов до VIP (игровые единицы, как range/speed у врагов).
   * Задаёт относительный порядок подхода типов; абсолютные секунды — см. waveThreatEngageMin/MaxSec.
   * Переопределение на тип: enemies.*.spawnDistanceFromVip
   */
  defaultSpawnDistanceFromVip?: number;
  /**
   * Мин. сек до начала урона по VIP для «первых» групп волны (по быстроте подхода).
   * @default 3
   */
  waveThreatEngageMinSec?: number;
  /**
   * Макс. сек до полного вклада «последних» групп волны.
   * @default 6
   */
  waveThreatEngageMaxSec?: number;
  /**
   * Прогноз: максимум попыток уровня на один календарный день оси «День прохода».
   * Каждая попытка (включая провалы) расходует 1 из лимита; на следующий день лимит сбрасывается.
   * При переходе на новый день в модель добавляется номинально 24 ч к календарным часам (без бесплатных сундуков).
   * @default 10
   */
  forecastMaxAttemptsPerDay?: number;
  /**
   * @deprecated Раньше: число бесплатных сундуков за календарный день прогноза. Сейчас бесплатные сундуки
   * открываются по ключам за попытки (`economy.freeChestKeyProgression`); поле сохраняется для старых JSON.
   */
  forecastFreeChestsPerDay?: number;

  /**
   * Трафик: сколько USD в день тратит средний платящий игрок.
   * Используется для сегментного притока софта в прогнозе и для вкладки «Трафик».
   * @default 1.142857 (≈$8/нед)
   */
  trafficUsdPerDayPayer?: number;
  /**
   * Трафик: сколько USD в день тратит средний кит.
   * @default 10.785714 (≈$75.5/нед)
   */
  trafficUsdPerDayWhale?: number;
  /** Трафик: DAU (для расчётов в вкладке «Трафик»). */
  trafficDau?: number;
  /** Трафик: доля платящих среди DAU (0..1). */
  trafficPayerShare?: number;
  /** Трафик: доля китов среди DAU (0..1). */
  trafficWhaleShare?: number;
  /** Трафик: eCPM в USD. @default 6 */
  trafficEcpmUsd?: number;
  /** Трафик: просмотров рекламы на игрока в день. @default 5 */
  trafficViewsPerDay?: number;
  /** Трафик: комиссия маркета (0..1). @default 0.3 */
  trafficMarketFee?: number;
  /** Трафик: роялти/лицензия (0..1). @default 0.3 */
  trafficRoyalty?: number;
  /** Трафик: налоги (0..1). @default 0.06 */
  trafficTaxes?: number;
  /**
   * Сколько боёв подряд в одном прохождении игрового уровня в симуляторе (каждый бой — отдельная выплата по формуле; не множитель базы).
   * @default 2
   */
  wavesPerLevel?: number;
}

export interface WeaponGrowthConfig {
  /**
   * Линейный коэффициент: урон = baseDamage + baseDamage × coeff × levelIndex (levelIndex = 0 на ур.1).
   */
  damageMultiplierPerLevel: number;
  /** Экспоненциальный множитель за шаг: base × pow(mult, levelIndex). */
  fireRateMultiplierPerLevel: number;
  /**
   * Линейный коэффициент для боезапаса (до округления): baseAmmo + baseAmmo × coeff × levelIndex.
   */
  ammoMultiplierPerLevel: number;
}

export interface WeaponConfig {
  id: WeaponId;
  displayName: string;
  baseDamage: number;
  baseFireRatePerMin: number;
  baseAmmo: number;
  /** Базовая цена апгрейда этого оружия в софте (референс: 300/500/800). */
  upgradeBaseSoft?: number;
  /** Множитель роста цены апгрейда для этого оружия (референс: 1.8). */
  upgradeCostMultiplier?: number;
  /**
   * Время перезарядки после магазина (сек), как Constants B105–B107 в референсе.
   * Если не задано — в симуляторе используются дефолты.
   */
  reloadTimeSec?: number;
  growth: WeaponGrowthConfig;
}

export interface WeaponsBlock {
  machineGun: WeaponConfig;
  hydra70: WeaponConfig;
  hellfire: WeaponConfig;
  growth: WeaponGrowthConfig;
}

export interface EnemyConfig {
  id: EnemyId;
  displayName: string;
  baseHp: number;
  /** Урон за выстрел/тик */
  baseDamage: number;
  /** Скорострельность в минуту (для расчёта угрозы в прогнозе) */
  baseFireRatePerMin?: number;
  range: number;
  speed: number;
  /**
   * Расстояние спавна этого типа до VIP. Если не задано — meta.defaultSpawnDistanceFromVip (дефолт симулятора 512).
   */
  spawnDistanceFromVip?: number;
  reward: number;
  /**
   * Доля длительности волны без эффективного огня (разворот, анимация залпа РСЗО и т.п.).
   * Уменьшает вклад во входящий DPS в симуляции. 0..1, по умолчанию 0.
   */
  attackWindupFraction?: number;
  /**
   * Усиление давления на защищаемую цель (камикадзе/таран к VIP). Множитель к вкладу во входящую угрозу.
   * 1 по умолчанию.
   */
  objectivePressureMultiplier?: number;
  /**
   * Модель входящей угрозы в симуляторе:
   * sustained — DPS из baseDamage и baseFireRatePerMin (как стрелок).
   * reach — один удар при подъезде к дистанции (камикадзе); скорострельность не используется, урон = baseDamage×множители.
   */
  threatDelivery?: 'sustained' | 'reach';
}

export type EnemiesBlock = Record<EnemyId, EnemyConfig>;

export interface ChestConfig {
  priceSoft: number;
  /** Цена в золоте (референс: бронза 50, серебро 200, золото 600) */
  priceHard?: number;
  cards: number;
  dropChancesPercent?: {
    common: number;
    uncommon?: number;
    rare: number;
    epic: number;
    legendary: number;
  };
}

export type ChestsBlock = Record<string, ChestConfig>;

export interface UpgradeLevelCost {
  soft: number;
  blueprints: number;
}

export interface EconomyConfig {
  baseMissionReward: number;
  /** Число миссий в одной «сессии» (для средней награды за сессию) */
  missionsPerSession?: number;
  /**
   * Множитель базовой награды при активной подписке/премиуме (прогноз: payer/whale).
   * Итог: база × (премиум ? premiumRewardMultiplier : 1).
   */
  premiumRewardMultiplier: number;
  /**
   * Доля от (база_с_премиумом + награда_за_убийства), начисляемая бонусом за победу. @default 0.75
   */
  victoryBonusMultiplier?: number;
  adMultiplier: number;
  missionsPerPlayerLevel: number;
  cardBaseCost: number;
  cardBaseBonusPercent: number;
  cardSlotsPerLevel: number;
  cardSlotCost: number;
  maxCardSlots: number;
  /** Сколько слотов деки доступно изначально (до покупок). @default 4 */
  startingCardSlots?: number;
  /** Веса редкостей для симулятора сундуков (как в Spreadsheet SimulatorChest). */
  cardRarityWeights?: Partial<Record<CardRarity, number>>;
  chests: ChestsBlock;
  /** Валютные паки для дропа в бесплатных сундуках/ивентах. */
  currencyPacks?: CurrencyPackConfig[];
  /** Бесплатные сундуки: пул дропа (ровно 1 дроп за сундук). Порядок в списке = цикл 1★ → 2★ → 3★ → снова 1★. */
  freeChests?: FreeChestConfig[];
  /** Ключи за попытку уровня (победа/поражение). Если не задано — в прогнозе 1 / 0.5 / 3 ключей. */
  freeChestKeyProgression?: FreeChestKeyProgressionConfig;
  vip: {
    priceHard: number;
  };
  battlePass: {
    priceHard: number;
    levels: number;
    rewardPerLevelSoft: number;
  };
  shopItems: ShopItemConfig[];
  /**
   * Референс: ракетницы сначала недоступны и покупаются за софт.
   * После покупки оружие участвует в бою и может прокачиваться.
   */
  rocketUnlock?: {
    hydra70Soft: number;
    hellfireSoft: number;
  };
  /**
   * Награды за вход (календарь): день -> награда.
   * Начисляется раз в календарный день прогноза.
   */
  loginRewards?: Array<{ day: number; soft: number; hard: number }>;
  /** Референс War Drone: цены в USD для привязки нашей экономики */
  referenceUsd?: {
    vipWeeklyUsd: number;
    /** Типичная цена минимального пакета золота в $ (если известна) */
    minGoldPackUsd?: number;
  };
  /** Наши цены в хард-валюте для якоря: VIP = N золота → 1 золото = referenceUsd.vipWeeklyUsd / N */
  usdAnchor?: {
    vipPriceHard: number;
  };
  /** Референс War Drone: паки золота/софта и сундуки из CSV для сравнения */
  referencePacks?: ReferencePacks;
  /** Референс: средняя награда за одну попытку (в софте). */
  referenceAvgRewardPerAttemptSoft?: number;
  /** Опционально: ручное переопределение нашей средней награды за попытку (в софте). */
  ourAvgRewardPerAttemptSoftOverride?: number;
  /**
   * Стоимость улучшения оружия в софте (лист Weapons, референс):
   * cost = baseSoft[weapon] * POWER(costMultiplier, currentLevel)
   * где currentLevel — текущий уровень оружия перед апгрейдом (1 → апгрейд на 2).
   */
  weaponUpgrade?: {
    costMultiplier: number;
    baseSoft: {
      machineGun: number;
      hydra70: number;
      hellfire: number;
    };
  };
  /**
   * Единая стоимость улучшений по уровням:
   * - soft: цена в софте (для оружия и карточек одинаковая),
   * - blueprints: цена в чертежах (используется только для карточек).
   */
  upgradeCostsByLevel?: Record<string, UpgradeLevelCost>;
  /**
   * Ожидаемая «скиллозависимость» исходящего урона (промахи / слабые попадания).
   * Все значения в процентах 0–100. Модель: DPS *= (1−miss)×((partial%×partialDmg%) + (1−partial%)).
   */
  combatSkill?: {
    missChancePercent?: number;
    partialHitChancePercent?: number;
    /** Сколько процентов от полного урона наносит «слабое» попадание (0–100). */
    partialDamagePercent?: number;
    /**
     * Ожидаемая доля урона reach-угрозы (бензовоз и т.д.), которая всё же достигает VIP,
     * если к моменту взрыва волна уже уничтожена (ошибки приоритета, разброс). 0–100.
     */
    reachLeakPercent?: number;
  };
}

export interface CurrencyPackConfig {
  id: string;
  name: string;
  currency: 'soft' | 'hard';
  amount: number;
  baseWeight: number;
}

export interface FreeChestConfig {
  id: string;
  name: string;
  packIds: string[];
  blueprintRarities: CardRarity[];
}

/** Бесплатные сундуки по прогрессу ключей: победа/поражение за попытку, N ключей → открытие следующего сундука в цикле. */
export interface FreeChestKeyProgressionConfig {
  /** Ключей за победную попытку (весь уровень пройден). @default 1 */
  keysPerWin?: number;
  /** Ключей за проигранную попытку. @default 0.5 */
  keysPerLoss?: number;
  /** Сколько ключей нужно, чтобы открыть один сундук. @default 3 */
  keysToOpenChest?: number;
}

export interface PlayerBlock {
  baseAllyHp: number;
  baseAllyInfantryHp: number;
  baseAllyInfantryDamage: number;
}

export type WeaponVsEnemyModifiers = Record<WeaponId, Partial<Record<EnemyId, number>>>;

export type CardRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface SupportCardGrowthLinear {
  kind: 'linear';
  base: number;
  inc: number;
}

export interface SupportCardGrowthExp {
  kind: 'exp';
  base: number;
  mult: number;
}

export interface SupportCardGrowthConstant {
  kind: 'constant';
  base: number;
}

export interface SupportCardGrowthStep {
  kind: 'step';
  steps: [number, number, number][];
}

export type SupportCardGrowth =
  | SupportCardGrowthLinear
  | SupportCardGrowthExp
  | SupportCardGrowthConstant
  | SupportCardGrowthStep;

export interface SupportCardConfig {
  id: number;
  name: string;
  rarity: CardRarity;
  type: string;
  tableColumns?: string[];
  param1Name: string;
  param2Name: string;
  param1Growth: SupportCardGrowth;
  param2Growth?: SupportCardGrowth;
  /** Уровень, на котором карточка открывается автоматически. */
  unlockAfterLevel?: number;
  /** Сколько чертежей нужно для получения 1-го уровня карточки. */
  firstBlueprints?: number;
  /** Ручная таблица уровней карточки. */
  manualLevels?: SupportCardManualLevel[];
  /** Базовый вес карточки в симуляторе сундуков (Spreadsheet: "Базовый вес"). */
  chestBaseWeight?: number;
}

export interface SupportCardManualLevel {
  level: number;
  values: Record<string, number | null>;
}

export interface CardUpgradeCostRow {
  cards: number;
  uncommon: number;
  common: number;
  rare: number;
  epic: number;
  legendary: number;
}

export type CardUpgradeCostsTable = Record<string, CardUpgradeCostRow>;

export interface ShopItemConfig {
  id: string;
  name: string;
  type: string;
  quantity: number;
  priceSoft: number;
  priceHard: number;
  chestId?: string;
  /** Цена в USD (для IAP-паков из референса) */
  priceUsd?: number;
  /** Базовый вес для вероятностных выборок пакетов/офферов. */
  baseWeight?: number;
}

export interface RefGoldTier {
  usd: number;
  goldBase: number;
  goldBonus: number;
}

export interface RefCashTier {
  usd: number;
  cashBase: number;
  cashBonus: number;
}

export interface RefChestTier {
  usd: number;
  cards: number;
  priceGold: number;
  kit10Gold?: number;
  kit20Gold?: number;
  kit50Gold?: number;
}

export interface RefStarterPack {
  /** Цена набора в золоте (референс War Drone). */
  priceGold: number;
  /** Монеты в наборе (реф. шкала). */
  soft: number;
  /** Число сундуков бронза / серебро / золото по таблице `chests` референса. */
  chestBronze?: number;
  chestSilver?: number;
  chestGold?: number;
}

export interface ReferencePacks {
  goldPerUsd: number;
  /** Монет за $1 по обычной покупке (без акции), якорь для сравнения; согласуй с `cashTiers[].cashBase`. */
  softPerUsd: number;
  softPerGoldRatio: number;
  goldTiers: RefGoldTier[];
  cashTiers: RefCashTier[];
  chests: {
    bronze: RefChestTier;
    silver: RefChestTier;
    gold: RefChestTier;
  };
  /** Набор новичка: цена и содержимое в шкале референса; в игре — `shop_starter_pack` + масштаб и паритет награды. */
  starterPack?: RefStarterPack;
}

/** Кастомные формулы и нодовые конструкторы. Пустое значение = использовать встроенную формулу. */
export interface GameFormulas {
  economy?: {
    missionReward?: string;
  };
  weapons?: {
    damage?: string;
    fireRate?: string;
    ammo?: string;
  };
  builders?: {
    economy?: {
      missionReward?: FormulaAtomsBuilder;
    };
    weapons?: {
      damage?: FormulaAtomsBuilder;
      fireRate?: FormulaAtomsBuilder;
      ammo?: FormulaAtomsBuilder;
    };
  };
}

export interface BalanceConstants {
  meta: MetaConfig;
  player: PlayerBlock;
  weapons: WeaponsBlock;
  economy: EconomyConfig;
  enemies: EnemiesBlock;
  weaponVsEnemyModifiers: WeaponVsEnemyModifiers;
  supportCards: SupportCardConfig[];
  cardUpgradeCosts: CardUpgradeCostsTable;
  /** Переопределение формул из UI (конструктор формул). */
  formulas?: GameFormulas;
}

import constantsJson from '../../balance/constants.json';
import { SUPPORT_CARD_REFERENCE } from './supportCardsReference';

const legacyWeaponGrowth = (constantsJson as any).weapons.growth as WeaponGrowthConfig;

const supportCards = (constantsJson.supportCards as SupportCardConfig[]).map((card) => {
  const reference = SUPPORT_CARD_REFERENCE.find((item) => item.id === card.id);
  return {
    ...card,
    name: reference?.name ?? card.name,
    tableColumns: reference?.tableColumns ?? [],
    manualLevels: reference?.manualLevels ?? [],
  };
});

const machineGun: WeaponConfig = {
  ...(constantsJson as any).weapons.machineGun,
  growth: (constantsJson as any).weapons.machineGun.growth ?? legacyWeaponGrowth,
};
const hydra70: WeaponConfig = {
  ...(constantsJson as any).weapons.hydra70,
  growth: (constantsJson as any).weapons.hydra70.growth ?? legacyWeaponGrowth,
};
const hellfire: WeaponConfig = {
  ...(constantsJson as any).weapons.hellfire,
  growth: (constantsJson as any).weapons.hellfire.growth ?? legacyWeaponGrowth,
};

const weapons: BalanceConstants['weapons'] = {
  machineGun,
  hydra70,
  hellfire,
  growth: legacyWeaponGrowth,
};

export const BALANCE_CONSTANTS: BalanceConstants = {
  ...(constantsJson as unknown as BalanceConstants),
  weapons,
  supportCards,
  enemies: Object.fromEntries(
    Object.entries((constantsJson as unknown as BalanceConstants).enemies).map(([id, enemy]) => {
      const e = { ...enemy } as EnemyConfig;
      if (e.threatDelivery !== 'reach' && e.baseFireRatePerMin == null) {
        e.baseFireRatePerMin = 60;
      }
      return [id, e];
    })
  ) as BalanceConstants['enemies'],
};

if (!BALANCE_CONSTANTS.economy.upgradeCostsByLevel) {
  const fallback: Record<string, UpgradeLevelCost> = {};
  for (const [level, row] of Object.entries(BALANCE_CONSTANTS.cardUpgradeCosts ?? {})) {
    fallback[level] = {
      soft: row.common ?? 0,
      blueprints: row.cards ?? 0,
    };
  }
  BALANCE_CONSTANTS.economy.upgradeCostsByLevel = fallback;
}

