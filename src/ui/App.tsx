import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BALANCE_CONSTANTS,
  type BalanceConstants,
  type ChestConfig,
  type EnemyConfig,
  type EnemyId,
  type WeaponId,
} from '../balance/model';
import { getWeaponLevelStats, simulateCombat } from '../balance/simulator';
import { getReferenceWaveFromConfig } from '../balance/referenceWaves';
import { getMaxWeaponLevelForWeapon } from '../balance/weaponMeta';
import { Charts } from './Charts';
import { EconomyPanel } from './EconomyPanel';
import { FormulasPanel } from './FormulasPanel';
import { WeaponCardsPanel } from './WeaponCardsPanel';
import { ShopPanel } from './ShopPanel';
import { TrafficPanel } from './TrafficPanel';
import {
  ProgressionForecastPanel,
  type ForecastUiState,
  type SavedTunePreset,
} from './ProgressionForecastPanel';
import { LevelsConstructorPanel } from './LevelsConstructorPanel';
import type { ReferenceWavesConfig } from '../balance/referenceWaves';
import { getDefaultReferenceWavesConfig, migrateReferenceWavesConfig } from '../balance/referenceWaves';
import type { SegmentId } from '../progression/types';

type TabId = 'combat' | 'economy' | 'weapons' | 'shop' | 'formulas' | 'charts' | 'traffic' | 'forecast' | 'levels';

/** JSON.stringify с сортировкой ключей — надёжное сравнение снимков после hydrate/parse. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function createDefaultForecastUiState(gameLevels = 15): ForecastUiState {
  const tuneTargets: Record<number, number> = {};
  const tuneAttemptRanges: Record<number, { min: number; max: number }> = {};
  for (let level = 1; level <= gameLevels; level += 1) {
    tuneTargets[level] = level <= 3 ? 100 : Math.max(25, 100 - (level - 3) * 6);
    tuneAttemptRanges[level] = level <= 3 ? { min: 2, max: 2 } : { min: 3 + (level - 4), max: 5 + (level - 4) * 2 };
  }
  return {
    maxAttemptsPerLevel: 200,
    energyPerLevel: 100,
    energyStart: 100,
    energyPerAttempt: 1,
    energyRegenPerHour: 10,
    tuneTargets,
    tuneMode: 'pass_rate',
    selectedPreset: 'onboarding',
    tuneAttemptRanges,
    presetName: 'Мой пресет',
    savedPresets: {},
    selectedSavedPreset: '',
    autoApplyOnLoadPreset: true,
    bulkPassFrom: 100,
    bulkPassTo: 25,
    bulkMinFrom: 2,
    bulkMinTo: 10,
    bulkMaxFrom: 2,
    bulkMaxTo: 25,
    fillDownFromLevel: 1,
    fillDownPassValue: 100,
    fillDownMinValue: 2,
    fillDownMaxValue: 2,
  };
}

function normalizeForecastUiState(
  raw: Partial<ForecastUiState> | undefined,
  gameLevels: number
): ForecastUiState {
  const base = createDefaultForecastUiState(gameLevels);
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    tuneTargets: raw.tuneTargets ?? base.tuneTargets,
    tuneAttemptRanges: raw.tuneAttemptRanges ?? base.tuneAttemptRanges,
    savedPresets: raw.savedPresets ?? base.savedPresets,
  };
}

/** Раньше пресеты автотюна жили только в localStorage — подмешиваем к данным из БД (ключи из БД перекрывают legacy). */
const LEGACY_TUNE_PRESETS_STORAGE_KEY = 'war-drone-tune-presets-v1';
const LOCAL_PERSISTENCE_STORAGE_KEY = 'war-drone-balance-snapshot-v1';

function readLegacyTunePresetsFromLocalStorage(): Record<string, SavedTunePreset> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_TUNE_PRESETS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, SavedTunePreset>;
  } catch {
    return null;
  }
}

function readLocalPersistenceSnapshot():
  | {
      balance?: Partial<BalanceConstants>;
      referenceWavesConfig?: ReferenceWavesConfig;
      uiState?: {
        activeForecastPresetName?: string;
        forecastSegmentId?: SegmentId;
        forecastUiState?: ForecastUiState;
      };
    }
  | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_PERSISTENCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as any;
  } catch {
    return null;
  }
}

function writeLocalPersistenceSnapshot(snapshot: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_PERSISTENCE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore quota / privacy mode
  }
}

/** Объединяет пресеты: legacy (localStorage), поверх — из state (БД). */
function mergeLegacyForecastUiState(state: ForecastUiState): ForecastUiState {
  const legacyPresets = readLegacyTunePresetsFromLocalStorage();
  if (!legacyPresets || Object.keys(legacyPresets).length === 0) return state;
  return {
    ...state,
    savedPresets: { ...legacyPresets, ...state.savedPresets },
  };
}

function forecastUiStateFromDb(
  raw: Partial<ForecastUiState> | undefined,
  gameLevels: number
): ForecastUiState {
  return mergeLegacyForecastUiState(normalizeForecastUiState(raw, gameLevels));
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'combat', label: 'Бой' },
  { id: 'economy', label: 'Экономика' },
  { id: 'weapons', label: 'Оружие и карты' },
  { id: 'shop', label: 'Сундуки и магазин' },
  { id: 'formulas', label: 'Формулы' },
  { id: 'charts', label: 'Графики' },
  { id: 'traffic', label: 'Трафик' },
  { id: 'forecast', label: 'Прогноз' },
  { id: 'levels', label: 'Уровни' },
];

/** Снимок для сохранения в БД и сравнения «грязного» состояния. */
function buildPersistenceSnapshot(
  balance: BalanceConstants,
  referenceWavesConfig: ReferenceWavesConfig,
  ui: {
    activeForecastPresetName: string;
    forecastSegmentId: SegmentId;
    forecastUiState: ForecastUiState;
  }
) {
  return {
    balance,
    referenceWavesConfig,
    uiState: {
      activeForecastPresetName: ui.activeForecastPresetName,
      forecastSegmentId: ui.forecastSegmentId,
      forecastUiState: ui.forecastUiState,
    },
  };
}

function mergeWeaponVsEnemyModifiers(
  def: BalanceConstants['weaponVsEnemyModifiers'],
  raw?: Partial<BalanceConstants['weaponVsEnemyModifiers']>
): BalanceConstants['weaponVsEnemyModifiers'] {
  const wids: WeaponId[] = ['machineGun', 'hydra70', 'hellfire'];
  const out = {} as BalanceConstants['weaponVsEnemyModifiers'];
  for (const wid of wids) {
    const dRow = { ...(def[wid] as Record<string, number>) };
    const rRow = { ...(raw?.[wid] as Record<string, number> | undefined) };
    const row: Record<string, number> = { ...dRow, ...rRow };
    if (row.tank != null && row.heavyTank == null) {
      row.heavyTank = row.tank;
    }
    delete row.tank;
    out[wid] = row as BalanceConstants['weaponVsEnemyModifiers'][typeof wid];
  }
  return out;
}

function hydrateBalance(raw?: Partial<BalanceConstants> | null): BalanceConstants {
  const mergedCards = BALANCE_CONSTANTS.supportCards.map((defaultCard) => {
    const storedCard = raw?.supportCards?.find((card) => card.id === defaultCard.id);
    const storedManualLevels = storedCard?.manualLevels;
    const hasModernManualLevels =
      Array.isArray(storedManualLevels) &&
      storedManualLevels.length > 0 &&
      typeof storedManualLevels[0] === 'object' &&
      storedManualLevels[0] !== null &&
      'values' in storedManualLevels[0];

    return {
      ...defaultCard,
      ...(storedCard ?? {}),
      tableColumns: defaultCard.tableColumns,
      manualLevels: hasModernManualLevels ? storedManualLevels : defaultCard.manualLevels,
    };
  });

  const mergedWeapons = {
    machineGun: {
      ...BALANCE_CONSTANTS.weapons.machineGun,
      ...(raw?.weapons?.machineGun ?? {}),
      growth: raw?.weapons?.machineGun?.growth ?? BALANCE_CONSTANTS.weapons.machineGun.growth,
    },
    hydra70: {
      ...BALANCE_CONSTANTS.weapons.hydra70,
      ...(raw?.weapons?.hydra70 ?? {}),
      growth: raw?.weapons?.hydra70?.growth ?? BALANCE_CONSTANTS.weapons.hydra70.growth,
    },
    hellfire: {
      ...BALANCE_CONSTANTS.weapons.hellfire,
      ...(raw?.weapons?.hellfire ?? {}),
      growth: raw?.weapons?.hellfire?.growth ?? BALANCE_CONSTANTS.weapons.hellfire.growth,
    },
    growth: raw?.weapons?.growth ?? BALANCE_CONSTANTS.weapons.growth,
  } as BalanceConstants['weapons'];

  const mergedCardUpgradeCosts = Object.fromEntries(
    Object.entries(BALANCE_CONSTANTS.cardUpgradeCosts).map(([level, defaultRow]) => [
      level,
      {
        ...defaultRow,
        ...(raw?.cardUpgradeCosts?.[level] ?? {}),
      },
    ])
  ) as BalanceConstants['cardUpgradeCosts'];

  const merged = {
    ...BALANCE_CONSTANTS,
    ...(raw ?? {}),
    weapons: mergedWeapons,
    cardUpgradeCosts: mergedCardUpgradeCosts,
    supportCards: mergedCards,
  } as BalanceConstants;

  const defEnemies = BALANCE_CONSTANTS.enemies;
  const rawEnemyRec = (raw?.enemies ?? {}) as Record<string, EnemyConfig>;
  const legacyTankEnemy = rawEnemyRec.tank;
  const mergedEnemies = { ...defEnemies } as BalanceConstants['enemies'];
  (Object.keys(defEnemies) as EnemyId[]).forEach((id) => {
    const stored = rawEnemyRec[id];
    mergedEnemies[id] = {
      ...defEnemies[id],
      ...(stored ?? {}),
      id,
      displayName: defEnemies[id].displayName,
    };
  });
  if (legacyTankEnemy && rawEnemyRec.heavyTank == null) {
    mergedEnemies.heavyTank = {
      ...mergedEnemies.heavyTank,
      ...legacyTankEnemy,
      id: 'heavyTank',
      displayName: defEnemies.heavyTank.displayName,
    };
  }
  merged.enemies = mergedEnemies;
  merged.weaponVsEnemyModifiers = mergeWeaponVsEnemyModifiers(
    BALANCE_CONSTANTS.weaponVsEnemyModifiers,
    raw?.weaponVsEnemyModifiers
  );

  // Миграция: после перехода на 3 сундука удаляем legacy legendary
  // из конфига сундуков и из позиций магазина, включая старый localStorage.
  if (merged.economy?.chests?.legendary) {
    const { legendary: _removed, ...rest } = merged.economy.chests as Record<string, any>;
    merged.economy.chests = rest;
  }
  // Сохранённый economy из API/localStorage перекрывал весь блок — цены магазина/сундуков
  // не обновлялись при правках balance/constants.json. Подмешиваем дефолты поверх сохранённого.
  const stChests = { ...(merged.economy.chests ?? {}) } as Record<string, ChestConfig>;
  const defChests = BALANCE_CONSTANTS.economy.chests ?? {};
  const chestMerged: Record<string, ChestConfig> = { ...stChests };
  for (const id of Object.keys(defChests)) {
    const def = defChests[id];
    if (def) chestMerged[id] = { ...(stChests[id] ?? {}), ...def };
  }
  merged.economy.chests = chestMerged as BalanceConstants['economy']['chests'];

  const filteredShopItems = (merged.economy.shopItems ?? []).filter(
    (item) => item.chestId !== 'legendary' && item.id !== 'shop_legendary_chest'
  );
  const defaultShopItems = BALANCE_CONSTANTS.economy.shopItems ?? [];
  const storedShopById = new Map(filteredShopItems.map((it) => [it.id, it] as const));
  merged.economy.shopItems = [
    ...defaultShopItems.map((defItem) => {
      const s = storedShopById.get(defItem.id);
      return s ? { ...s, ...defItem } : { ...defItem };
    }),
    ...filteredShopItems.filter((s) => !defaultShopItems.some((d) => d.id === s.id)),
  ];

  // Миграция: если пользователь ранее сохранил gameLevels=7, а в текущем проекте уже 10,
  // обновляем до актуального значения, чтобы UI/прогноз не "застревали" на старой версии.
  const defaultGameLevels = BALANCE_CONSTANTS.meta.gameLevels;
  merged.meta.gameLevels = defaultGameLevels;
  merged.meta.enemyTypes = BALANCE_CONSTANTS.meta.enemyTypes;

  if (!merged.economy.upgradeCostsByLevel) {
    merged.economy.upgradeCostsByLevel = Object.fromEntries(
      Object.entries(merged.cardUpgradeCosts ?? {}).map(([level, row]) => [
        level,
        {
          soft: row.common ?? 0,
          blueprints: row.cards ?? 0,
        },
      ])
    );
  }

  // Миграция сундуков: старый формат хранил "шансы %" (70/25/4.5/0.5),
  // новый формат хранит коэффициенты из CSV SimulatorChest.
  const defaultChestConfig = BALANCE_CONSTANTS.economy.chests;
  for (const chestId of Object.keys(merged.economy.chests ?? {})) {
    const chest = merged.economy.chests[chestId];
    const drops = chest?.dropChancesPercent;
    const looksLikeLegacyPercent =
      !!drops &&
      drops.uncommon == null &&
      (drops.common ?? 0) > 5;
    if (looksLikeLegacyPercent && defaultChestConfig[chestId]?.dropChancesPercent) {
      merged.economy.chests[chestId] = {
        ...chest,
        dropChancesPercent: { ...defaultChestConfig[chestId].dropChancesPercent },
      };
    }
  }
  if (!merged.economy.cardRarityWeights) {
    merged.economy.cardRarityWeights = { ...(BALANCE_CONSTANTS.economy.cardRarityWeights ?? {}) };
  }
  merged.economy.combatSkill = {
    ...(BALANCE_CONSTANTS.economy.combatSkill ?? {}),
    ...(merged.economy.combatSkill ?? {}),
  };
  if (merged.economy.referenceAvgRewardPerAttemptSoft == null) {
    merged.economy.referenceAvgRewardPerAttemptSoft =
      BALANCE_CONSTANTS.economy.referenceAvgRewardPerAttemptSoft ?? 0;
  }
  // Гарантируем наличие новых блоков после миграций.
  const defaultPacks = BALANCE_CONSTANTS.economy.currencyPacks ?? [];
  const storedPacks = merged.economy.currencyPacks ?? [];
  const packIds = new Set(storedPacks.map((p) => p.id));
  merged.economy.currencyPacks = [
    ...storedPacks,
    ...defaultPacks.filter((p) => !packIds.has(p.id)),
  ];

  const defaultFreeChests = BALANCE_CONSTANTS.economy.freeChests ?? [];
  const storedFreeChests = merged.economy.freeChests ?? [];
  const freeChestIds = new Set(storedFreeChests.map((c) => c.id));
  merged.economy.freeChests = [
    ...storedFreeChests,
    ...defaultFreeChests.filter((c) => !freeChestIds.has(c.id)),
  ];

  // Миграция: новые блоки экономики могли "пропасть", если когда-то сохранённый economy
  // целиком перезаписал дефолты. Подмешиваем дефолты точечно.
  if (!merged.economy.rocketUnlock && BALANCE_CONSTANTS.economy.rocketUnlock) {
    merged.economy.rocketUnlock = { ...BALANCE_CONSTANTS.economy.rocketUnlock };
  }
  if ((!merged.economy.loginRewards || merged.economy.loginRewards.length === 0) && BALANCE_CONSTANTS.economy.loginRewards) {
    merged.economy.loginRewards = [...BALANCE_CONSTANTS.economy.loginRewards];
  }
  if (merged.economy.startingCardSlots == null && BALANCE_CONSTANTS.economy.startingCardSlots != null) {
    merged.economy.startingCardSlots = BALANCE_CONSTANTS.economy.startingCardSlots;
  }

  if (BALANCE_CONSTANTS.economy.referencePacks) {
    merged.economy.referencePacks = {
      ...(merged.economy.referencePacks ?? {}),
      ...BALANCE_CONSTANTS.economy.referencePacks,
    };
  }

  const defMeta = BALANCE_CONSTANTS.meta;
  if (merged.meta.maxMachineGunLevel == null) {
    merged.meta.maxMachineGunLevel = defMeta.maxMachineGunLevel ?? merged.meta.maxWeaponLevel;
  }
  if (merged.meta.maxHydraLevel == null) {
    merged.meta.maxHydraLevel = defMeta.maxHydraLevel ?? merged.meta.maxWeaponLevel;
  }
  if (merged.meta.maxHellfireLevel == null) {
    merged.meta.maxHellfireLevel = defMeta.maxHellfireLevel ?? merged.meta.maxWeaponLevel;
  }
  if (merged.meta.forecastFreeChestsPerDay == null && defMeta.forecastFreeChestsPerDay != null) {
    merged.meta.forecastFreeChestsPerDay = defMeta.forecastFreeChestsPerDay;
  }
  if (merged.meta.trafficUsdPerDayPayer == null && defMeta.trafficUsdPerDayPayer != null) {
    merged.meta.trafficUsdPerDayPayer = defMeta.trafficUsdPerDayPayer;
  }
  if (merged.meta.trafficUsdPerDayWhale == null && defMeta.trafficUsdPerDayWhale != null) {
    merged.meta.trafficUsdPerDayWhale = defMeta.trafficUsdPerDayWhale;
  }
  if (merged.meta.trafficDau == null && defMeta.trafficDau != null) {
    merged.meta.trafficDau = defMeta.trafficDau;
  }
  if (merged.meta.trafficPayerShare == null && defMeta.trafficPayerShare != null) {
    merged.meta.trafficPayerShare = defMeta.trafficPayerShare;
  }
  if (merged.meta.trafficWhaleShare == null && defMeta.trafficWhaleShare != null) {
    merged.meta.trafficWhaleShare = defMeta.trafficWhaleShare;
  }
  if (merged.meta.trafficEcpmUsd == null && defMeta.trafficEcpmUsd != null) {
    merged.meta.trafficEcpmUsd = defMeta.trafficEcpmUsd;
  }
  if (merged.meta.trafficViewsPerDay == null && defMeta.trafficViewsPerDay != null) {
    merged.meta.trafficViewsPerDay = defMeta.trafficViewsPerDay;
  }
  if (merged.meta.trafficMarketFee == null && defMeta.trafficMarketFee != null) {
    merged.meta.trafficMarketFee = defMeta.trafficMarketFee;
  }
  if (merged.meta.trafficRoyalty == null && defMeta.trafficRoyalty != null) {
    merged.meta.trafficRoyalty = defMeta.trafficRoyalty;
  }
  if (merged.meta.trafficTaxes == null && defMeta.trafficTaxes != null) {
    merged.meta.trafficTaxes = defMeta.trafficTaxes;
  }
  // Миграция апгрейда оружия: переносим базу/множитель стоимости из legacy economy.weaponUpgrade
  // в поля конкретного оружия.
  const legacyWeaponUpgrade = merged.economy.weaponUpgrade ?? BALANCE_CONSTANTS.economy.weaponUpgrade;
  const getLegacyBase = (id: 'machineGun' | 'hydra70' | 'hellfire') =>
    id === 'machineGun'
      ? legacyWeaponUpgrade?.baseSoft?.machineGun
      : id === 'hydra70'
        ? legacyWeaponUpgrade?.baseSoft?.hydra70
        : legacyWeaponUpgrade?.baseSoft?.hellfire;
  const getDefaultWeaponUpgrade = (id: 'machineGun' | 'hydra70' | 'hellfire') =>
    BALANCE_CONSTANTS.weapons[id].upgradeBaseSoft ??
    (id === 'machineGun' ? 300 : id === 'hydra70' ? 500 : 800);
  const getDefaultMult = (id: 'machineGun' | 'hydra70' | 'hellfire') =>
    BALANCE_CONSTANTS.weapons[id].upgradeCostMultiplier ?? 0.8;

  merged.weapons = {
    ...merged.weapons,
    machineGun: {
      ...merged.weapons.machineGun,
      upgradeBaseSoft:
        merged.weapons.machineGun.upgradeBaseSoft ??
        getLegacyBase('machineGun') ??
        getDefaultWeaponUpgrade('machineGun'),
      upgradeCostMultiplier:
        merged.weapons.machineGun.upgradeCostMultiplier ??
        (legacyWeaponUpgrade?.costMultiplier != null
          ? legacyWeaponUpgrade.costMultiplier > 1
            ? legacyWeaponUpgrade.costMultiplier - 1
            : legacyWeaponUpgrade.costMultiplier
          : undefined) ??
        getDefaultMult('machineGun'),
    },
    hydra70: {
      ...merged.weapons.hydra70,
      upgradeBaseSoft:
        merged.weapons.hydra70.upgradeBaseSoft ??
        getLegacyBase('hydra70') ??
        getDefaultWeaponUpgrade('hydra70'),
      upgradeCostMultiplier:
        merged.weapons.hydra70.upgradeCostMultiplier ??
        (legacyWeaponUpgrade?.costMultiplier != null
          ? legacyWeaponUpgrade.costMultiplier > 1
            ? legacyWeaponUpgrade.costMultiplier - 1
            : legacyWeaponUpgrade.costMultiplier
          : undefined) ??
        getDefaultMult('hydra70'),
    },
    hellfire: {
      ...merged.weapons.hellfire,
      upgradeBaseSoft:
        merged.weapons.hellfire.upgradeBaseSoft ??
        getLegacyBase('hellfire') ??
        getDefaultWeaponUpgrade('hellfire'),
      upgradeCostMultiplier:
        merged.weapons.hellfire.upgradeCostMultiplier ??
        (legacyWeaponUpgrade?.costMultiplier != null
          ? legacyWeaponUpgrade.costMultiplier > 1
            ? legacyWeaponUpgrade.costMultiplier - 1
            : legacyWeaponUpgrade.costMultiplier
          : undefined) ??
        getDefaultMult('hellfire'),
    },
  };

  // Важно: не вычитаем 1 из коэффициентов при каждой гидратации.
  // Раньше здесь была «миграция» вида (1.005; 2) → v-1 для цены и роста урона/боезапаса;
  // легитимные линейные значения вроде 1.1 превращались в 0.1 после каждого «Сохранить» + перезагрузки.

  return merged;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('combat');
  const [balance, setBalance] = useState<BalanceConstants>(BALANCE_CONSTANTS);
  const [storageReady, setStorageReady] = useState(false);

  const [referenceWavesConfig, setReferenceWavesConfig] = useState<ReferenceWavesConfig>(
    getDefaultReferenceWavesConfig()
  );
  const [referenceWavesRevision, setReferenceWavesRevision] = useState(0);
  const [playerLevel, setPlayerLevel] = useState(1);
  const [mgLevel, setMgLevel] = useState(1);
  const [hydraLevel, setHydraLevel] = useState(1);
  const [hellfireLevel, setHellfireLevel] = useState(1);
  const [levelIndex, setLevelIndex] = useState(1);
  const [waveIndex, setWaveIndex] = useState(1);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  /** JSON последнего загруженного/сохранённого состояния (совпадает с телом POST). */
  const [lastSavedSerialized, setLastSavedSerialized] = useState('');
  const [activeForecastPresetName, setActiveForecastPresetName] = useState<string>('');
  const [forecastSegmentId, setForecastSegmentId] = useState<SegmentId>('free');
  const [forecastUiState, setForecastUiState] = useState<ForecastUiState>(() =>
    forecastUiStateFromDb(undefined, BALANCE_CONSTANTS.meta.gameLevels)
  );
  const updateForecastUiState = useCallback((next: ForecastUiState) => {
    setForecastUiState((prev) => {
      const normalizedNext = normalizeForecastUiState(next, balance.meta.gameLevels);
      const prevSerialized = JSON.stringify(prev);
      const nextSerialized = JSON.stringify(normalizedNext);
      return prevSerialized === nextSerialized ? prev : normalizedNext;
    });
  }, [balance.meta.gameLevels]);

  const loadFromDb = async () => {
    const defaults = getDefaultReferenceWavesConfig();

    const applyLoaded = (
      balanceRaw: Partial<BalanceConstants> | undefined,
      waves: ReferenceWavesConfig | undefined,
      uiFromDb:
        | {
            activeForecastPresetName?: string;
            forecastSegmentId?: SegmentId;
            forecastUiState?: ForecastUiState;
          }
        | undefined
    ) => {
      const balanceNext = hydrateBalance(balanceRaw);
      const wavesNext = migrateReferenceWavesConfig(waves ?? defaults);
      const nameNext = uiFromDb?.activeForecastPresetName ?? '';
      const segmentNext = uiFromDb?.forecastSegmentId ?? 'free';
      const forecastNext = forecastUiStateFromDb(
        uiFromDb?.forecastUiState,
        balanceNext.meta.gameLevels
      );
      setBalance(balanceNext);
      setReferenceWavesConfig(wavesNext);
      setActiveForecastPresetName(nameNext);
      setForecastSegmentId(segmentNext);
      setForecastUiState(forecastNext);
      setLastSavedSerialized(
        stableStringify(
          buildPersistenceSnapshot(balanceNext, wavesNext, {
            activeForecastPresetName: nameNext,
            forecastSegmentId: segmentNext,
            forecastUiState: forecastNext,
          })
        )
      );
      setStorageReady(true);
    };

    try {
      const response = await fetch('/api/storage/balance');
      if (!response.ok) {
        const local = readLocalPersistenceSnapshot();
        applyLoaded(local?.balance, local?.referenceWavesConfig, local?.uiState);
        return;
      }
      const json = await response.json() as {
        balance?: Partial<BalanceConstants>;
        referenceWavesConfig?: ReferenceWavesConfig;
        uiState?: {
          activeForecastPresetName?: string;
          forecastSegmentId?: SegmentId;
          forecastUiState?: ForecastUiState;
        };
      };
      applyLoaded(json.balance, json.referenceWavesConfig, json.uiState);
    } catch {
      const local = readLocalPersistenceSnapshot();
      applyLoaded(local?.balance, local?.referenceWavesConfig, local?.uiState);
    }
  };

  useEffect(() => {
    void loadFromDb();
  }, []);

  const saveToDb = async () => {
    if (!storageReady) return;
    setIsSaving(true);
    setSaveMessage('');
    try {
      const snapshot = buildPersistenceSnapshot(balance, referenceWavesConfig, {
        activeForecastPresetName,
        forecastSegmentId,
        forecastUiState,
      });
      const response = await fetch('/api/storage/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (!response.ok) throw new Error('save_failed');
      // Дублируем в localStorage на случай статического хостинга/падения API.
      writeLocalPersistenceSnapshot(snapshot);
      // После сохранения перечитываем из БД, чтобы клиент всегда жил от неё.
      await loadFromDb();
      setSaveMessage('Сохранено в БД');
      window.setTimeout(() => setSaveMessage(''), 1800);
    } catch {
      // Если API недоступен (статический хостинг) — сохраняем локально в браузере.
      const snapshot = buildPersistenceSnapshot(balance, referenceWavesConfig, {
        activeForecastPresetName,
        forecastSegmentId,
        forecastUiState,
      });
      writeLocalPersistenceSnapshot(snapshot);
      setLastSavedSerialized(stableStringify(snapshot));
      setSaveMessage('Сохранено локально (в браузере)');
      window.setTimeout(() => setSaveMessage(''), 2400);
    } finally {
      setIsSaving(false);
    }
  };

  const updateReferenceWavesConfig: React.Dispatch<React.SetStateAction<ReferenceWavesConfig>> = (updater) => {
    setReferenceWavesConfig((prev) => {
      const next = typeof updater === 'function'
        ? (updater as (prevState: ReferenceWavesConfig) => ReferenceWavesConfig)(prev)
        : updater;
      return next;
    });
    setReferenceWavesRevision((v) => v + 1);
  };

  const handleResetToDefaults = () => {
    if (typeof window !== 'undefined') {
      const confirmReset = window.confirm(
        'Сбросить все настройки баланса к дефолтным значениям?'
      );
      if (!confirmReset) return;
    }
    setBalance(hydrateBalance());
  };

  const exportBalanceBackup = () => {
    if (typeof window === 'undefined') return;
    const payload = {
      balance,
      referenceWavesConfig,
      uiState: {
        activeForecastPresetName,
        forecastSegmentId,
        forecastUiState,
      },
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `war-drone-balance-backup-${Date.now()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const importBalanceBackup = () => {
    backupInputRef.current?.click();
  };

  const onBackupFileSelected: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsed = JSON.parse(text) as {
          balance?: Partial<BalanceConstants>;
          referenceWavesConfig?: ReferenceWavesConfig;
          uiState?: {
            activeForecastPresetName?: string;
            forecastSegmentId?: SegmentId;
            forecastUiState?: ForecastUiState;
          };
        };
        if (parsed.balance) setBalance(hydrateBalance(parsed.balance));
        if (parsed.referenceWavesConfig) {
          setReferenceWavesConfig(migrateReferenceWavesConfig(parsed.referenceWavesConfig));
        }
        if (parsed.uiState?.activeForecastPresetName != null) setActiveForecastPresetName(parsed.uiState.activeForecastPresetName);
        if (parsed.uiState?.forecastSegmentId != null) setForecastSegmentId(parsed.uiState.forecastSegmentId);
        if (parsed.uiState?.forecastUiState) {
          setForecastUiState(forecastUiStateFromDb(parsed.uiState.forecastUiState, parsed.balance?.meta?.gameLevels ?? balance.meta.gameLevels));
        }
        window.alert('Бэкап успешно импортирован.');
      } catch {
        window.alert('Не удалось импортировать бэкап.');
      }
    };
    reader.readAsText(file);
    e.currentTarget.value = '';
  };

  const persistenceSnapshot = useMemo(
    () =>
      buildPersistenceSnapshot(balance, referenceWavesConfig, {
        activeForecastPresetName,
        forecastSegmentId,
        forecastUiState,
      }),
    [balance, referenceWavesConfig, activeForecastPresetName, forecastSegmentId, forecastUiState]
  );

  const currentSerialized = useMemo(
    () => stableStringify(persistenceSnapshot),
    [persistenceSnapshot]
  );

  const hasUnsavedChanges =
    storageReady && lastSavedSerialized !== '' && currentSerialized !== lastSavedSerialized;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  const wave = useMemo(
    () => getReferenceWaveFromConfig(referenceWavesConfig, levelIndex, waveIndex),
    [referenceWavesConfig, referenceWavesRevision, levelIndex, waveIndex]
  );

  const combatResult = useMemo(
    () =>
      simulateCombat(balance, {
        loadout: {
          playerLevel,
          machineGunLevel: mgLevel,
          hydraLevel,
          hellfireLevel
        },
        wave
      }),
    [balance, playerLevel, mgLevel, hydraLevel, hellfireLevel, wave]
  );

  const mg = getWeaponLevelStats(balance, 'machineGun', mgLevel);
  const hydra = getWeaponLevelStats(balance, 'hydra70', hydraLevel);
  const hellfire = getWeaponLevelStats(balance, 'hellfire', hellfireLevel);

  return (
    <div className="root" style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <header className="app-sticky-header">
        <div className="app-sticky-header__top">
          <h2 style={{ margin: 0 }}>War Drone Balance Simulator</h2>
          <div className="app-sticky-header__actions">
            {hasUnsavedChanges && (
              <span className="app-sticky-header__unsaved" role="status">
                Есть несохранённые изменения
              </span>
            )}
            <button type="button" onClick={saveToDb} disabled={!storageReady || isSaving}>
              {isSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button type="button" onClick={exportBalanceBackup}>Экспорт бэкапа</button>
            <button type="button" onClick={importBalanceBackup}>Импорт бэкапа</button>
            {saveMessage && <span style={{ alignSelf: 'center', fontSize: 12, color: '#94a3b8' }}>{saveMessage}</span>}
            <input
              ref={backupInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={onBackupFileSelected}
            />
          </div>
        </div>
        <nav>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              style={{
                padding: '8px 14px',
                border: '1px solid transparent',
                borderRadius: 999,
                background: activeTab === id ? '#1d4ed8' : 'transparent',
                color: activeTab === id ? '#fff' : '#cbd5e1',
                fontWeight: activeTab === id ? 600 : 500,
                boxShadow: activeTab === id ? '0 4px 14px rgba(29, 78, 216, 0.45)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === 'combat' && (
        <>
      <section style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <h3>Параметры игрока</h3>
          <label>
            Уровень игрока:{' '}
            <input
              type="number"
              min={1}
              max={balance.meta.maxPlayerLevel}
              value={playerLevel}
              onChange={e => setPlayerLevel(Number(e.target.value) || 1)}
            />
          </label>
          <div>HP вертолёта: {balance.player.baseAllyHp}</div>
        </div>

        <div>
          <h3>Уровни оружия</h3>
          <div>
            <label>
              Пулемёт:{' '}
              <input
                type="number"
                min={1}
              max={getMaxWeaponLevelForWeapon(balance, 'machineGun')}
                value={mgLevel}
                onChange={e => setMgLevel(Number(e.target.value) || 1)}
              />
            </label>
            <div>Мгновенный DPS: {mg.dps.toFixed(1)}</div>
            <div>Устойчивый DPS: {mg.sustainedDps.toFixed(1)}</div>
          </div>
          <div>
            <label>
              Hydra-70:{' '}
              <input
                type="number"
                min={1}
              max={getMaxWeaponLevelForWeapon(balance, 'hydra70')}
                value={hydraLevel}
                onChange={e => setHydraLevel(Number(e.target.value) || 1)}
              />
            </label>
            <div>Мгновенный DPS: {hydra.dps.toFixed(1)}</div>
            <div>Устойчивый DPS: {hydra.sustainedDps.toFixed(1)}</div>
          </div>
          <div>
            <label>
              Hellfire:{' '}
              <input
                type="number"
                min={1}
              max={getMaxWeaponLevelForWeapon(balance, 'hellfire')}
                value={hellfireLevel}
                onChange={e => setHellfireLevel(Number(e.target.value) || 1)}
              />
            </label>
            <div>Мгновенный DPS: {hellfire.dps.toFixed(1)}</div>
            <div>Устойчивый DPS: {hellfire.sustainedDps.toFixed(1)}</div>
          </div>
          <div>
            <strong>
              Суммарный DPS:{' '}
              {(mg.sustainedDps + hydra.sustainedDps + hellfire.sustainedDps).toFixed(1)}
            </strong>
          </div>
        </div>

        <div>
          <h3>Волна</h3>
          <label>
            Уровень:{' '}
            <input
              type="number"
              min={1}
              max={balance.meta.gameLevels}
              value={levelIndex}
              onChange={e => setLevelIndex(Number(e.target.value) || 1)}
            />
          </label>
          <br />
          <label>
            Волна:{' '}
            <input
              type="number"
              min={1}
              max={balance.economy.wavesPerLevel ?? 2}
              value={waveIndex}
              onChange={e => setWaveIndex(Number(e.target.value) || 1)}
            />
          </label>
          <div style={{ marginTop: 8 }}>
            {wave.enemies.map(group => (
              <div key={group.enemyId}>
                {balance.enemies[group.enemyId as EnemyId]?.displayName ?? group.enemyId}: x
                {group.count}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>Результат симуляции</h3>
        <div>
          Время убийства волны:{' '}
          {Number.isFinite(combatResult.timeToKillSec)
            ? combatResult.timeToKillSec.toFixed(1) + ' с'
            : '∞'}
        </div>
        <div>Входящий DPS врагов: {combatResult.incomingDps.toFixed(1)}</div>
        <div>HP вертолёта: {combatResult.playerHp}</div>
        <div>
          Исход:{' '}
          <strong style={{ color: combatResult.victory ? 'green' : 'red' }}>
            {combatResult.victory ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}
          </strong>
        </div>
        <div>Звёзды: {combatResult.stars}</div>
        <div>Награда (монеты): {combatResult.rewardSoft.toFixed(0)}</div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#666' }}>
          Скилл: множитель исходящего урона (ожидание){' '}
          {(combatResult.outgoingSkillDamageMultiplier ?? 1).toFixed(3)} — настраивается в «Формулы → Бой и референсные волны».
        </div>
      </section>
        </>
      )}

      {activeTab === 'economy' && (
        <EconomyPanel
          balance={balance}
          setBalance={setBalance}
          referenceWavesConfig={referenceWavesConfig}
          forecastSegmentId={forecastSegmentId}
          onResetToDefaults={handleResetToDefaults}
        />
      )}

      {activeTab === 'weapons' && (
        <WeaponCardsPanel
          balance={balance}
          setBalance={setBalance}
          referenceWavesConfig={referenceWavesConfig}
          referenceWavesRevision={referenceWavesRevision}
        />
      )}

      {activeTab === 'shop' && (
        <ShopPanel balance={balance} setBalance={setBalance} />
      )}

      {activeTab === 'formulas' && (
        <FormulasPanel balance={balance} setBalance={setBalance} />
      )}

      {activeTab === 'charts' && (
        <Charts balance={balance} />
      )}

      {activeTab === 'traffic' && (
        <TrafficPanel balance={balance} setBalance={setBalance} />
      )}

      {activeTab === 'forecast' && (
        <ProgressionForecastPanel
          balance={balance}
          setBalance={setBalance}
          playerLevel={playerLevel}
          referenceWavesConfig={referenceWavesConfig}
          setReferenceWavesConfig={updateReferenceWavesConfig}
          referenceWavesRevision={referenceWavesRevision}
          activePresetName={activeForecastPresetName}
          onActivePresetNameChange={setActiveForecastPresetName}
          segmentId={forecastSegmentId}
          onSegmentIdChange={setForecastSegmentId}
          forecastUiState={forecastUiState}
          onForecastUiStateChange={updateForecastUiState}
        />
      )}

      {activeTab === 'levels' && (
        <LevelsConstructorPanel
          balance={balance}
          setBalance={setBalance}
          referenceWavesConfig={referenceWavesConfig}
          setReferenceWavesConfig={updateReferenceWavesConfig}
          segmentId={forecastSegmentId}
          onSegmentIdChange={setForecastSegmentId}
          playerLevel={playerLevel}
          onPlayerLevelChange={setPlayerLevel}
          forecastUiState={forecastUiState}
          onForecastUiStateChange={updateForecastUiState}
        />
      )}
    </div>
  );
};

