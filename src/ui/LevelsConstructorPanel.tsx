import React, { useMemo, useState } from 'react';
import type { BalanceConstants, EnemyId } from '../balance/model';
import { getEnemyLevelPowerBreakdownPerUnit } from '../balance/simulator';
import type { ReferenceWavesConfig, ReferenceWaveEnemies } from '../balance/referenceWaves';
import { getDefaultReferenceWavesConfig } from '../balance/referenceWaves';
import { simulateProgressionForecast } from '../progression/progressionSimulator';
import { fullWeaponAndSupportUpgradePolicy } from '../progression/fullUpgradePolicy';
import type { ProgressionForecastResult, SegmentId } from '../progression/types';
import { rocketWeaponLevelDisplay, showRocketLevelsInSummary } from '../progression/weaponLevelDisplay';
import type { ForecastUiState } from './ProgressionForecastPanel';

type SetReferenceWavesConfig = React.Dispatch<React.SetStateAction<ReferenceWavesConfig>>;

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

const thStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.24)',
  padding: 4,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.24)',
  padding: 4,
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

function cleanWaveEnemies(waveEnemies: ReferenceWaveEnemies): ReferenceWaveEnemies {
  const out: ReferenceWaveEnemies = {};
  for (const [enemyId, count] of Object.entries(waveEnemies) as Array<[EnemyId, number | undefined]>) {
    if (count != null && Number.isFinite(count) && count > 0) out[enemyId] = count;
  }
  return out;
}

function sumObjectValues(obj: Record<string, number> | null | undefined): number {
  if (!obj) return 0;
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

const ProgressionSimResultBlock: React.FC<{
  result: ProgressionForecastResult;
  balance: BalanceConstants;
}> = ({ result, balance }) => {
  const maxLevel = result.levels.reduce((m, r) => Math.max(m, r.levelIndex), 0);
  const showRockets = showRocketLevelsInSummary(maxLevel);
  const wl = result.finalState.weaponLevels;
  const freeChests = balance.economy.freeChests ?? [];
  const freeOpens = result.expectedFreeChestOpensById ?? {};
  const paidOpens = result.expectedPaidChestOpensById ?? {};
  const freeRows = Object.entries(freeOpens)
    .filter(([, n]) => n > 0.0005)
    .map(([id, count]) => ({
      id,
      name: freeChests.find((c) => c.id === id)?.name ?? id,
      count,
    }))
    .sort((a, b) => b.count - a.count);
  const paidRows = Object.entries(paidOpens)
    .filter(([, n]) => n > 0.0005)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
  return (
  <div style={{ display: 'grid', gap: 12 }}>
    <div style={{ fontSize: 13, color: '#e2e8f0' }}>
      <strong>Итог прокачки:</strong> оружие{' '}
      {wl.machineGunLevel} / {showRockets ? wl.hydraLevel : '—'} / {showRockets ? wl.hellfireLevel : '—'}
      {' · '}
      софт на балансе: {Math.round(result.finalState.softBalance)}
      {' · '}
      потрачено на оружие: {Math.round(result.finalState.lifetimeWeaponUpgradeSoftSpent ?? 0)}
    </div>
    {(freeRows.length > 0 || paidRows.length > 0) && (
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
        <strong style={{ color: '#e2e8f0' }}>Сундуки (прогноз):</strong>{' '}
        бесплатные — по календарным дням прогноза (порядок <code style={{ color: '#cbd5e1' }}>freeChests</code>, см.
        вкладку «Прогноз»).{' '}
        {freeRows.length > 0 && (
          <>
            бесплатные:{' '}
            {freeRows.map((r) => `${r.name} × ${Math.round(r.count * 100) / 100}`).join('; ')}
          </>
        )}
        {freeRows.length > 0 && paidRows.length > 0 && ' · '}
        {paidRows.length > 0 && (
          <>
            платные (id):{' '}
            {paidRows.map((r) => `${r.id} × ${Math.round(r.count * 100) / 100}`).join('; ')}
          </>
        )}
      </div>
    )}
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Игр. ур.</th>
            <th style={thStyle}>Попыток</th>
            <th style={thStyle}>Проход</th>
            <th style={thStyle} title="Сумма юнитов по волнам (как в конструкторе / в бою)">
              Юнитов ∑
            </th>
            <th style={thStyle} title="Суммарное HP (baseHp × кол-во) по всем волнам уровня">
              Σ HP
            </th>
            <th
              style={thStyle}
              title="Σ по волнам: 0,7×requiredDps + 0,3×угроза — как «Сложность уровня» в прогнозе"
            >
              Σ мощь
            </th>
            <th style={thStyle}>Награда ∑</th>
            <th style={thStyle}>Софт после</th>
            <th style={thStyle}>Траты на оружие (ур.)</th>
            <th style={thStyle}>Пулемёт / Гидра / HF</th>
          </tr>
        </thead>
        <tbody>
          {result.levels.map((row) => {
            const uBattle = sumObjectValues(row.unitsByEnemyId as unknown as Record<string, number>);
            const uShow =
              row.unitsRawSumFromEditor != null && row.unitsRawSumFromEditor > 0
                ? row.unitsRawSumFromEditor
                : uBattle;
            return (
              <tr key={row.levelIndex}>
                <td style={tdStyle}>{row.levelIndex}</td>
                <td style={tdStyle}>{row.attemptsTotal}</td>
                <td style={tdStyle}>
                  <span style={{ color: row.passed ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                    {row.passed ? 'ДА' : 'НЕТ'}
                  </span>
                </td>
                <td style={tdStyle}>{uShow > 0 ? uShow : '—'}</td>
                <td style={tdStyle}>
                  {row.totalEnemyHpScaled != null && row.totalEnemyHpScaled > 0
                    ? Math.round(row.totalEnemyHpScaled).toLocaleString('ru-RU')
                    : '—'}
                </td>
                <td style={tdStyle}>
                  {row.totalEnemyLevelPowerScaled != null && row.totalEnemyLevelPowerScaled > 0
                    ? Math.round(row.totalEnemyLevelPowerScaled).toLocaleString('ru-RU')
                    : '—'}
                </td>
                <td style={tdStyle}>{Math.round(row.totalRewardSoft)}</td>
                <td style={tdStyle}>{Math.round(row.endingSoftBalance)}</td>
                <td style={tdStyle}>{Math.round(row.weaponUpgradeSoftSpentOnLevel)}</td>
                <td style={tdStyle} title="На ур. 1 ракеты в бою не считаются — уровни Гидры/Hellfire в ячейке «—».">
                  {row.finalWeaponLevels.machineGunLevel} /{' '}
                  {rocketWeaponLevelDisplay(row.levelIndex, row.finalWeaponLevels.hydraLevel)} /{' '}
                  {rocketWeaponLevelDisplay(row.levelIndex, row.finalWeaponLevels.hellfireLevel)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', lineHeight: 1.5, maxWidth: 920 }}>
      Σ HP — сумма baseHp×N по волнам; Σ мощь — Σ (0,7×HP/T волны + 0,3×DPS угрозы×N) по волнам, без масштаба по номеру уровня. С игрового уровня 2 в расчёте
      боя подключаются Гидра и Hellfire; на строке ур. 1 их уровни в таблице не показываются (—), хотя во внутреннем состоянии
      симуляции базовые уровни уже заданы.
    </p>
    <div>
      <strong style={{ color: '#e2e8f0', fontSize: 13 }}>Карты поддержки (финал)</strong>
      <div style={{ overflowX: 'auto', marginTop: 6 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Карта</th>
              <th style={thStyle}>Уровень</th>
              <th style={thStyle}>Чертежи (остаток EV)</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const supportRows = balance.supportCards
                .map((c) => ({
                  id: c.id,
                  name: c.name,
                  level: result.finalState.supportCardLevels[c.id] ?? 0,
                  bp: result.finalState.supportCardBlueprints[c.id] ?? 0,
                }))
                .filter((r) => r.level > 0 || r.bp > 0)
                .sort((a, b) => b.level - a.level || b.bp - a.bp);
              if (supportRows.length === 0) {
                return (
                  <tr>
                    <td style={tdStyle} colSpan={3}>
                      Нет прокачки и ожидаемых чертежей (все 0).
                    </td>
                  </tr>
                );
              }
              return supportRows.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.name}</td>
                  <td style={tdStyle}>{r.level}</td>
                  <td style={tdStyle}>{Math.round(r.bp * 100) / 100}</td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  );
};

function setWaveEnemyCount(
  setReferenceWavesConfig: SetReferenceWavesConfig,
  levelIndex: number,
  waveIndex: number,
  enemyId: EnemyId,
  count: number
) {
  setReferenceWavesConfig((prev) => {
    const prevLevel = prev[levelIndex] ?? {};
    const prevWave = prevLevel[waveIndex] ?? {};
    const nextWave: ReferenceWaveEnemies = cleanWaveEnemies({
      ...prevWave,
      [enemyId]: count,
    });

    return {
      ...prev,
      [levelIndex]: {
        ...prevLevel,
        [waveIndex]: nextWave,
      },
    };
  });
}

export const LevelsConstructorPanel: React.FC<{
  balance: BalanceConstants;
  setBalance: React.Dispatch<React.SetStateAction<BalanceConstants>>;
  referenceWavesConfig: ReferenceWavesConfig;
  setReferenceWavesConfig: SetReferenceWavesConfig;
  /** Те же параметры, что на вкладке «Прогноз» — иначе число попыток не совпадёт. */
  segmentId: SegmentId;
  onSegmentIdChange: (segment: SegmentId) => void;
  playerLevel: number;
  onPlayerLevelChange: (level: number) => void;
  forecastUiState: ForecastUiState;
  onForecastUiStateChange: (state: ForecastUiState) => void;
}> = ({
  balance,
  setBalance,
  referenceWavesConfig,
  setReferenceWavesConfig,
  segmentId,
  onSegmentIdChange,
  playerLevel,
  onPlayerLevelChange,
  forecastUiState,
  onForecastUiStateChange,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const [simResult, setSimResult] = useState<ProgressionForecastResult | null>(null);
  const [simMessage, setSimMessage] = useState<string>('');
  /** Для какого блока «Уровень N» показываем результат (кнопка «Симулировать 1–N»). */
  const [simUpToLevel, setSimUpToLevel] = useState<number | null>(null);

  const patchForecastUi = (patch: Partial<ForecastUiState>) => {
    onForecastUiStateChange({ ...forecastUiState, ...patch });
  };

  const runProgressionSimulation = (maxLevelIndex: number) => {
    setSimMessage('');
    setSimUpToLevel(maxLevelIndex);
    try {
      const capped = Math.min(Math.max(1, maxLevelIndex), balance.meta.gameLevels);
      const maxAttemptsPerLevel = Math.max(1, forecastUiState.maxAttemptsPerLevel ?? 200);
      const energyPerLevel = Math.max(0, forecastUiState.energyPerLevel ?? 100);
      const energyPerAttempt = Math.max(1, forecastUiState.energyPerAttempt ?? 1);
      const energyStart = Math.max(0, forecastUiState.energyStart ?? energyPerLevel);
      const energyRegenPerHour = Math.max(0, forecastUiState.energyRegenPerHour ?? 0);
      const result = simulateProgressionForecast(balance, {
        segmentId,
        playerLevel: Math.max(1, playerLevel),
        initialSoft: 0,
        maxAttemptsPerLevel,
        energyPerLevel,
        energyPerAttempt,
        energyStart,
        energyRegenPerHour,
        upgradePolicy: fullWeaponAndSupportUpgradePolicy,
        referenceWavesConfig,
        maxLevelIndex: capped,
      });
      setSimResult(result);
      const totalAttempts = result.levels.reduce((s, r) => s + r.attemptsTotal, 0);
      const passed = result.levels.filter((r) => r.passed).length;
      setSimMessage(
        `Готово (уровни 1–${capped}): пройдено ${passed} / ${result.levels.length}, всего попыток (сумма): ${totalAttempts}`
      );
    } catch (e) {
      setSimResult(null);
      setSimMessage(`Ошибка симуляции: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const forbiddenEnemyIds = new Set<EnemyId>(['heli', 'plane', 'heavyInfantry']);
  const enemyIds = useMemo(
    () => (Object.keys(balance.enemies) as EnemyId[]).filter((id) => !forbiddenEnemyIds.has(id)),
    [balance.enemies]
  );
  const gameLevels = balance.meta.gameLevels;
  const wavesPerLevel = balance.economy.wavesPerLevel ?? 2;

  const defaultCfg = useMemo(() => getDefaultReferenceWavesConfig(), []);

  const setEnemyField = (
    enemyId: EnemyId,
    key: 'baseHp' | 'baseDamage' | 'baseFireRatePerMin' | 'reward',
    value: number
  ) => {
    setBalance((prev) => ({
      ...prev,
      enemies: {
        ...prev.enemies,
        [enemyId]: {
          ...prev.enemies[enemyId],
          [key]: value,
        },
      },
    }));
  };

  return (
    <section style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Конструктор уровней</h3>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 13, lineHeight: 1.45 }}>
            Редактирование <strong style={{ color: '#e2e8f0' }}>базового</strong> состава врагов по уровню и волне. В бою и в
            «Прогнозе» используются те же числа; параметры типов врагов (HP, урон и т.д.) не меняются от уровня или номера
            волны — сложность задаётся составом и таблицей врагов.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            type="button"
            style={{
              border: '1px solid rgba(148, 163, 184, 0.35)',
              borderRadius: 999,
              background: 'rgba(30, 41, 59, 0.9)',
              color: '#e2e8f0',
              padding: '6px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? 'Развернуть' : 'Свернуть'}
          </button>
          <button
            type="button"
            style={{
              border: '1px solid rgba(148, 163, 184, 0.35)',
              borderRadius: 999,
              background: 'rgba(30, 41, 59, 0.9)',
              color: '#e2e8f0',
              padding: '6px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
            onClick={() => setReferenceWavesConfig(defaultCfg)}
            title="Сбросить состав врагов к значениям по умолчанию"
          >
            Сброс
          </button>
        </div>
      </div>

      <div style={{ ...cardStyle, marginTop: 14 }}>
        <h4 style={{ marginTop: 0, marginBottom: 8 }}>Отладка: симуляция прогрессии</h4>
        <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
          Параметры <strong style={{ color: '#e2e8f0' }}>те же, что на «Прогноз»</strong> (поля ниже синхронизированы).
          «Симулировать 1–K» даёт те же попытки на уровне K, что строка K в таблице прогноза при полном прогоне всех
          уровней.
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'flex-end',
            marginBottom: 12,
          }}
        >
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            Сегмент
            <select
              style={inputStyle}
              value={segmentId}
              onChange={(e) => onSegmentIdChange(e.target.value as SegmentId)}
            >
              <option value="free">Бесплатник</option>
              <option value="payer">Платящий</option>
              <option value="whale">Кит</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            Ур. игрока
            <input
              style={inputStyle}
              type="number"
              min={1}
              value={playerLevel}
              onChange={(e) => onPlayerLevelChange(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            Лимит попыток / ур.
            <input
              style={inputStyle}
              type="number"
              min={1}
              value={forecastUiState.maxAttemptsPerLevel}
              onChange={(e) =>
                patchForecastUi({ maxAttemptsPerLevel: Math.max(1, Number(e.target.value) || 200) })
              }
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            Энергия макс.
            <input
              style={inputStyle}
              type="number"
              min={0}
              value={forecastUiState.energyPerLevel}
              onChange={(e) =>
                patchForecastUi({ energyPerLevel: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            Старт энергии
            <input
              style={inputStyle}
              type="number"
              min={0}
              value={forecastUiState.energyStart}
              onChange={(e) =>
                patchForecastUi({ energyStart: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            Цена попытки (энерг.)
            <input
              style={inputStyle}
              type="number"
              min={1}
              value={forecastUiState.energyPerAttempt}
              onChange={(e) =>
                patchForecastUi({ energyPerAttempt: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 11, color: '#94a3b8' }}>
            Реген энергии / ч
            <input
              style={inputStyle}
              type="number"
              min={0}
              value={forecastUiState.energyRegenPerHour}
              onChange={(e) =>
                patchForecastUi({ energyRegenPerHour: Math.max(0, Number(e.target.value) || 0) })
              }
            />
          </label>
        </div>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
          <div style={cardStyle}>
            <h4 style={{ marginTop: 0, marginBottom: 10 }}>Конструктор вражеских юнитов</h4>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Враг</th>
                  <th style={thStyle}>Здоровье</th>
                  <th style={thStyle}>Урон</th>
                  <th style={thStyle}>Скорострельность (в мин)</th>
                  <th
                    style={thStyle}
                    title="Как «Сложность уровня» в прогнозе: 0,7 × (HP / T волны) + 0,3 × DPS угрозы. Подсказка в ячейке — разложение."
                  >
                    Мощь
                  </th>
                  <th style={thStyle}>Награда за юнита</th>
                </tr>
              </thead>
              <tbody>
                {enemyIds.map((enemyId) => {
                  const enemy = balance.enemies[enemyId];
                  const { survivabilityPressure, threat, power } = getEnemyLevelPowerBreakdownPerUnit(
                    balance,
                    enemy
                  );
                  return (
                    <tr key={enemyId}>
                      <td style={tdStyle}>{enemy.displayName}</td>
                      <td style={tdStyle}>
                        <input
                          style={inputStyle}
                          type="number"
                          min={1}
                          value={enemy.baseHp}
                          onChange={(e) => setEnemyField(enemyId, 'baseHp', Number(e.target.value) || 1)}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          style={inputStyle}
                          type="number"
                          min={0}
                          value={enemy.baseDamage}
                          onChange={(e) => setEnemyField(enemyId, 'baseDamage', Number(e.target.value) || 0)}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          style={inputStyle}
                          type="number"
                          min={1}
                          value={enemy.baseFireRatePerMin ?? 60}
                          onChange={(e) => setEnemyField(enemyId, 'baseFireRatePerMin', Number(e.target.value) || 60)}
                        />
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                          color: '#a7f3d0',
                        }}
                        title={`Выжив.: ${survivabilityPressure.toFixed(2)} (HP/T волны), угроза: ${threat.toFixed(2)}`}
                      >
                        {power.toFixed(2)}
                      </td>
                      <td style={tdStyle}>
                        <input
                          style={inputStyle}
                          type="number"
                          min={0}
                          value={enemy.reward}
                          onChange={(e) => setEnemyField(enemyId, 'reward', Math.max(0, Number(e.target.value) || 0))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {Array.from({ length: gameLevels }, (_, i) => i + 1).map((levelIndex) => (
              <div key={levelIndex} style={cardStyle}>
                <h4 style={{ marginTop: 0, marginBottom: 10 }}>Уровень {levelIndex}</h4>
                <div style={{ display: 'grid', gridTemplateColumns: wavesPerLevel >= 2 ? '1fr 1fr' : '1fr', gap: 12 }}>
                  {Array.from({ length: wavesPerLevel }, (_, i) => i + 1).map((waveIndex) => (
                    <div key={waveIndex}>
                      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>
                        Волна {waveIndex}
                      </div>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Враг</th>
                            <th style={thStyle}>Количество</th>
                          </tr>
                        </thead>
                        <tbody>
                          {enemyIds.map((enemyId) => {
                            const count = referenceWavesConfig[levelIndex]?.[waveIndex]?.[enemyId] ?? 0;
                            return (
                              <tr key={enemyId}>
                                <td style={tdStyle}>{balance.enemies[enemyId].displayName}</td>
                                <td style={tdStyle}>
                                  <input
                                    style={inputStyle}
                                    type="number"
                                    value={count}
                                    min={0}
                                    onChange={(e) => setWaveEnemyCount(
                                      setReferenceWavesConfig,
                                      levelIndex,
                                      waveIndex,
                                      enemyId,
                                      Number(e.target.value) || 0
                                    )}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 12,
                    borderTop: '1px solid rgba(148, 163, 184, 0.2)',
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <button
                    type="button"
                    style={{
                      justifySelf: 'start',
                      border: '1px solid rgba(56, 189, 248, 0.55)',
                      borderRadius: 999,
                      background: 'rgba(14, 116, 144, 0.35)',
                      color: '#ecfeff',
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onClick={() => runProgressionSimulation(levelIndex)}
                  >
                    Симулировать уровни 1–{levelIndex}
                  </button>
                  {simUpToLevel === levelIndex && simMessage && (
                    <div
                      style={{
                        fontSize: 13,
                        color: simResult ? '#86efac' : '#fca5a5',
                        fontWeight: 600,
                      }}
                    >
                      {simMessage}
                    </div>
                  )}
                  {simUpToLevel === levelIndex && simResult && (
                    <ProgressionSimResultBlock result={simResult} balance={balance} />
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </section>
  );
};

