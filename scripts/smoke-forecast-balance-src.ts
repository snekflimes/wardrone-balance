import { BALANCE_CONSTANTS } from '../src/balance/model';
import { balanceForForecastSimulation } from '../src/balance/balanceForForecastSimulation';
import { simulateProgressionForecast } from '../src/progression/progressionSimulator';
import { fullWeaponAndSupportUpgradePolicy } from '../src/progression/fullUpgradePolicy';
import { getDefaultReferenceWavesConfig } from '../src/balance/referenceWaves';

export function runSmoke(): void {
  const runtime = structuredClone(BALANCE_CONSTANTS) as typeof BALANCE_CONSTANTS;
  runtime.weapons.machineGun.baseDamage = 9999;
  runtime.supportCards[0] = {
    ...runtime.supportCards[0]!,
    name: 'smoke-card',
    manualLevels: runtime.supportCards[0]!.manualLevels,
  };
  runtime.player.baseAllyHp = 77777;

  const forecastBalance = balanceForForecastSimulation(runtime);

  if (forecastBalance.weapons.machineGun.baseDamage !== 9999) {
    throw new Error('forecast balance must use runtime weapons from «Оружие и карты»');
  }
  if (forecastBalance.player.baseAllyHp !== 77777) {
    throw new Error('forecast balance must use runtime player HP');
  }
  if (forecastBalance.supportCards[0]?.name !== 'smoke-card') {
    throw new Error('forecast balance must use runtime supportCards');
  }

  const waves = getDefaultReferenceWavesConfig();
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

  runtime.weapons.machineGun.baseDamage = 1;
  const forecastBalanceWeak = balanceForForecastSimulation(runtime);
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
    throw new Error(
      `weapon damage should affect attempts: strong=${attemptsStrong} weak=${attemptsWeak}`
    );
  }
}

runSmoke();
console.log('smoke-forecast-balance: OK');
