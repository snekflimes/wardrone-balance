import type { BalanceConstants, WeaponId } from '../balance/model';

/**
 * Софт за переход currentLevel → currentLevel+1 (формула листа Weapons в референсе).
 * При отсутствии economy.weaponUpgrade — fallback на общую таблицу upgradeCostsByLevel по nextLevel.
 */
export function getWeaponUpgradeSoftCost(
  constants: BalanceConstants,
  weaponId: WeaponId,
  currentLevel: number
): number {
  const weapon = constants.weapons[weaponId];
  const base = weapon.upgradeBaseSoft;
  const costCoeff = weapon.upgradeCostMultiplier;
  if (currentLevel >= 1 && (base ?? 0) > 0 && (costCoeff ?? 0) >= 0) {
    // Линейная цена апгрейда (как урон/боезапас):
    // cost(L → L+1) = base + base * coeff * L, где L — текущий уровень оружия (1..).
    return (base as number) + (base as number) * (costCoeff as number) * currentLevel;
  }

  // Legacy fallback: старые сохранения держали цену апгрейда в economy.weaponUpgrade.
  const legacyCfg = constants.economy.weaponUpgrade;
  if (legacyCfg?.baseSoft && legacyCfg.costMultiplier != null) {
    const legacyBase =
      weaponId === 'machineGun'
        ? legacyCfg.baseSoft.machineGun
        : weaponId === 'hydra70'
          ? legacyCfg.baseSoft.hydra70
          : legacyCfg.baseSoft.hellfire;
    if (currentLevel >= 1 && legacyBase > 0) {
      // Legacy в экономике был экспоненциальный множитель (например 1.8).
      // Для линейной модели интерпретируем как coeff = mult - 1.
      const coeff = legacyCfg.costMultiplier > 1 ? legacyCfg.costMultiplier - 1 : legacyCfg.costMultiplier;
      return legacyBase + legacyBase * coeff * currentLevel;
    }
  }

  const nextLevel = currentLevel + 1;
  return getUpgradeCosts(constants, nextLevel).soft;
}

export function getUpgradeCosts(constants: BalanceConstants, nextLevel: number): { soft: number; blueprints: number } {
  const row = constants.economy.upgradeCostsByLevel?.[String(nextLevel)];
  if (row) {
    return {
      soft: row.soft ?? 0,
      blueprints: row.blueprints ?? 0,
    };
  }

  const legacy = constants.cardUpgradeCosts?.[String(nextLevel)];
  return {
    soft: legacy?.common ?? 0,
    blueprints: legacy?.cards ?? 0,
  };
}

