/**
 * В `progressionSimulator` Гидра и Hellfire в бою включаются с `levelIndex >= 2`
 * (`unlockedWeapons`). До этого в состоянии всё равно лежат уровни ≥1 (для кода
 * апгрейдов) — в UI для завершённого игрового уровня < 2 показываем «—».
 */
export const FIRST_GAME_LEVEL_WITH_ROCKETS_IN_COMBAT = 2;

export function rocketWeaponLevelDisplay(completedGameLevel: number, storedLevel: number): string {
  if (completedGameLevel < FIRST_GAME_LEVEL_WITH_ROCKETS_IN_COMBAT) return '—';
  return String(storedLevel);
}

export function showRocketLevelsInSummary(maxSimulatedGameLevel: number): boolean {
  return maxSimulatedGameLevel >= FIRST_GAME_LEVEL_WITH_ROCKETS_IN_COMBAT;
}
