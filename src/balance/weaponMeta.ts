import type { BalanceConstants, WeaponId } from './model';

/** Максимальный уровень для конкретного оружия (референс: MG 100 / Hydra 40 / Hellfire 20). */
export function getMaxWeaponLevelForWeapon(constants: BalanceConstants, weaponId: WeaponId): number {
  const m = constants.meta;
  switch (weaponId) {
    case 'machineGun':
      return m.maxMachineGunLevel ?? m.maxWeaponLevel;
    case 'hydra70':
      return m.maxHydraLevel ?? m.maxWeaponLevel;
    case 'hellfire':
      return m.maxHellfireLevel ?? m.maxWeaponLevel;
    default:
      return m.maxWeaponLevel;
  }
}

export function getMaxWeaponLevelAcross(constants: BalanceConstants): number {
  return Math.max(
    getMaxWeaponLevelForWeapon(constants, 'machineGun'),
    getMaxWeaponLevelForWeapon(constants, 'hydra70'),
    getMaxWeaponLevelForWeapon(constants, 'hellfire')
  );
}
