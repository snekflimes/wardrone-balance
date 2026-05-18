import type { BalanceConstants, FreeChestConfig } from '../balance/model';
import type { EnemyId } from '../balance/model';
import type {
  CombatOutcome,
  ProgressionAttemptPowerPoint,
  ProgressionForecastResult,
  ProgressionSimulatorOptions,
  WeaponLevels,
} from './types';
import { resolveEnergyRegenPerHour } from './energyRegenForecast';
import type { WaveDefinition } from '../balance/schema';
import {
  aggregateWaveEnemyCounts,
  getReferenceWave,
  getReferenceWaveFromConfig,
  getUnitsPerLevelFromBalance,
  getUnitsPerLevelFromConfig,
} from '../balance/referenceWaves';
import { getWavesPerLevel } from '../balance/economy';
import {
  getOutgoingSkillDamageMultiplier,
  getWaveLevelPowerContribution,
  getWaveStats,
  getWeaponLevelStats,
  simulateCombat,
} from '../balance/simulator';
import { getMaxWeaponLevelForWeapon } from '../balance/weaponMeta';
import {
  addExpectedBlueprintsFromPaidChestOpens,
  getExpectedBlueprintCopiesOfSingleCardPerFreeChestFromConfig,
  getExpectedFreeChestCurrencyPerOpenFromConfig,
  getFreeChestKeyProgression,
  getFreeChestsForKeyCycle,
  getHardIncomeFromSegmentPerWeek,
  getSoftIncomeFromSegmentPerWeek,
} from './iapAndChestsModel';
import { resolveStarterPackGrants } from '../balance/starterPack';
import { spendAllHardOnSupportChestsExpected } from './hardChestSpend';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sumRewards(stateRewardSoft: number, rewardSoft: number): number {
  const next = stateRewardSoft + rewardSoft;
  if (!Number.isFinite(next)) return stateRewardSoft;
  return next;
}

function sumEditorUnitsRow(row: Record<EnemyId, number> | null | undefined): number | undefined {
  if (!row) return undefined;
  let s = 0;
  for (const v of Object.values(row)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) s += v;
  }
  return s > 0 ? s : undefined;
}

function sameWeaponLevels(
  a: WeaponLevels,
  b: WeaponLevels
): boolean {
  return (
    a.machineGunLevel === b.machineGunLevel &&
    a.hydraLevel === b.hydraLevel &&
    a.hellfireLevel === b.hellfireLevel
  );
}

function sameNumberRecord(
  a: Record<number, number>,
  b: Record<number, number>
): boolean {
  const keys = new Set<number>([
    ...Object.keys(a).map((k) => Number(k)),
    ...Object.keys(b).map((k) => Number(k)),
  ]);
  for (const key of keys) {
    if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  }
  return true;
}

function defaultInitialWeaponLevels(): WeaponLevels {
  return {
    machineGunLevel: 1,
    hydraLevel: 1,
    hellfireLevel: 1,
  };
}

function calcPlayerPowerForAttempt(
  constants: BalanceConstants,
  args: {
    levelIndex: number;
    playerLevel: number;
    weaponLevels: WeaponLevels;
    unlockedWeapons?: { machineGun: boolean; hydra70: boolean; hellfire: boolean };
    supportCardLevels: Record<number, number>;
    retryPowerMultiplier: number;
  }
): number {
  const mg = getWeaponLevelStats(constants, 'machineGun', args.weaponLevels.machineGunLevel);
  const hydra = getWeaponLevelStats(constants, 'hydra70', args.weaponLevels.hydraLevel);
  const hellfire = getWeaponLevelStats(constants, 'hellfire', args.weaponLevels.hellfireLevel);
  const unlocked = args.unlockedWeapons ?? { machineGun: true, hydra70: args.levelIndex >= 2, hellfire: args.levelIndex >= 2 };
  const totalSustainedDps =
    (unlocked.machineGun ? mg.sustainedDps : 0) +
    (unlocked.hydra70 ? hydra.sustainedDps : 0) +
    (unlocked.hellfire ? hellfire.sustainedDps : 0);
  const skillMult = getOutgoingSkillDamageMultiplier(constants.economy);
  const sumSupportLvls = Object.values(args.supportCardLevels).reduce((s, v) => s + Math.max(0, v || 0), 0);
  const supportMult = 1 + Math.log1p(sumSupportLvls) * 0.12;
  const playerLvlMult = 1 + Math.log1p(Math.max(1, args.playerLevel)) * 0.06;
  const raw = totalSustainedDps * skillMult * supportMult * playerLvlMult * Math.max(0.01, args.retryPowerMultiplier);
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

export function simulateProgressionForecast(
  constants: BalanceConstants,
  options: ProgressionSimulatorOptions
): ProgressionForecastResult {
  const wavesPerLevel = getWavesPerLevel(constants);
  /** Столько боёв подряд на уровень симулируем (как meta.wavesPerLevel, макс. 10 в getWavesPerLevel). Ниже: если этап 1..N пустой в reference-конфиге, уровень не симулируется (0 попыток). */
  const wavesToSimulate = Math.max(1, wavesPerLevel);
  const hasPremiumReward = options.segmentId !== 'free';

  const lastSimulatedLevel = Math.min(
    constants.meta.gameLevels,
    Math.max(1, options.maxLevelIndex ?? constants.meta.gameLevels)
  );

  const unitsPerLevel = getUnitsPerLevelFromBalance(constants);
  const unitsPerLevelFromCfg = options.referenceWavesConfig
    ? getUnitsPerLevelFromConfig(options.referenceWavesConfig, constants.meta.gameLevels)
    : null;
  const initialWeaponLevels = {
    ...defaultInitialWeaponLevels(),
    ...(options.initialWeaponLevels ?? {}),
  };

  let softBalance = options.initialSoft ?? 0;
  let weaponLevels: WeaponLevels = {
    machineGunLevel: clamp(
      initialWeaponLevels.machineGunLevel,
      1,
      getMaxWeaponLevelForWeapon(constants, 'machineGun')
    ),
    hydraLevel: clamp(initialWeaponLevels.hydraLevel, 1, getMaxWeaponLevelForWeapon(constants, 'hydra70')),
    hellfireLevel: clamp(
      initialWeaponLevels.hellfireLevel,
      1,
      getMaxWeaponLevelForWeapon(constants, 'hellfire')
    ),
  };
  let unlockedWeapons = {
    machineGun: true,
    hydra70: false,
    hellfire: false,
  };
  let lifetimeRocketUnlockSoftSpent = 0;
  let deckSlots = {
    slots: Math.max(1, Math.floor(constants.economy.startingCardSlots ?? 4)),
    lifetimeSoftSpent: 0,
  };

  // Support cards: expected blueprints and current levels.
  let supportCardLevels: Record<number, number> = {};
  let supportCardBlueprints: Record<number, number> = {};
  for (const card of constants.supportCards) {
    supportCardLevels[card.id] = 0;
    supportCardBlueprints[card.id] = 0;
  }

  let lifetimeWeaponUpgradeSoftSpent = 0;

  const progressionLevels: ProgressionForecastResult['levels'] = [];
  const attemptsTimeline: ProgressionAttemptPowerPoint[] = [];
  let globalAttemptOrdinal = 0;

  const energyCap = Math.max(0, options.energyPerLevel ?? 100);
  const energyPerAttempt = Math.max(1, options.energyPerAttempt ?? 1);
  const energyRegenPerHour = Math.max(
    0,
    resolveEnergyRegenPerHour({
      segmentId: options.segmentId,
      energyRegenIntervalSec: options.energyRegenIntervalSec,
      energyRegenIntervalSecPremium: options.energyRegenIntervalSecPremium,
      energyRegenPerHour: options.energyRegenPerHour,
    })
  );
  let energy = Math.max(0, Math.min(energyCap, options.energyStart ?? energyCap));
  /** Суммарное ожидание регенера энергии (бесплатные сундуки в прогнозе не от него). */
  let elapsedEnergyWaitHours = 0;
  /** Ожидание энергии + номинально 24 ч при смене календарного дня из‑за лимита попыток (без сундуков). */
  let elapsedCalendarHours = 0;
  const maxAttemptsPerForecastDay =
    constants.meta.forecastMaxAttemptsPerDay != null &&
    Number.isFinite(constants.meta.forecastMaxAttemptsPerDay)
      ? Math.max(1, Math.floor(constants.meta.forecastMaxAttemptsPerDay))
      : 10;
  /** День для колонки «День прохода» (лимит попыток/день). */
  let forecastCalendarDay = 1;
  let forecastAttemptsToday = 0;
  let starterCardsGranted = false;
  let forecastStarterPackPurchased = false;

  /** Хард из логина, бесплатных сундуков и доли доната (платящие); весь тратится на сундуки с картами. */
  let hardBalance = 0;

  const segmentSoftPerWeek = getSoftIncomeFromSegmentPerWeek(constants, options.segmentId);
  const segmentSoftPerDay = segmentSoftPerWeek > 0 ? segmentSoftPerWeek / 7 : 0;
  const segmentHardPerWeek = getHardIncomeFromSegmentPerWeek(constants, options.segmentId);
  const segmentHardPerDay = segmentHardPerWeek > 0 ? segmentHardPerWeek / 7 : 0;

  const freeChestOpensById: Record<string, number> = {};
  const questChestOpensById: Record<string, number> = {};
  let freeChestKeyBank = 0;
  let freeChestCycleSlot = 0;
  let freeChestAttemptWins = 0;
  let freeChestAttemptLosses = 0;
  const paidChestOpensById: Record<string, number> = {};

  const freeChestsKeyCycle: FreeChestConfig[] = getFreeChestsForKeyCycle(constants.economy.freeChests);

  const recordPaidChestOpens = (chestId: string, count: number) => {
    if (count <= 0 || !chestId) return;
    paidChestOpensById[chestId] = (paidChestOpensById[chestId] ?? 0) + count;
  };

  const applySingleFreeChestOpen = (chest: FreeChestConfig) => {
    freeChestOpensById[chest.id] = (freeChestOpensById[chest.id] ?? 0) + 1;
    const expectedCurrency = getExpectedFreeChestCurrencyPerOpenFromConfig(constants, chest);
    softBalance += expectedCurrency.soft;
    hardBalance += expectedCurrency.hard;
    for (const card of constants.supportCards) {
      const perOpen = getExpectedBlueprintCopiesOfSingleCardPerFreeChestFromConfig(constants, chest, card.rarity);
      if (perOpen <= 0) continue;
      supportCardBlueprints[card.id] = (supportCardBlueprints[card.id] ?? 0) + perOpen;
    }
  };

  const applyQuestChestOpensForLevel = (levelIndex: number) => {
    const list = constants.economy.questChestsByLevel ?? [];
    const row = list.find((x) => x.levelIndex === levelIndex);
    if (!row) return;
    const opens = Math.max(0, Math.floor(row.opensPerLevel ?? 3));
    if (opens <= 0) return;
    const ch = row.chest;
    if (!ch || !ch.id) return;
    for (let i = 0; i < opens; i += 1) {
      questChestOpensById[ch.id] = (questChestOpensById[ch.id] ?? 0) + 1;
      const expectedCurrency = getExpectedFreeChestCurrencyPerOpenFromConfig(constants, ch);
      softBalance += expectedCurrency.soft;
      hardBalance += expectedCurrency.hard;
      for (const card of constants.supportCards) {
        const perOpen = getExpectedBlueprintCopiesOfSingleCardPerFreeChestFromConfig(constants, ch, card.rarity);
        if (perOpen <= 0) continue;
        supportCardBlueprints[card.id] = (supportCardBlueprints[card.id] ?? 0) + perOpen;
      }
    }
  };

  const applyLoginRewardForDay = (day: number) => {
    const rewards = constants.economy.loginRewards ?? [];
    const row = rewards.find((r) => r.day === day);
    if (!row) return;
    if ((row.soft ?? 0) > 0) softBalance += row.soft;
    if ((row.hard ?? 0) > 0) hardBalance += row.hard;
  };

  /**
   * За календарный день прогноза: донатный софт/хард сегмента, логин; бесплатные сундуки — только по ключам за попытки.
   * Весь накопленный хард затем уходит в платные сундуки с картами (EV чертежей).
   */
  const grantForecastDailyFreeChests = (gameLevelIndex: number) => {
    if (segmentSoftPerDay > 0) {
      softBalance += segmentSoftPerDay;
    }
    if (segmentHardPerDay > 0) {
      hardBalance += segmentHardPerDay;
    }
    applyLoginRewardForDay(forecastCalendarDay);

    // Стартер-пак за золото (реф. содержимое × масштаб цены + паритет награды): только платники и киты, один раз.
    if (!forecastStarterPackPurchased && options.segmentId !== 'free') {
      const grants = resolveStarterPackGrants(constants);
      if (grants && grants.priceHard > 0 && hardBalance + 1e-9 >= grants.priceHard) {
        hardBalance -= grants.priceHard;
        forecastStarterPackPurchased = true;
        softBalance += grants.soft;
        for (const { chestId, count } of grants.chestOpens) {
          supportCardBlueprints = addExpectedBlueprintsFromPaidChestOpens(
            constants,
            chestId,
            count,
            supportCardBlueprints,
            recordPaidChestOpens
          );
        }
      }
    }

    const hardSpend = spendAllHardOnSupportChestsExpected(
      constants,
      hardBalance,
      supportCardLevels,
      supportCardBlueprints,
      gameLevelIndex,
      recordPaidChestOpens
    );
    hardBalance = hardSpend.hardRemaining;
    supportCardBlueprints = hardSpend.supportCardBlueprints;
  };

  const tryBuyDeckSlots = () => {
    const maxSlots = Math.max(1, constants.economy.maxCardSlots);
    const cost = Math.max(0, constants.economy.cardSlotCost);
    if (!Number.isFinite(cost) || cost <= 0) return;
    while (deckSlots.slots < maxSlots && softBalance + 1e-9 >= cost) {
      softBalance -= cost;
      deckSlots = { slots: deckSlots.slots + 1, lifetimeSoftSpent: deckSlots.lifetimeSoftSpent + cost };
    }
  };

  const filterSupportCardsByDeckSlots = (levels: Record<number, number>): Record<number, number> => {
    const entries = Object.entries(levels)
      .map(([k, v]) => ({ id: Number(k), lvl: Number(v ?? 0) }))
      .filter((x) => x.id > 0 && x.lvl > 0)
      .sort((a, b) => (b.lvl - a.lvl) || (a.id - b.id));
    const keep = new Set(entries.slice(0, Math.max(0, deckSlots.slots)).map((x) => x.id));
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(levels)) {
      const id = Number(k);
      if (keep.has(id)) out[id] = Number(v ?? 0);
    }
    return out;
  };

  grantForecastDailyFreeChests(1);
  tryBuyDeckSlots();

  for (let levelIndex = 1; levelIndex <= lastSimulatedLevel; levelIndex += 1) {
    if (levelIndex >= 2 && !starterCardsGranted) {
      // Стартовый набор: рой дронов, мины, десант, патроны МГ/Hydra, пехота с РПГ (6 слотов деки).
      for (const cardId of [1, 2, 7, 8, 10, 16]) {
        supportCardLevels[cardId] = Math.max(1, supportCardLevels[cardId] ?? 0);
      }
      starterCardsGranted = true;
    }

    const weaponSpendAtLevelStart = lifetimeWeaponUpgradeSoftSpent;
    const rocketUnlockSpendAtLevelStart = lifetimeRocketUnlockSoftSpent;
    const deckSlotsSpendAtLevelStart = deckSlots.lifetimeSoftSpent;

    let attemptsTotal = 0;
    let rewardTotal = 0;
    let levelPassed = false;
    let noProgressAttemptsInLevel = 0;
    let retryPowerMultiplier = 1;
    // Модель "обучения на ретраях": игрок адаптируется и чуть повышает эффективность на каждой попытке.
    // Дефолт делаем маленьким (не +10%), и ограничиваем cap'ом, чтобы прогноз не "читерил".
    const retryPowerGain = Math.max(0, options.retryPowerGainPerAttempt ?? 0.028);
    const retryPowerCap = Math.max(1, (options as any).retryPowerCap ?? 1.28);
    const maxAttemptsPerLevel = options.maxAttemptsPerLevel ?? options.maxAttemptsPerWave ?? 200;
    const deadlockRetryCap = Math.max(1, options.deadlockRetryCapPerWave ?? 5);
    const levelWaves: WaveDefinition[] = [];

    // Строгая проверка уровня перед первой попыткой:
    // если хотя бы одна волна пустая, уровень несимулируем (0 попыток).
    for (let waveIndex = 1; waveIndex <= wavesToSimulate; waveIndex += 1) {
      const rawWave: WaveDefinition = options.referenceWavesConfig
        ? getReferenceWaveFromConfig(options.referenceWavesConfig, levelIndex, waveIndex)
        : getReferenceWave(levelIndex, waveIndex);
      const wave = rawWave;
      if (wave.enemies.length === 0) {
        levelWaves.length = 0;
        break;
      }
      levelWaves.push(wave);
    }

    const rawUnitsSum = sumEditorUnitsRow(unitsPerLevelFromCfg?.[levelIndex]);

    if (levelWaves.length !== wavesToSimulate) {
      progressionLevels.push({
        levelIndex,
        unitsByEnemyId: (unitsPerLevelFromCfg?.[levelIndex] ?? unitsPerLevel[levelIndex]) as Record<EnemyId, number>,
        unitsRawSumFromEditor: rawUnitsSum,
        totalEnemyHpScaled: undefined,
        totalEnemyLevelPowerScaled: undefined,
        attemptsTotal: 0,
        avgRewardPerAttempt: 0,
        totalRewardSoft: 0,
        endingSoftBalance: softBalance,
        weaponUpgradeSoftSpentOnLevel: 0,
        weaponUpgradeSoftSpentCumulative: lifetimeWeaponUpgradeSoftSpent,
        dayReached: null,
        finalWeaponLevels: weaponLevels,
        passed: false,
      });
      continue;
    }

    let totalEnemyHpScaledForLevel = 0;
    let totalEnemyLevelPowerScaled = 0;
    for (const w of levelWaves) {
      const ws = getWaveStats(constants, w);
      totalEnemyHpScaledForLevel += ws.totalEnemyHp;
      totalEnemyLevelPowerScaled += getWaveLevelPowerContribution(ws);
    }
    const levelEnemyPower = totalEnemyLevelPowerScaled;

    while (!levelPassed) {
      if (attemptsTotal >= maxAttemptsPerLevel) break;

      if (energy < energyPerAttempt) {
        if (energyRegenPerHour <= 0) break;
        const missing = energyPerAttempt - energy;
        const waitHours = missing / energyRegenPerHour;
        elapsedEnergyWaitHours += waitHours;
        elapsedCalendarHours += waitHours;
        energy = Math.min(energyCap, energy + waitHours * energyRegenPerHour);
      }

      if (forecastAttemptsToday >= maxAttemptsPerForecastDay) {
        forecastCalendarDay += 1;
        forecastAttemptsToday = 0;
        elapsedCalendarHours += 24;
        grantForecastDailyFreeChests(levelIndex);
        tryBuyDeckSlots();
      }

      // Покупка ракетниц (если дошли до ур.2 и есть деньги).
      if (levelIndex >= 2) {
        const unlock = constants.economy.rocketUnlock;
        if (unlock?.hydra70Soft != null && !unlockedWeapons.hydra70 && softBalance >= unlock.hydra70Soft) {
          softBalance -= unlock.hydra70Soft;
          unlockedWeapons = { ...unlockedWeapons, hydra70: true };
          lifetimeRocketUnlockSoftSpent += unlock.hydra70Soft;
        }
        if (unlock?.hellfireSoft != null && !unlockedWeapons.hellfire && softBalance >= unlock.hellfireSoft) {
          softBalance -= unlock.hellfireSoft;
          unlockedWeapons = { ...unlockedWeapons, hellfire: true };
          lifetimeRocketUnlockSoftSpent += unlock.hellfireSoft;
        }
      }

      attemptsTotal += 1;
      forecastAttemptsToday += 1;
      energy = Math.max(0, energy - energyPerAttempt);

      const stateBeforeAttempt = {
        segmentId: options.segmentId,
        softBalance,
        playerLevel: options.playerLevel,
        weaponLevels,
        unlockedWeapons,
        deckSlots,
        lifetimeRocketUnlockSoftSpent,
        lifetimeWeaponUpgradeSoftSpent,
        supportCardLevels,
        supportCardBlueprints,
      };

      // Pre-upgrade перед попыткой уровня.
      {
        const preOutcome: CombatOutcome = {
          victory: false,
          stars: 0,
          rewardSoft: 0,
        };
        const nextState = options.upgradePolicy({
          constants,
          state: stateBeforeAttempt,
          outcome: preOutcome,
          ctx: {
            segmentId: options.segmentId,
            levelIndex,
            waveIndex: 0,
            wave: { levelIndex, waveIndex: 0, enemies: [] },
            attemptIndex: attemptsTotal,
            recordPaidChestOpens,
          },
        });
        softBalance = nextState.softBalance;
        weaponLevels = nextState.weaponLevels;
        unlockedWeapons = nextState.unlockedWeapons ?? unlockedWeapons;
        deckSlots = nextState.deckSlots ?? deckSlots;
        supportCardLevels = nextState.supportCardLevels;
        supportCardBlueprints = nextState.supportCardBlueprints;
        lifetimeRocketUnlockSoftSpent =
          nextState.lifetimeRocketUnlockSoftSpent ?? lifetimeRocketUnlockSoftSpent;
        lifetimeWeaponUpgradeSoftSpent = nextState.lifetimeWeaponUpgradeSoftSpent ?? lifetimeWeaponUpgradeSoftSpent;
      }

      globalAttemptOrdinal += 1;
      const playerPower = calcPlayerPowerForAttempt(constants, {
        levelIndex,
        playerLevel: options.playerLevel,
        weaponLevels,
        unlockedWeapons,
        supportCardLevels,
        retryPowerMultiplier,
      });
      const enemyPower = Math.max(0, levelEnemyPower);
      attemptsTimeline.push({
        attemptOrdinal: globalAttemptOrdinal,
        levelIndex,
        attemptInLevel: attemptsTotal,
        forecastDay: forecastCalendarDay,
        playerPower,
        enemyPower,
        powerDelta: playerPower - enemyPower,
        powerRatio: enemyPower > 0 ? playerPower / enemyPower : 0,
      });

      let attemptVictory = true;
      let attemptReward = 0;

      for (const wave of levelWaves) {
        const waveIndex = wave.waveIndex;

        const combat = simulateCombat(constants, {
          loadout: {
            playerLevel: options.playerLevel,
            machineGunLevel: weaponLevels.machineGunLevel,
            hydraLevel: weaponLevels.hydraLevel,
            hellfireLevel: weaponLevels.hellfireLevel,
            unlockedWeapons: {
              machineGun: true,
              hydra70: unlockedWeapons.hydra70,
              hellfire: unlockedWeapons.hellfire,
            },
            supportCardLevels: filterSupportCardsByDeckSlots(supportCardLevels),
            combatPowerMultiplier: retryPowerMultiplier,
            hasPremiumReward,
            useForecastCombatCalibration: true,
          },
          wave,
        });

        const effectiveRewardSoft = combat.rewardSoft;

        const outcome: CombatOutcome = {
          victory: combat.victory,
          stars: combat.stars,
          rewardSoft: effectiveRewardSoft,
        };

        attemptReward = sumRewards(attemptReward, effectiveRewardSoft);
        rewardTotal = sumRewards(rewardTotal, effectiveRewardSoft);
        softBalance = sumRewards(softBalance, effectiveRewardSoft);

        const prevState = {
          segmentId: options.segmentId,
          softBalance,
          playerLevel: options.playerLevel,
          weaponLevels,
          lifetimeRocketUnlockSoftSpent,
          lifetimeWeaponUpgradeSoftSpent,
          supportCardLevels,
          supportCardBlueprints,
        };

        const nextState = options.upgradePolicy({
          constants,
          state: prevState,
          outcome,
          ctx: {
            segmentId: options.segmentId,
            levelIndex,
            waveIndex,
            wave,
            attemptIndex: attemptsTotal,
            recordPaidChestOpens,
          },
        });

        softBalance = nextState.softBalance;
        weaponLevels = nextState.weaponLevels;
        supportCardLevels = nextState.supportCardLevels;
        supportCardBlueprints = nextState.supportCardBlueprints;
        lifetimeWeaponUpgradeSoftSpent = nextState.lifetimeWeaponUpgradeSoftSpent ?? lifetimeWeaponUpgradeSoftSpent;

        if (!combat.victory) {
          attemptVictory = false;
          break;
        }
      }

      {
        const kp = getFreeChestKeyProgression(constants);
        if (freeChestsKeyCycle.length > 0) {
          if (attemptVictory) freeChestAttemptWins += 1;
          else freeChestAttemptLosses += 1;
          const delta = attemptVictory ? kp.keysPerWin : kp.keysPerLoss;
          freeChestKeyBank += delta;
          const need = kp.keysToOpenChest;
          while (freeChestKeyBank + 1e-9 >= need && freeChestsKeyCycle.length > 0) {
            freeChestKeyBank -= need;
            const chest = freeChestsKeyCycle[freeChestCycleSlot % freeChestsKeyCycle.length];
            applySingleFreeChestOpen(chest);
            freeChestCycleSlot = (freeChestCycleSlot + 1) % freeChestsKeyCycle.length;
          }
        }
      }

      if (attemptVictory) {
        levelPassed = true;
        // Квестовые сундуки уровня: 1 сундук (конфиг) × N открытий (по умолчанию 3 — по одному за квест).
        applyQuestChestOpensForLevel(levelIndex);
        break;
      }

      const stateAfterAttempt = {
        softBalance,
        weaponLevels,
        supportCardLevels,
        supportCardBlueprints,
      };
      const noSoftChange = stateAfterAttempt.softBalance === stateBeforeAttempt.softBalance;
      const noWeaponChange = sameWeaponLevels(stateAfterAttempt.weaponLevels, stateBeforeAttempt.weaponLevels);
      const noCardLevelChange = sameNumberRecord(stateAfterAttempt.supportCardLevels, stateBeforeAttempt.supportCardLevels);
      const noBlueprintChange = sameNumberRecord(stateAfterAttempt.supportCardBlueprints, stateBeforeAttempt.supportCardBlueprints);
      if (attemptReward <= 0 && noSoftChange && noWeaponChange && noCardLevelChange && noBlueprintChange) {
        noProgressAttemptsInLevel += 1;
      } else {
        noProgressAttemptsInLevel = 0;
      }

      if (retryPowerGain <= 0 && noProgressAttemptsInLevel >= deadlockRetryCap) break;
      retryPowerMultiplier = Math.min(retryPowerCap, retryPowerMultiplier * (1 + retryPowerGain));
    }

    const passed = levelPassed;
    const avgRewardPerAttempt = attemptsTotal > 0 ? rewardTotal / attemptsTotal : 0;

    const unitsForTable: Record<EnemyId, number> =
      levelWaves.length === wavesToSimulate
        ? aggregateWaveEnemyCounts(levelWaves)
        : ((unitsPerLevelFromCfg?.[levelIndex] ?? unitsPerLevel[levelIndex]) as Record<EnemyId, number>);

    progressionLevels.push({
      levelIndex,
      unitsByEnemyId: unitsForTable,
      unitsRawSumFromEditor: rawUnitsSum,
      totalEnemyHpScaled: totalEnemyHpScaledForLevel,
      totalEnemyLevelPowerScaled,
      attemptsTotal,
      avgRewardPerAttempt,
      totalRewardSoft: rewardTotal,
      endingSoftBalance: softBalance,
      weaponUpgradeSoftSpentOnLevel: lifetimeWeaponUpgradeSoftSpent - weaponSpendAtLevelStart,
      weaponUpgradeSoftSpentCumulative: lifetimeWeaponUpgradeSoftSpent,
      rocketUnlockSoftSpentOnLevel: lifetimeRocketUnlockSoftSpent - rocketUnlockSpendAtLevelStart,
      rocketUnlockSoftSpentCumulative: lifetimeRocketUnlockSoftSpent,
      deckSlotsSoftSpentOnLevel: deckSlots.lifetimeSoftSpent - deckSlotsSpendAtLevelStart,
      deckSlotsSoftSpentCumulative: deckSlots.lifetimeSoftSpent,
      dayReached: passed ? forecastCalendarDay : null,
      finalWeaponLevels: weaponLevels,
      passed,
    });

  }

  const kpEnd = getFreeChestKeyProgression(constants);
  const fcAttempts = freeChestAttemptWins + freeChestAttemptLosses;
  const keysEarnedTotal =
    freeChestAttemptWins * kpEnd.keysPerWin + freeChestAttemptLosses * kpEnd.keysPerLoss;
  const chestOpensTotal = Object.values(freeChestOpensById).reduce((s, n) => s + n, 0);

  return {
    levels: progressionLevels,
    attemptsTimeline,
    finalState: {
      segmentId: options.segmentId,
      softBalance,
      playerLevel: options.playerLevel,
      weaponLevels,
      unlockedWeapons,
      deckSlots,
      lifetimeRocketUnlockSoftSpent,
      lifetimeWeaponUpgradeSoftSpent,
      supportCardLevels,
      supportCardBlueprints,
      forecastStarterPackPurchased,
    },
    expectedFreeChestOpensById: { ...freeChestOpensById },
    expectedQuestChestOpensById: { ...questChestOpensById },
    freeChestKeyForecast:
      freeChestsKeyCycle.length > 0
        ? {
            attempts: fcAttempts,
            wins: freeChestAttemptWins,
            losses: freeChestAttemptLosses,
            keysPerWin: kpEnd.keysPerWin,
            keysPerLoss: kpEnd.keysPerLoss,
            keysToOpenChest: kpEnd.keysToOpenChest,
            keysEarnedTotal,
            chestOpensTotal,
            keyBankRemaining: freeChestKeyBank,
          }
        : undefined,
    expectedPaidChestOpensById: { ...paidChestOpensById },
    progressionElapsedHours: elapsedEnergyWaitHours,
    progressionElapsedCalendarHours: elapsedCalendarHours,
    segmentSoftIncomePerDay: segmentSoftPerDay,
    segmentHardIncomePerDay: segmentHardPerDay,
  };
}

