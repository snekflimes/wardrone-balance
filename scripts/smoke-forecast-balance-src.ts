/**
 * Smoke: HP защищаемой цели и карта #17 в прогнозе.
 * Запуск: npx esbuild scripts/smoke-forecast-balance-src.ts --bundle --platform=node --format=esm --outfile=scripts/.smoke-out.mjs && node scripts/.smoke-out.mjs
 */
import { BALANCE_CONSTANTS } from '../src/balance/model';
import { balanceForForecastSimulation } from '../src/balance/balanceForForecastSimulation';
import {
  PROTECTED_TARGET_HP_CARD_ID,
  getProtectedTargetBaseHp,
  getProtectedTargetHpCardBonus,
  resolveProtectedTargetMaxHp,
} from '../src/balance/protectedTargetHp';
import { simulateProgressionForecast } from '../src/progression/progressionSimulator';
import { fullWeaponAndSupportUpgradePolicy } from '../src/progression/fullUpgradePolicy';
import { getDefaultReferenceWavesConfig } from '../src/balance/referenceWaves';
import { simulateCombat } from '../src/balance/simulator';

function runSmoke(): void {
  const runtime = structuredClone(BALANCE_CONSTANTS) as typeof BALANCE_CONSTANTS;
  runtime.player = { protectedTargetBaseHp: 200 };
  runtime.weapons.machineGun.baseDamage = 9999;

  const card17 = runtime.supportCards.find((c) => c.id === PROTECTED_TARGET_HP_CARD_ID);
  if (!card17) throw new Error('card 17 missing');
  card17.manualLevels = [
    { level: 1, values: { 'Бонус HP цели': 50 } },
    { level: 2, values: { 'Бонус HP цели': 120 } },
  ];

  const forecastBalance = balanceForForecastSimulation(runtime);
  if (getProtectedTargetBaseHp(forecastBalance.player) !== 200) {
    throw new Error('forecast must use protectedTargetBaseHp from runtime');
  }

  const bonus = getProtectedTargetHpCardBonus(forecastBalance, { 17: 2 });
  if (bonus !== 120) throw new Error(`card 17 bonus expected 120, got ${bonus}`);
  if (resolveProtectedTargetMaxHp(forecastBalance, { 17: 2 }) !== 320) {
    throw new Error('resolveProtectedTargetMaxHp failed');
  }

  const waves = getDefaultReferenceWavesConfig();
  const wave = { levelIndex: 1, waveIndex: 1, enemies: [{ enemyId: 'infantry' as const, count: 5 }] };
  const weak = simulateCombat(forecastBalance, {
    loadout: {
      playerLevel: 1,
      machineGunLevel: 1,
      hydraLevel: 1,
      hellfireLevel: 1,
      supportCardLevels: {},
      allSupportCardLevels: { 17: 2 },
    },
    wave,
  });
  const strong = simulateCombat(forecastBalance, {
    loadout: {
      playerLevel: 1,
      machineGunLevel: 1,
      hydraLevel: 1,
      hellfireLevel: 1,
      supportCardLevels: {},
      allSupportCardLevels: {},
    },
    wave,
  });
  if (weak.playerHp !== 320) {
    throw new Error(`expected max HP 320 with card 17 out of deck, got ${weak.playerHp}`);
  }

  runtime.weapons.machineGun.baseDamage = 1;
  const forecastBalanceWeak = balanceForForecastSimulation(runtime);
  const a = simulateProgressionForecast(forecastBalance, {
    segmentId: 'free',
    playerLevel: 1,
    initialSoft: 0,
    maxAttemptsPerLevel: 50,
    energyPerLevel: 100,
    energyPerAttempt: 1,
    energyStart: 100,
    upgradePolicy: fullWeaponAndSupportUpgradePolicy,
    referenceWavesConfig: waves,
  });
  const b = simulateProgressionForecast(forecastBalanceWeak, {
    segmentId: 'free',
    playerLevel: 1,
    initialSoft: 0,
    maxAttemptsPerLevel: 50,
    energyPerLevel: 100,
    energyPerAttempt: 1,
    energyStart: 100,
    upgradePolicy: fullWeaponAndSupportUpgradePolicy,
    referenceWavesConfig: waves,
  });
  const attemptsStrong = a.levels.find((l) => l.levelIndex === 1)?.attemptsTotal ?? 0;
  const attemptsWeak = b.levels.find((l) => l.levelIndex === 1)?.attemptsTotal ?? 0;
  if (attemptsStrong >= attemptsWeak) {
    throw new Error(`weapon damage should affect attempts: strong=${attemptsStrong} weak=${attemptsWeak}`);
  }
}

runSmoke();
console.log('smoke-forecast-balance: OK');
