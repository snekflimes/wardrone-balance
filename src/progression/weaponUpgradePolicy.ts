import { getWavesPerLevel } from '../balance/economy';
import type { BalanceConstants, WeaponId } from '../balance/model';
import { getMaxWeaponLevelForWeapon } from '../balance/weaponMeta';
import { getWeaponLevelStats } from '../balance/simulator';
import type { ProgressionState, SegmentId, UpgradePolicy } from './types';
import { getWeaponUpgradeSoftCost } from './upgradeCosts';

type WeaponKey = WeaponId;

const weaponToLevelKey: Record<WeaponKey, keyof ProgressionState['weaponLevels']> = {
  machineGun: 'machineGunLevel',
  hydra70: 'hydraLevel',
  hellfire: 'hellfireLevel',
};

function getWeaponLevelValue(state: ProgressionState['weaponLevels'], weaponId: WeaponKey): number {
  return state[weaponToLevelKey[weaponId]];
}

function withWeaponLevelValue(
  state: ProgressionState['weaponLevels'],
  weaponId: WeaponKey,
  nextLevel: number
): ProgressionState['weaponLevels'] {
  return {
    ...state,
    [weaponToLevelKey[weaponId]]: nextLevel,
  } as ProgressionState['weaponLevels'];
}

function computeTotalCombatDps(constants: BalanceConstants, weaponLevels: ProgressionState['weaponLevels']) {
  const ids: WeaponKey[] = ['machineGun', 'hydra70', 'hellfire'];
  return ids.reduce((sum, id) => {
    const lvl = getWeaponLevelValue(weaponLevels, id);
    const stats = getWeaponLevelStats(constants, id, lvl);
    // В прогнозе бой идёт по sustainedDps (с учётом боезапаса),
    // поэтому и выбор апгрейда должен опираться на sustainedDps.
    return sum + stats.sustainedDps;
  }, 0);
}

/** Для платящих: не заливаем весь донат только в пулемёт — штрафуем ветку, сильно ушедшую вперёд по уровню. */
function pickWeaponUpgradeWithDiversity(
  segmentId: SegmentId,
  candidates: Array<{ weaponId: WeaponKey; nextLevel: number; cost: number; dpsGain: number }>,
  weaponLevels: ProgressionState['weaponLevels'],
  unlocked: { machineGun: boolean; hydra70: boolean; hellfire: boolean }
): (typeof candidates)[0] | null {
  if (candidates.length === 0) return null;
  if (segmentId === 'free') {
    candidates.sort((a, b) => b.dpsGain - a.dpsGain);
    return candidates[0];
  }

  const levels: number[] = [];
  if (unlocked.machineGun) levels.push(getWeaponLevelValue(weaponLevels, 'machineGun'));
  if (unlocked.hydra70) levels.push(getWeaponLevelValue(weaponLevels, 'hydra70'));
  if (unlocked.hellfire) levels.push(getWeaponLevelValue(weaponLevels, 'hellfire'));
  const avg = levels.reduce((s, n) => s + n, 0) / Math.max(1, levels.length);

  const diversityWeight = segmentId === 'whale' ? 0.42 : 0.28;

  const scored = candidates.map((c) => {
    const cur = getWeaponLevelValue(weaponLevels, c.weaponId);
    const ahead = Math.max(0, cur - avg);
    const diversity = 1 / (1 + diversityWeight * ahead);
    return { c, score: c.dpsGain * diversity };
  });
  scored.sort((a, b) => b.score - a.score || b.c.dpsGain - a.c.dpsGain);
  return scored[0].c;
}

export const weaponOnlyUpgradePolicy: UpgradePolicy = ({ constants, state, ctx }) => {
  const ids: WeaponKey[] = ['machineGun', 'hydra70', 'hellfire'];
  const wavesPerLevel = getWavesPerLevel(constants);
  const unlocked = state.unlockedWeapons ?? { machineGun: true, hydra70: false, hellfire: false };

  // Раньше у платящих было до 5 апгрейдов оружия за бой — весь софт уходил в стволы,
  // а прокачка карт от софта отставала от бесплатника (у него лимит 1). Оставляем платящим
  // запас на монеты/сундуки карт, но всё ещё больше 1, чем у free.
  const maxUpgradesPerAttempt =
    state.segmentId === 'free' ? 1 : state.segmentId === 'payer' ? 2 : 3;

  let nextState: ProgressionState = {
    ...state,
    lifetimeWeaponUpgradeSoftSpent: state.lifetimeWeaponUpgradeSoftSpent ?? 0,
  };
  for (let step = 0; step < maxUpgradesPerAttempt; step += 1) {
    const candidates: Array<{ weaponId: WeaponKey; nextLevel: number; cost: number; dpsGain: number }> = [];
    const currentTotalDps = computeTotalCombatDps(constants, nextState.weaponLevels);

    for (const weaponId of ids) {
      if (weaponId === 'hydra70' && !unlocked.hydra70) continue;
      if (weaponId === 'hellfire' && !unlocked.hellfire) continue;
      // Не качаем ракеты между волнами одной попытки: иначе EV «лучшего» апгрейда по суммарному DPS
      // отдаёт Гидру/Hellfire, а следующая волна плотная по пехоте — пулемёт недокачан (артефакт).
      if (
        weaponId !== 'machineGun' &&
        ctx.waveIndex >= 1 &&
        ctx.waveIndex < wavesPerLevel
      ) {
        continue;
      }

      const currentLevel = getWeaponLevelValue(nextState.weaponLevels, weaponId);
      const cap = getMaxWeaponLevelForWeapon(constants, weaponId);
      if (currentLevel >= cap) continue;
      const nextLevel = currentLevel + 1;
      const cost = getWeaponUpgradeSoftCost(constants, weaponId, currentLevel);
      if (cost > nextState.softBalance) continue;

      const candidateWeaponLevels = withWeaponLevelValue(nextState.weaponLevels, weaponId, nextLevel);
      const nextTotalDps = computeTotalCombatDps(constants, candidateWeaponLevels);

      candidates.push({
        weaponId,
        nextLevel,
        cost,
        dpsGain: nextTotalDps - currentTotalDps,
      });
    }

    if (candidates.length === 0) break;

    const best = pickWeaponUpgradeWithDiversity(
      state.segmentId,
      candidates,
      nextState.weaponLevels,
      unlocked
    );
    if (!best) break;

    nextState = {
      ...nextState,
      softBalance: Math.max(0, nextState.softBalance - best.cost),
      weaponLevels: withWeaponLevelValue(nextState.weaponLevels, best.weaponId, best.nextLevel),
      lifetimeWeaponUpgradeSoftSpent: (nextState.lifetimeWeaponUpgradeSoftSpent ?? 0) + best.cost,
    };
  }

  return nextState;
};

