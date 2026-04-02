import type { WaveDefinition, WaveEnemyGroup } from './schema';
import type { EnemyId, BalanceConstants } from './model';

/** Перенос старых ключей сохранений/редактора (tank → heavyTank). */
export function migrateLegacyEnemyWaveCounts(row: Record<string, number | undefined>): void {
  const n = row.tank;
  if (n != null && n > 0) {
    row.heavyTank = (row.heavyTank ?? 0) + n;
    delete row.tank;
  }
}

function groupsFor(
  enemyCounts: Partial<Record<EnemyId, number>>,
): WaveEnemyGroup[] {
  const groups: WaveEnemyGroup[] = [];
  (Object.keys(enemyCounts) as EnemyId[]).forEach((enemyId) => {
    const count = enemyCounts[enemyId];
    if (count != null && count > 0) {
      groups.push({ enemyId, count });
    }
  });
  return groups;
}

/**
 * Референс состава волн — база CreateSheets (пехота / джип / БТР / броня),
 * плюс разбиение «танка» на лёгкий/тяжёлый, РСЗО и бензовоз-камикадзе.
 * Вертолёты и прочие типы = 0. Уровни 8+ — та же логика хвоста.
 */
function wave2InfantryCount(levelIndex: number): number {
  let v = 8;
  for (let L = 1; L < levelIndex; L += 1) {
    v += L % 2 === 1 ? 4 : 6;
  }
  return v;
}

function legacyTankCountWave1(L: number): number {
  return L <= 1 ? 0 : Math.max(0, 2 * L - 3);
}

function legacyTankCountWave2(L: number): number {
  return Math.max(0, 2 * (L - 1));
}

function createReferenceWaveEnemies(levelIndex: number, waveIndex: number): Partial<Record<EnemyId, number>> {
  const L = Math.max(1, levelIndex);
  if (waveIndex === 1) {
    const oldT = legacyTankCountWave1(L);
    return {
      infantry: 5 * L,
      jeep: 2 * L,
      apc: L <= 1 ? 0 : 2 * (L - 1),
      heavyTank: oldT <= 0 ? 0 : Math.ceil(oldT * 0.55),
      lightTank: oldT <= 0 ? 0 : Math.floor(oldT * 0.45) + (L >= 3 ? 1 : 0),
      mlrs: L >= 5 ? Math.max(0, L - 4) : 0,
      fuelTruck: L >= 7 ? 1 + (L >= 12 ? 1 : 0) : L >= 5 ? 1 : 0,
    };
  }
  const oldT2 = legacyTankCountWave2(L);
  return {
    infantry: wave2InfantryCount(L),
    jeep: 2 * L + 1,
    apc: Math.max(0, 2 * L - 1),
    heavyTank: oldT2 <= 0 ? 0 : Math.ceil(oldT2 * 0.55),
    lightTank: oldT2 <= 0 ? 0 : Math.floor(oldT2 * 0.45) + (L >= 2 ? 1 : 0),
    mlrs: Math.max(0, L - 3),
    fuelTruck: L >= 6 ? 1 + (L >= 11 ? 1 : 0) : L >= 4 ? 1 : 0,
  };
}

const EMPTY_ENEMY_TOTALS: Record<EnemyId, number> = {
  infantry: 0,
  jeep: 0,
  apc: 0,
  lightTank: 0,
  heavyTank: 0,
  mlrs: 0,
  fuelTruck: 0,
  heli: 0,
  plane: 0,
  heavyInfantry: 0,
};

/** Сумма юнитов по всем волнам, для таблицы прогноза. */
export function aggregateWaveEnemyCounts(waves: WaveDefinition[]): Record<EnemyId, number> {
  const base: Record<EnemyId, number> = { ...EMPTY_ENEMY_TOTALS };
  for (const w of waves) {
    for (const g of w.enemies) {
      const id = g.enemyId as EnemyId;
      base[id] = (base[id] ?? 0) + g.count;
    }
  }
  return base;
}

function buildReferenceWaves(levelsCount: number): Record<number, Record<number, WaveDefinition>> {
  const out: Record<number, Record<number, WaveDefinition>> = {};
  for (let levelIndex = 1; levelIndex <= levelsCount; levelIndex += 1) {
    out[levelIndex] = {
      1: {
        levelIndex,
        waveIndex: 1,
        enemies: groupsFor(createReferenceWaveEnemies(levelIndex, 1)),
      },
      2: {
        levelIndex,
        waveIndex: 2,
        enemies: groupsFor(createReferenceWaveEnemies(levelIndex, 2)),
      },
    };
  }
  return out;
}

export const REFERENCE_WAVES: Record<number, Record<number, WaveDefinition>> = buildReferenceWaves(15);

export function getReferenceWave(levelIndex: number, waveIndex: number): WaveDefinition {
  const lvl = REFERENCE_WAVES[levelIndex];
  const wave = lvl?.[waveIndex];
  if (!wave) {
    // Не падаем: если wavesPerLevel/конфиг расширен, а у нас нет данных по волне,
    // считаем волну пустой.
    return { levelIndex, waveIndex, enemies: [] };
  }
  return wave;
}

export type UnitsPerLevel = Record<number, Record<EnemyId, number>>;

export type ReferenceWaveEnemies = Partial<Record<EnemyId, number>>;

export type ReferenceWavesConfig = Record<number, Record<number, ReferenceWaveEnemies>>;

export function migrateReferenceWavesConfig(cfg: ReferenceWavesConfig): ReferenceWavesConfig {
  const next = JSON.parse(JSON.stringify(cfg)) as ReferenceWavesConfig;
  for (const level of Object.values(next)) {
    if (!level) continue;
    for (const wave of Object.values(level)) {
      if (!wave) continue;
      migrateLegacyEnemyWaveCounts(wave as Record<string, number>);
    }
  }
  return next;
}

export function getDefaultReferenceWavesConfig(): ReferenceWavesConfig {
  const cfg: ReferenceWavesConfig = {};
  for (const [levelIdxStr, waves] of Object.entries(REFERENCE_WAVES)) {
    const levelIdx = Number(levelIdxStr);
    cfg[levelIdx] = {};
    for (const [waveIdxStr, waveDef] of Object.entries(waves)) {
      const waveIdx = Number(waveIdxStr);
      const enemies: ReferenceWaveEnemies = {};
      for (const g of waveDef.enemies) {
        enemies[g.enemyId] = g.count;
      }
      cfg[levelIdx][waveIdx] = enemies;
    }
  }
  return cfg;
}

export function getReferenceWaveFromConfig(
  config: ReferenceWavesConfig,
  levelIndex: number,
  waveIndex: number
): WaveDefinition {
  const waveEnemies = config[levelIndex]?.[waveIndex];
  if (!waveEnemies) {
    // Строгий режим: никаких скрытых fallback'ов из REFERENCE_WAVES.
    // Если волна не задана в пользовательском конфиге — считаем её пустой.
    return { levelIndex, waveIndex, enemies: [] };
  }

  const migrated = { ...waveEnemies } as Record<string, number>;
  migrateLegacyEnemyWaveCounts(migrated);

  const groups: WaveEnemyGroup[] = [];
  for (const enemyId of Object.keys(migrated) as EnemyId[]) {
    const count = migrated[enemyId];
    if (count != null && count > 0) {
      groups.push({ enemyId, count });
    }
  }

  return {
    levelIndex,
    waveIndex,
    enemies: groups,
  };
}

export function getUnitsPerLevelFromConfig(config: ReferenceWavesConfig, gameLevels: number): UnitsPerLevel {
  const unitsPerLevel: UnitsPerLevel = {};
  for (let levelIndex = 1; levelIndex <= gameLevels; levelIndex += 1) {
    const base: Record<EnemyId, number> = { ...EMPTY_ENEMY_TOTALS };

    const waves = config[levelIndex];
    if (waves && Object.keys(waves).length > 0) {
      Object.values(waves).forEach((waveEnemies) => {
        const row = { ...waveEnemies } as Record<string, number>;
        migrateLegacyEnemyWaveCounts(row);
        for (const enemyId of Object.keys(row) as EnemyId[]) {
          const count = row[enemyId];
          if (count != null && count > 0) {
            base[enemyId] += count;
          }
        }
      });
    }

    unitsPerLevel[levelIndex] = base;
  }
  return unitsPerLevel;
}

export function getUnitsPerLevel(gameLevels: number): UnitsPerLevel {
  const unitsPerLevel: UnitsPerLevel = {};
  for (let levelIndex = 1; levelIndex <= gameLevels; levelIndex += 1) {
    const base: Record<EnemyId, number> = { ...EMPTY_ENEMY_TOTALS };

    const waves = REFERENCE_WAVES[levelIndex];
    if (!waves) continue;

    Object.values(waves).forEach((wave) => {
      wave.enemies.forEach((g) => {
        base[g.enemyId] += g.count;
      });
    });

    unitsPerLevel[levelIndex] = base;
  }
  return unitsPerLevel;
}

/**
 * Удобный хелпер: UnitsPerLevel на основе текущих gameLevels из balance.
 */
export function getUnitsPerLevelFromBalance(constants: BalanceConstants): UnitsPerLevel {
  return getUnitsPerLevel(constants.meta.gameLevels);
}

