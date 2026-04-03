import React, { useMemo, useState } from 'react';
import type {
  BalanceConstants,
  SupportCardConfig,
  CardRarity,
  SupportCardManualLevel,
} from '../balance/model';
import { getWeaponLevelStats, getWaveStats } from '../balance/simulator';
import { getReferenceWaveFromConfig, type ReferenceWavesConfig } from '../balance/referenceWaves';
import { getMaxWeaponLevelForWeapon } from '../balance/weaponMeta';
import { getWeaponUpgradeSoftCost } from '../progression/upgradeCosts';
import {
  getSupportCardLevelsForEditor,
  snapshotSupportCardManualLevelsForEditor,
} from '../balance/cards';
import {
  getSupportCardColumnOrder,
  getSupportCardParameterPresetsForCard,
  isSupportCardColumnRecognized,
  supportCardHasColumnTitle,
  SUPPORT_CARD_BATTLE_COLUMN_HINT,
  type SupportCardBattleParameterPreset,
} from '../balance/supportCardRowSemantics';

type SetBalance = React.Dispatch<React.SetStateAction<BalanceConstants>>;
type WeaponId = 'machineGun' | 'hydra70' | 'hellfire';

/** Парсинг числа с учётом запятой как десятичного разделителя (RU-локаль). */
function parseLocaleNumber(raw: string): number {
  const normalized = raw.trim().replace(/\s/g, '').replace(/,/g, '.');
  if (normalized === '' || normalized === '.' || normalized === '-') return Number.NaN;
  return Number(normalized);
}

/** Убираем артефакты float в коэффициентах для полей ввода. */
function roundCoeff(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e8) / 1e8;
}

function getWeaponUpgradeBaseSoft(balance: BalanceConstants, weaponId: WeaponId): number {
  const w = balance.weapons[weaponId];
  if (w.upgradeBaseSoft != null) return w.upgradeBaseSoft;
  return weaponId === 'machineGun' ? 300 : weaponId === 'hydra70' ? 500 : 800;
}

function getWeaponUpgradeCostMultiplier(balance: BalanceConstants, weaponId: WeaponId): number {
  return balance.weapons[weaponId].upgradeCostMultiplier ?? 0.8;
}

type PrecisionMap = Record<string, boolean>;
type DisplayPreset = 'full' | 'compact' | 'minimal';

const sectionStyle: React.CSSProperties = {
  marginTop: 0,
  padding: 14,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  borderRadius: 14,
  background: 'rgba(15, 23, 42, 0.55)',
};

const cardStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  border: '1px solid rgba(148, 163, 184, 0.22)',
  borderRadius: 12,
  background: 'rgba(2, 6, 23, 0.55)',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: 12,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 90,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(15, 23, 42, 0.9)',
  color: '#e2e8f0',
  boxSizing: 'border-box',
};

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: 999,
  background: 'rgba(30, 41, 59, 0.9)',
  color: '#e2e8f0',
  padding: '4px 8px',
  fontSize: 11,
};

function roundCell(value: number | null | undefined, integer: boolean): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (integer) return Math.round(value).toLocaleString('ru-RU');
  return Number(value).toFixed(2);
}

function setWeaponField(
  setBalance: SetBalance,
  weaponId: WeaponId,
  key:
    | 'displayName'
    | 'baseDamage'
    | 'baseFireRatePerMin'
    | 'baseAmmo'
    | 'upgradeBaseSoft'
    | 'upgradeCostMultiplier',
  value: string | number
) {
  setBalance((prev) => ({
    ...prev,
    weapons: {
      ...prev.weapons,
      [weaponId]: {
        ...prev.weapons[weaponId],
        [key]: value as never,
      },
    },
  }));
}

function setGrowthField(
  setBalance: SetBalance,
  weaponId: WeaponId,
  key: 'damageMultiplierPerLevel' | 'fireRateMultiplierPerLevel' | 'ammoMultiplierPerLevel',
  value: number
) {
  setBalance((prev) => ({
    ...prev,
    weapons: {
      ...prev.weapons,
      [weaponId]: {
        ...prev.weapons[weaponId],
        growth: { ...prev.weapons[weaponId].growth, [key]: value },
      },
    },
  }));
}

function updateCard(
  setBalance: SetBalance,
  cardId: number,
  patch: Partial<SupportCardConfig>
) {
  setBalance((prev) => ({
    ...prev,
    supportCards: prev.supportCards.map((card) =>
      card.id === cardId ? { ...card, ...patch } : card
    ),
  }));
}

function getCurrentManualLevels(
  balance: BalanceConstants,
  card: SupportCardConfig
): SupportCardManualLevel[] {
  if (card.manualLevels?.length) return card.manualLevels;
  return snapshotSupportCardManualLevelsForEditor(balance, card.id);
}

function updateManualLevelField(
  setBalance: SetBalance,
  cardId: number,
  levelIndex: number,
  column: string,
  value: number | null
) {
  setBalance((prev) => {
    const card = prev.supportCards.find((item) => item.id === cardId);
    if (!card) return prev;
    const baseLevels = card.manualLevels?.length
      ? card.manualLevels
      : snapshotSupportCardManualLevelsForEditor(prev, cardId);
    const nextLevels = baseLevels.map((row) => ({ ...row }));
    nextLevels[levelIndex] = {
      ...nextLevels[levelIndex],
      level: levelIndex + 1,
      values: {
        ...(nextLevels[levelIndex]?.values ?? {}),
        [column]: value,
      },
    };
    return {
      ...prev,
      supportCards: prev.supportCards.map((item) =>
        item.id === cardId ? { ...item, manualLevels: nextLevels } : item
      ),
    };
  });
}

function updateCardUpgradeCost(
  setBalance: SetBalance,
  level: string,
  key: keyof BalanceConstants['cardUpgradeCosts'][string],
  value: number
) {
  setBalance((prev) => ({
    ...prev,
    cardUpgradeCosts: {
      ...prev.cardUpgradeCosts,
      [level]: {
        ...prev.cardUpgradeCosts[level],
        [key]: value,
      },
    },
  }));
}

function copyCardConfig(
  setBalance: SetBalance,
  sourceId: number,
  targetId: number
) {
  if (sourceId === targetId) return;
  setBalance((prev) => {
    const source = prev.supportCards.find((card) => card.id === sourceId);
    if (!source) return prev;
    return {
      ...prev,
      supportCards: prev.supportCards.map((card) =>
        card.id === targetId
          ? {
              ...card,
              name: source.name,
              rarity: source.rarity,
              type: source.type,
              unlockAfterLevel: source.unlockAfterLevel,
              firstBlueprints: source.firstBlueprints,
              tableColumns: source.tableColumns,
              manualLevels: source.manualLevels?.map((row) => ({
                level: row.level,
                values: { ...row.values },
              })),
            }
          : card
      ),
    };
  });
}

function PrecisionHeader({
  label,
  keyName,
  precision,
  onToggle,
}: {
  label: string;
  keyName: string;
  precision: PrecisionMap;
  onToggle: (key: string) => void;
}) {
  return (
    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4, verticalAlign: 'top' }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <span>{label}</span>
        <button
          type="button"
          style={smallButtonStyle}
          onClick={() => onToggle(keyName)}
          title="Сокращение значений до целых отдельно для этого столбца"
        >
          {precision[keyName] ? 'Целые' : 'Дробные'}
        </button>
      </div>
    </th>
  );
}

function formatNullableNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(1);
}

function weaponSummaryRows(balance: BalanceConstants, weaponId: WeaponId) {
  const cap = getMaxWeaponLevelForWeapon(balance, weaponId);
  return Array.from({ length: cap }, (_, index) => {
    const level = index + 1;
    return getWeaponLevelStats(balance, weaponId, level);
  });
}

function WeaponProgressionTable({
  balance,
  weaponId,
  precision,
  preset,
  onTogglePrecision,
}: {
  balance: BalanceConstants;
  weaponId: WeaponId;
  precision: PrecisionMap;
  preset: DisplayPreset;
  onTogglePrecision: (key: string) => void;
}) {
  const rows = useMemo(() => weaponSummaryRows(balance, weaponId), [balance, weaponId]);
  const cap = getMaxWeaponLevelForWeapon(balance, weaponId);
  const columns = {
    damage: preset !== 'minimal',
    fireRate: preset !== 'minimal',
    ammo: preset !== 'compact',
    dps: true,
    sustainedDps: true,
    upgradeCost: preset !== 'minimal',
  };
  const prefix = `weapon.${weaponId}`;

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Ур. оружия</th>
          {columns.damage && <PrecisionHeader label="Урон" keyName={`${prefix}.damage`} precision={precision} onToggle={onTogglePrecision} />}
          {columns.fireRate && <PrecisionHeader label="Скорострельность" keyName={`${prefix}.fireRate`} precision={precision} onToggle={onTogglePrecision} />}
          {columns.ammo && <PrecisionHeader label="Боезапас" keyName={`${prefix}.ammo`} precision={precision} onToggle={onTogglePrecision} />}
          {columns.dps && <PrecisionHeader label="DPS" keyName={`${prefix}.dps`} precision={precision} onToggle={onTogglePrecision} />}
          {columns.sustainedDps && <PrecisionHeader label="Устойчивый DPS" keyName={`${prefix}.sustainedDps`} precision={precision} onToggle={onTogglePrecision} />}
          {columns.upgradeCost && (
            <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4, color: '#94a3b8', fontSize: 11 }}>
              Софт → след. ур.
              <div style={{ fontWeight: 400, fontSize: 10, marginTop: 4 }}>лист Weapons</div>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.level}>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{row.level}</td>
            {columns.damage && <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{roundCell(row.damagePerShot, precision[`${prefix}.damage`])}</td>}
            {columns.fireRate && <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{roundCell(row.fireRatePerMin, precision[`${prefix}.fireRate`])}</td>}
            {columns.ammo && <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{roundCell(row.ammo, precision[`${prefix}.ammo`])}</td>}
            {columns.dps && <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{roundCell(row.dps, precision[`${prefix}.dps`])}</td>}
            {columns.sustainedDps && <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{roundCell(row.sustainedDps, precision[`${prefix}.sustainedDps`])}</td>}
            {columns.upgradeCost && (
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                {row.level >= cap
                  ? '—'
                  : Math.round(getWeaponUpgradeSoftCost(balance, weaponId, row.level)).toLocaleString('ru-RU')}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WeaponGameLevelTable({
  balance,
  weaponId,
  precision,
  onTogglePrecision,
  referenceWavesConfig,
  referenceWavesRevision,
}: {
  balance: BalanceConstants;
  weaponId: WeaponId;
  precision: PrecisionMap;
  onTogglePrecision: (key: string) => void;
  referenceWavesConfig: ReferenceWavesConfig;
  referenceWavesRevision: number;
}) {
  const rows = useMemo(() => {
    const result: Array<{
      gameLevel: number;
      weaponLevel: number;
      wave: string;
      requiredDps: number;
      sustainedDps: number;
      margin: number;
      pass: boolean;
    }> = [];
    const weaponCap = getMaxWeaponLevelForWeapon(balance, weaponId);
    for (let gameLevel = 1; gameLevel <= balance.meta.gameLevels; gameLevel += 1) {
      const wave = getReferenceWaveFromConfig(referenceWavesConfig, gameLevel, 1);
      const waveStats = getWaveStats(balance, wave);
      const weaponLevel = Math.min(gameLevel, weaponCap);
      const weaponStats = getWeaponLevelStats(balance, weaponId, weaponLevel);
      result.push({
        gameLevel,
        weaponLevel,
        wave: wave.enemies
          .map((group) => {
            const e = balance.enemies[group.enemyId as keyof typeof balance.enemies];
            const name = e?.displayName ?? group.enemyId;
            return `${name} × ${group.count}`;
          })
          .join(', '),
        requiredDps: waveStats.requiredDps,
        sustainedDps: weaponStats.sustainedDps,
        margin: weaponStats.sustainedDps - waveStats.requiredDps,
        pass: weaponStats.sustainedDps >= waveStats.requiredDps,
      });
    }
    return result;
  }, [balance, weaponId, referenceWavesConfig, referenceWavesRevision]);
  const prefix = `weapon.${weaponId}.game`;

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Игровой ур.</th>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Волна</th>
          <PrecisionHeader label="Треб. DPS" keyName={`${prefix}.requiredDps`} precision={precision} onToggle={onTogglePrecision} />
          <PrecisionHeader label="Ур. оружия" keyName={`${prefix}.weaponLevel`} precision={precision} onToggle={onTogglePrecision} />
          <PrecisionHeader label="DPS оружия" keyName={`${prefix}.sustainedDps`} precision={precision} onToggle={onTogglePrecision} />
          <PrecisionHeader label="Запас" keyName={`${prefix}.margin`} precision={precision} onToggle={onTogglePrecision} />
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Проходит</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.gameLevel}>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{row.gameLevel}</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{row.wave}</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{roundCell(row.requiredDps, precision[`${prefix}.requiredDps`])}</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{row.weaponLevel}</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{roundCell(row.sustainedDps, precision[`${prefix}.sustainedDps`])}</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4, color: row.pass ? '#86efac' : '#fca5a5' }}>
              {roundCell(row.margin, precision[`${prefix}.margin`])}
            </td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{row.pass ? 'Да' : 'Нет'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WeaponCardSection({
  balance,
  weaponId,
  precision,
  preset,
  onTogglePrecision,
  setBalance,
  referenceWavesConfig,
  referenceWavesRevision,
}: {
  balance: BalanceConstants;
  weaponId: WeaponId;
  precision: PrecisionMap;
  preset: DisplayPreset;
  onTogglePrecision: (key: string) => void;
  setBalance: SetBalance;
  referenceWavesConfig: ReferenceWavesConfig;
  referenceWavesRevision: number;
}) {
  const weapon = balance.weapons[weaponId];
  const maxLv = getMaxWeaponLevelForWeapon(balance, weaponId);
  const upgradeBase = getWeaponUpgradeBaseSoft(balance, weaponId);
  const upgradeMult = getWeaponUpgradeCostMultiplier(balance, weaponId);
  return (
    <div style={cardStyle}>
      <h4 style={{ marginTop: 0, marginBottom: 10 }}>
        {weapon.displayName}
        <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>макс. ур. {maxLv}</span>
      </h4>
      <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#94a3b8' }}>
        Апгрейд (софт): база <strong style={{ color: '#e2e8f0' }}>{upgradeBase.toLocaleString('ru-RU')}</strong>
        , рост стоимости <strong style={{ color: '#e2e8f0' }}>+{upgradeMult}×</strong> за уровень (линейно, как в референсе).
      </p>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Параметр</th>
            <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Значение</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Название</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                value={weapon.displayName}
                onChange={(e) => setWeaponField(setBalance, weaponId, 'displayName', e.target.value)}
              />
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Базовый урон</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                value={weapon.baseDamage}
                onChange={(e) => setWeaponField(setBalance, weaponId, 'baseDamage', Number(e.target.value) || 0)}
              />
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Выстр./мин</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                value={weapon.baseFireRatePerMin}
                onChange={(e) => setWeaponField(setBalance, weaponId, 'baseFireRatePerMin', Number(e.target.value) || 0)}
              />
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Боезапас</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                value={weapon.baseAmmo}
                onChange={(e) => setWeaponField(setBalance, weaponId, 'baseAmmo', Number(e.target.value) || 0)}
              />
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Перезарядка (сек)</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                step="0.1"
                value={weapon.reloadTimeSec ?? ''}
                placeholder="по умолчанию"
                onChange={(e) => {
                  const v = e.target.value;
                  setBalance((prev) => ({
                    ...prev,
                    weapons: {
                      ...prev.weapons,
                      [weaponId]: {
                        ...prev.weapons[weaponId],
                        reloadTimeSec:
                          v === '' ? undefined : Number.isFinite(Number(v)) ? Number(v) : prev.weapons[weaponId].reloadTimeSec,
                      },
                    },
                  }));
                }}
              />
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>База софта апгрейда</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                min={0}
                value={weapon.upgradeBaseSoft ?? upgradeBase}
                onChange={(e) => setWeaponField(setBalance, weaponId, 'upgradeBaseSoft', Number(e.target.value) || 0)}
              />
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Коэфф. роста стоимости</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                step="0.01"
                min={0}
                value={roundCoeff(weapon.upgradeCostMultiplier ?? upgradeMult)}
                onChange={(e) => {
                  const v = parseLocaleNumber(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setWeaponField(setBalance, weaponId, 'upgradeCostMultiplier', roundCoeff(v));
                }}
              />
            </td>
          </tr>
        </tbody>
      </table>

      <h5 style={{ marginBottom: 8 }}>Свой рост оружия</h5>
      <p style={{ margin: '0 0 8px 0', fontSize: 11, color: '#94a3b8' }}>
        Урон и боезапас — линейно: база + база × коэфф × <code style={{ color: '#cbd5e1' }}>levelIndex</code> (0 на ур.1).
        Скорострельность — по-прежнему ×pow на шаг.
      </p>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Параметр</th>
            <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Коэфф. / множитель</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Урон (линейный коэфф.)</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                step="0.01"
                value={roundCoeff(weapon.growth.damageMultiplierPerLevel)}
                onChange={(e) => {
                  const v = parseLocaleNumber(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setGrowthField(setBalance, weaponId, 'damageMultiplierPerLevel', roundCoeff(v));
                }}
              />
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Скорострельность (pow / шаг)</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                step="0.01"
                value={roundCoeff(weapon.growth.fireRateMultiplierPerLevel)}
                onChange={(e) => {
                  const v = parseLocaleNumber(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setGrowthField(setBalance, weaponId, 'fireRateMultiplierPerLevel', roundCoeff(v) || 1);
                }}
              />
            </td>
          </tr>
          <tr>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Боезапас (линейный коэфф.)</td>
            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
              <input
                style={inputStyle}
                type="number"
                step="0.01"
                value={roundCoeff(weapon.growth.ammoMultiplierPerLevel)}
                onChange={(e) => {
                  const v = parseLocaleNumber(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setGrowthField(setBalance, weaponId, 'ammoMultiplierPerLevel', roundCoeff(v));
                }}
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 12 }}>
        <h5 style={{ margin: '0 0 8px 0' }}>Прокачка оружия по уровням</h5>
        <WeaponProgressionTable
          balance={balance}
          weaponId={weaponId}
          precision={precision}
          preset={preset}
          onTogglePrecision={onTogglePrecision}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <h5 style={{ margin: '0 0 8px 0' }}>Проверка на игровых уровнях</h5>
        <WeaponGameLevelTable
          balance={balance}
          weaponId={weaponId}
          precision={precision}
          onTogglePrecision={onTogglePrecision}
          referenceWavesConfig={referenceWavesConfig}
          referenceWavesRevision={referenceWavesRevision}
        />
      </div>
    </div>
  );
}

function getCardColumns(card: SupportCardConfig): string[] {
  return getSupportCardColumnOrder(card);
}

function addSupportCardColumn(setBalance: SetBalance, cardId: number, rawName: string) {
  const name = rawName.trim();
  if (!name) return;
  setBalance((prev) => {
    const card = prev.supportCards.find((c) => c.id === cardId);
    if (!card) return prev;
    const order = getSupportCardColumnOrder(card);
    if (order.includes(name)) return prev;
    const nextOrder = [...order, name];
    const baseLevels = card.manualLevels?.length
      ? card.manualLevels.map((r) => ({ ...r, values: { ...r.values } }))
      : snapshotSupportCardManualLevelsForEditor(prev, cardId);
    const nextLevels = baseLevels.map((row) => ({
      ...row,
      values: { ...row.values, [name]: row.values?.[name] ?? 0 },
    }));
    return {
      ...prev,
      supportCards: prev.supportCards.map((c) =>
        c.id === cardId ? { ...c, tableColumns: nextOrder, manualLevels: nextLevels } : c
      ),
    };
  });
}

function removeSupportCardColumn(setBalance: SetBalance, cardId: number, columnName: string) {
  setBalance((prev) => {
    const card = prev.supportCards.find((c) => c.id === cardId);
    if (!card) return prev;
    const order = getSupportCardColumnOrder(card);
    const nextOrder = order.filter((c) => c !== columnName);
    if (nextOrder.length === order.length || nextOrder.length === 0) return prev;
    const baseLevels = card.manualLevels?.length
      ? card.manualLevels.map((r) => ({ ...r, values: { ...r.values } }))
      : snapshotSupportCardManualLevelsForEditor(prev, cardId);
    const nextLevels = baseLevels.map((row) => {
      const { [columnName]: _rm, ...rest } = row.values ?? {};
      return { ...row, values: rest };
    });
    return {
      ...prev,
      supportCards: prev.supportCards.map((c) =>
        c.id === cardId ? { ...c, tableColumns: nextOrder, manualLevels: nextLevels } : c
      ),
    };
  });
}

function moveSupportCardColumn(setBalance: SetBalance, cardId: number, fromIndex: number, delta: number) {
  setBalance((prev) => {
    const card = prev.supportCards.find((c) => c.id === cardId);
    if (!card) return prev;
    const order = [...getSupportCardColumnOrder(card)];
    const toIndex = fromIndex + delta;
    if (toIndex < 0 || toIndex >= order.length) return prev;
    const next = [...order];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    return {
      ...prev,
      supportCards: prev.supportCards.map((c) =>
        c.id === cardId ? { ...c, tableColumns: next } : c
      ),
    };
  });
}

function groupPresetsByGroup(presets: SupportCardBattleParameterPreset[]): Map<string, SupportCardBattleParameterPreset[]> {
  const m = new Map<string, SupportCardBattleParameterPreset[]>();
  for (const p of presets) {
    const list = m.get(p.group) ?? [];
    list.push(p);
    m.set(p.group, list);
  }
  return m;
}

function formatCellInputValue(value: number | null | undefined, integer: boolean): string {
  if (value == null || Number.isNaN(value)) return '';
  return integer ? String(Math.round(value)) : String(value);
}

const primaryActionStyle: React.CSSProperties = {
  border: '1px solid rgba(56, 189, 248, 0.55)',
  borderRadius: 8,
  background: 'linear-gradient(180deg, rgba(14, 165, 233, 0.35), rgba(2, 132, 199, 0.25))',
  color: '#f0f9ff',
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
};

function CardColumnsManager({
  card,
  setBalance,
}: {
  card: SupportCardConfig;
  setBalance: SetBalance;
}) {
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const cols = getSupportCardColumnOrder(card);
  const presets = useMemo(
    () => getSupportCardParameterPresetsForCard(card),
    [card.id, card.param1Name, card.param2Name]
  );
  const grouped = useMemo(() => groupPresetsByGroup(presets), [presets]);

  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const canAdd =
    Boolean(selectedPresetId && selectedPreset && !supportCardHasColumnTitle(card, selectedPreset.columnTitle));

  return (
    <div
      style={{
        marginBottom: 14,
        padding: '12px 14px',
        background: 'rgba(2, 6, 23, 0.5)',
        borderRadius: 12,
        border: '1px solid rgba(148,163,184,0.2)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, marginBottom: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px', minWidth: 200 }}>
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Добавить параметр
          </span>
          <select
            className="input-stretch"
            style={{ ...inputStyle, width: '100%', minWidth: 0 }}
            value={selectedPresetId}
            onChange={(e) => setSelectedPresetId(e.target.value)}
          >
            <option value="">Выберите из списка…</option>
            {[...grouped.entries()].map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((p) => {
                  const taken = supportCardHasColumnTitle(card, p.columnTitle);
                  return (
                    <option key={`${p.id}:${p.columnTitle}`} value={p.id} disabled={taken}>
                      {p.label}
                      {taken ? ' — уже в таблице' : ''}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          style={primaryActionStyle}
          disabled={!canAdd}
          title={canAdd ? selectedPreset?.effectHint : ''}
          onClick={() => {
            if (!selectedPreset || supportCardHasColumnTitle(card, selectedPreset.columnTitle)) return;
            addSupportCardColumn(setBalance, card.id, selectedPreset.columnTitle);
            setSelectedPresetId('');
          }}
        >
          Добавить
        </button>
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>
        Порядок колонок влияет на приоритет, если несколько подходят под один шаблон. Стрелки — сдвиг влево/вправо.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
        {cols.map((col, index) => {
          const known = isSupportCardColumnRecognized(card, col);
          return (
            <span
              key={col}
              title={known ? undefined : 'Заголовок не из списка пресетов — симулятор учитывает только по шаблону текста; новый параметр добавляйте через разработку.'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 8px 6px 10px',
                borderRadius: 10,
                background: known ? 'rgba(51, 65, 85, 0.85)' : 'rgba(120, 53, 15, 0.35)',
                border: known ? '1px solid rgba(148, 163, 184, 0.25)' : '1px dashed rgba(251, 191, 36, 0.45)',
                fontSize: 12,
                color: '#e2e8f0',
              }}
            >
              <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col}</span>
              {!known && (
                <span style={{ fontSize: 10, color: '#fbbf24', flexShrink: 0 }}>нет в списке</span>
              )}
              <span style={{ display: 'inline-flex', gap: 2, marginLeft: 4 }}>
                <button
                  type="button"
                  title="Влево"
                  style={{ ...smallButtonStyle, padding: '2px 6px', minWidth: 28 }}
                  disabled={index === 0}
                  onClick={() => moveSupportCardColumn(setBalance, card.id, index, -1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  title="Вправо"
                  style={{ ...smallButtonStyle, padding: '2px 6px', minWidth: 28 }}
                  disabled={index >= cols.length - 1}
                  onClick={() => moveSupportCardColumn(setBalance, card.id, index, 1)}
                >
                  ›
                </button>
                <button
                  type="button"
                  title={cols.length <= 1 ? 'Нужна хотя бы одна колонка' : 'Удалить колонку'}
                  style={{
                    ...smallButtonStyle,
                    padding: '2px 8px',
                    lineHeight: 1.2,
                    opacity: cols.length <= 1 ? 0.35 : 1,
                    cursor: cols.length <= 1 ? 'not-allowed' : 'pointer',
                  }}
                  disabled={cols.length <= 1}
                  onClick={() => removeSupportCardColumn(setBalance, card.id, col)}
                >
                  ×
                </button>
              </span>
            </span>
          );
        })}
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#94a3b8', userSelect: 'none' }}>
          Как симулятор читает заголовки колонок
        </summary>
        <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5, marginTop: 8, whiteSpace: 'pre-wrap' }}>
          {SUPPORT_CARD_BATTLE_COLUMN_HINT}
        </div>
      </details>
    </div>
  );
}

function CardLevelsEditor({
  balance,
  card,
  precision,
  onTogglePrecision,
  setBalance,
}: {
  balance: BalanceConstants;
  card: SupportCardConfig;
  precision: PrecisionMap;
  onTogglePrecision: (key: string) => void;
  setBalance: SetBalance;
}) {
  const levels = getSupportCardLevelsForEditor(balance, card.id);
  const columns = getCardColumns(card);
  const columnKeys = columns.map((column) => `card.${card.id}.${column}`);

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Ур.</th>
          {columns.map((column, index) => (
            <PrecisionHeader
              key={column}
              label={column}
              keyName={columnKeys[index]}
              precision={precision}
              onToggle={onTogglePrecision}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {levels.map((row, index) => {
          const currentManual = getCurrentManualLevels(balance, card)[index] ?? row;
          return (
            <tr key={row.level}>
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{row.level}</td>
              {columns.map((column, columnIndex) => {
                const key = columnKeys[columnIndex];
                return (
                  <td key={column} style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                    <input
                      style={inputStyle}
                      type="number"
                      step="0.01"
                      value={formatCellInputValue(currentManual.values?.[column], precision[key])}
                      onChange={(e) =>
                        updateManualLevelField(
                          setBalance,
                          card.id,
                          index,
                          column,
                          e.target.value === '' ? null : Number(e.target.value) || 0
                        )
                      }
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CardUpgradeCostsEditor({
  balance,
  setBalance,
}: {
  balance: BalanceConstants;
  setBalance: SetBalance;
}) {
  const levels = Object.keys(balance.cardUpgradeCosts)
    .map(Number)
    .sort((a, b) => a - b)
    .map(String);

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Ур.</th>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Чертежи</th>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Uncommon (софт)</th>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Common (софт, оружие)</th>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Rare (софт)</th>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Epic (софт)</th>
          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Legendary (софт)</th>
        </tr>
      </thead>
      <tbody>
        {levels.map((level) => {
          const row = balance.cardUpgradeCosts[level];
          return (
            <tr key={level}>
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{level}</td>
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                <input
                  style={inputStyle}
                  type="number"
                  value={row.cards}
                  onChange={(e) => updateCardUpgradeCost(setBalance, level, 'cards', Number(e.target.value) || 0)}
                />
              </td>
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                <input
                  style={inputStyle}
                  type="number"
                  value={row.uncommon}
                  onChange={(e) => updateCardUpgradeCost(setBalance, level, 'uncommon', Number(e.target.value) || 0)}
                />
              </td>
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                <input
                  style={inputStyle}
                  type="number"
                  value={row.common}
                  onChange={(e) => updateCardUpgradeCost(setBalance, level, 'common', Number(e.target.value) || 0)}
                />
              </td>
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                <input
                  style={inputStyle}
                  type="number"
                  value={row.rare}
                  onChange={(e) => updateCardUpgradeCost(setBalance, level, 'rare', Number(e.target.value) || 0)}
                />
              </td>
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                <input
                  style={inputStyle}
                  type="number"
                  value={row.epic}
                  onChange={(e) => updateCardUpgradeCost(setBalance, level, 'epic', Number(e.target.value) || 0)}
                />
              </td>
              <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                <input
                  style={inputStyle}
                  type="number"
                  value={row.legendary}
                  onChange={(e) => updateCardUpgradeCost(setBalance, level, 'legendary', Number(e.target.value) || 0)}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const WeaponCardsPanel: React.FC<{
  balance: BalanceConstants;
  setBalance: SetBalance;
  referenceWavesConfig: ReferenceWavesConfig;
  /** Сбрасывает мемоизацию таблиц по волнам при правках конструктора уровней. */
  referenceWavesRevision: number;
}> = ({ balance, setBalance, referenceWavesConfig, referenceWavesRevision: wavesRev }) => {
  const [precision, setPrecision] = useState<PrecisionMap>({});
  const [displayPreset, setDisplayPreset] = useState<DisplayPreset>('full');
  const [collapsedCards, setCollapsedCards] = useState<Record<number, boolean>>({});
  const [copySourceId, setCopySourceId] = useState<number>(balance.supportCards[0]?.id ?? 0);
  const [copyTargetId, setCopyTargetId] = useState<number>(balance.supportCards[1]?.id ?? balance.supportCards[0]?.id ?? 0);

  const togglePrecision = (key: string) => {
    setPrecision((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleCard = (cardId: number) => {
    setCollapsedCards((prev) => ({ ...prev, [cardId]: !prev[cardId] }));
  };

  const weapons: WeaponId[] = ['machineGun', 'hydra70', 'hellfire'];
  const cardIds = balance.supportCards.map((card) => card.id);
  const allCollapsed = cardIds.length > 0 && cardIds.every((id) => collapsedCards[id]);

  return (
    <section style={sectionStyle}>
      <h3 style={{ marginTop: 0 }}>Оружие</h3>
      <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 0 }}>
        У каждого оружия свои базовые параметры и коэффициенты. Урон и боезапас растут линейно от базы; в шапке карточки —{' '}
        <strong>база софта</strong> и <strong>множитель роста стоимости</strong> апгрейда (референс Weapons).
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {(['full', 'compact', 'minimal'] as DisplayPreset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            style={{
              ...smallButtonStyle,
              background: displayPreset === preset ? 'rgba(14, 165, 233, 0.22)' : smallButtonStyle.background,
              borderColor: displayPreset === preset ? 'rgba(14, 165, 233, 0.65)' : smallButtonStyle.borderColor,
            }}
            onClick={() => setDisplayPreset(preset)}
          >
            {preset === 'full' ? 'Полный вид' : preset === 'compact' ? 'Сжатый вид' : 'Минимум'}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {weapons.map((weaponId) => (
          <WeaponCardSection
            key={weaponId}
            balance={balance}
            weaponId={weaponId}
            precision={precision}
            preset={displayPreset}
            onTogglePrecision={togglePrecision}
            setBalance={setBalance}
            referenceWavesConfig={referenceWavesConfig}
            referenceWavesRevision={wavesRev}
          />
        ))}
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0 }}>Карточки поддержки</h3>
        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 0, maxWidth: 720, lineHeight: 1.5 }}>
          В таблице уровней колонки добавляются только из списка пресетов — так симулятор и прогноз гарантированно знают смысл поля.
          Нужен новый параметр — попросите добавить пресет и разбор в коде. Сверху — метаданные карточки; внизу — стоимость прокачки.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            type="button"
            style={smallButtonStyle}
            onClick={() =>
              setCollapsedCards(
                Object.fromEntries(cardIds.map((id) => [id, true])) as Record<number, boolean>
              )
            }
          >
            Свернуть все
          </button>
          <button
            type="button"
            style={smallButtonStyle}
            onClick={() => setCollapsedCards({})}
          >
            Развернуть все
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ color: '#94a3b8', fontSize: 12, alignSelf: 'center' }}>Копировать карточку:</span>
          <select style={inputStyle} value={copySourceId} onChange={(e) => setCopySourceId(Number(e.target.value))}>
            {balance.supportCards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.id}. {card.name}
              </option>
            ))}
          </select>
          <span style={{ color: '#94a3b8', fontSize: 12, alignSelf: 'center' }}>в</span>
          <select style={inputStyle} value={copyTargetId} onChange={(e) => setCopyTargetId(Number(e.target.value))}>
            {balance.supportCards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.id}. {card.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            style={smallButtonStyle}
            onClick={() => copyCardConfig(setBalance, copySourceId, copyTargetId)}
            disabled={!copySourceId || !copyTargetId || copySourceId === copyTargetId}
          >
            Копировать
          </button>
        </div>

        <h4>Метаданные (имя, редкость, тип)</h4>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>ID</th>
              <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Название</th>
              <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Редкость</th>
              <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Тип</th>
              <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Столбцы листа</th>
            </tr>
          </thead>
          <tbody>
            {balance.supportCards.map((card) => (
              <tr key={card.id}>
                <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{card.id}</td>
                <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                  <input
                    style={inputStyle}
                    value={card.name}
                    onChange={(e) => updateCard(setBalance, card.id, { name: e.target.value })}
                  />
                </td>
                <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                  <select
                    style={inputStyle}
                    value={card.rarity}
                    onChange={(e) => updateCard(setBalance, card.id, { rarity: e.target.value as CardRarity })}
                  >
                    <option value="common">common</option>
                    <option value="uncommon">uncommon</option>
                    <option value="rare">rare</option>
                    <option value="epic">epic</option>
                    <option value="legendary">legendary</option>
                  </select>
                </td>
                <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                  <input
                    style={inputStyle}
                    value={card.type}
                    onChange={(e) => updateCard(setBalance, card.id, { type: e.target.value })}
                  />
                </td>
                <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>
                    {getSupportCardColumnOrder(card).join(', ') || '—'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ marginTop: 18 }}>Скалируемые параметры и прогрессия</h4>
        {balance.supportCards.map((card) => (
          <div key={card.id} style={{ marginBottom: 20, padding: 12, border: '1px solid rgba(148,163,184,0.2)', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ display: 'block' }}>
                {card.id}. {card.name}
              </strong>
              <button
                type="button"
                style={smallButtonStyle}
                onClick={() => toggleCard(card.id)}
              >
                {collapsedCards[card.id] ? 'Развернуть' : 'Свернуть'}
              </button>
            </div>
            {!collapsedCards[card.id] && (
              <>
                <div style={{ marginTop: 12 }}>
                  <h5 style={{ margin: '0 0 8px 0', color: '#e2e8f0' }}>Скалируемые параметры карточки</h5>
                  <CardColumnsManager card={card} setBalance={setBalance} />
                  <CardLevelsEditor
                    balance={balance}
                    card={card}
                    precision={precision}
                    onTogglePrecision={togglePrecision}
                    setBalance={setBalance}
                  />
                </div>
              </>
            )}
          </div>
        ))}

        <h4 style={{ marginTop: 18 }}>Стоимость улучшений</h4>
        <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 0 }}>
          <strong>Оружие:</strong> софт по формуле листа Weapons (см. колонку в таблице прокачки выше и блок в{' '}
          <strong>Экономика</strong>). <strong>Карточки:</strong> софт и чертежи — таблица{' '}
          <code>upgradeCostsByLevel</code> в Экономике.
        </p>
      </div>
    </section>
  );
};
