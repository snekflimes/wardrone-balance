import React, { useMemo, useState } from 'react';
import type { BalanceConstants } from '../balance/model';
import {
  getAverageRewardPerLevel,
  getAverageRewardPerSession,
  getAverageAttemptRewardSoft,
  getDailyFreeSoftEstimate,
  getEconomyUsdRates,
  getMissionRewardSoft,
  getRewardEconomyComparison,
} from '../balance/economy';
import type { ReferenceWavesConfig } from '../balance/referenceWaves';
import { simulateProgressionForecast } from '../progression/progressionSimulator';
import { fullWeaponAndSupportUpgradePolicy } from '../progression/fullUpgradePolicy';
import type { SegmentId } from '../progression/types';

type SetBalance = React.Dispatch<React.SetStateAction<BalanceConstants>>;

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
  minWidth: 110,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(15, 23, 42, 0.9)',
  color: '#e2e8f0',
  boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(15, 23, 42, 0.9)',
  color: '#e2e8f0',
  cursor: 'pointer',
};

function setEconomyField(
  setBalance: SetBalance,
  key: keyof BalanceConstants['economy'],
  value: number
) {
  setBalance((prev) => ({
    ...prev,
    economy: {
      ...prev.economy,
      [key]: value,
    } as BalanceConstants['economy'],
  }));
}

function setNestedAnchor(
  setBalance: SetBalance,
  key: 'vipWeeklyUsd' | 'vipPriceHard',
  value: number
) {
  setBalance((prev) => {
    if (key === 'vipWeeklyUsd') {
      return {
        ...prev,
        economy: {
          ...prev.economy,
          referenceUsd: {
            ...(prev.economy.referenceUsd ?? { vipWeeklyUsd: 7.99 }),
            vipWeeklyUsd: value,
          },
        },
      };
    }
    return {
      ...prev,
      economy: {
        ...prev.economy,
        usdAnchor: {
          ...(prev.economy.usdAnchor ?? { vipPriceHard: 500 }),
          vipPriceHard: value,
        },
      },
    };
  });
}

function setUpgradeCostField(
  setBalance: SetBalance,
  level: string,
  key: 'soft' | 'blueprints',
  value: number
) {
  setBalance((prev) => ({
    ...prev,
    economy: {
      ...prev.economy,
      upgradeCostsByLevel: {
        ...(prev.economy.upgradeCostsByLevel ?? {}),
        [level]: {
          ...(prev.economy.upgradeCostsByLevel?.[level] ?? { soft: 0, blueprints: 0 }),
          [key]: Math.max(0, value),
        },
      },
    },
  }));
}

export const EconomyPanel: React.FC<{
  balance: BalanceConstants;
  setBalance: SetBalance;
  referenceWavesConfig?: ReferenceWavesConfig;
  forecastSegmentId?: SegmentId;
  onResetToDefaults?: () => void;
}> = ({ balance, setBalance, referenceWavesConfig, forecastSegmentId = 'free', onResetToDefaults }) => {
  const [collapsed, setCollapsed] = useState(false);
  const rates = getEconomyUsdRates(balance);
  const missionRewardLvl1 = getMissionRewardSoft(balance, 1);
  const avgPerLevel = getAverageRewardPerLevel(balance);
  const avgPerSession = getAverageRewardPerSession(balance);
  const progressionForecastInitialSoft = 0;

  const progressionForecastMetrics = useMemo(() => {
    const forecast = simulateProgressionForecast(balance, {
      segmentId: forecastSegmentId,
      playerLevel: 1,
      initialSoft: progressionForecastInitialSoft,
      maxAttemptsPerLevel: 200,
      energyPerLevel: 100,
      energyPerAttempt: 1,
      energyStart: 100,
      energyRegenPerHour: 10,
      upgradePolicy: fullWeaponAndSupportUpgradePolicy,
      referenceWavesConfig,
    });
    const totals = forecast.levels.reduce(
      (acc, lvl) => {
        acc.reward += lvl.totalRewardSoft;
        acc.attempts += lvl.attemptsTotal;
        return acc;
      },
      { reward: 0, attempts: 0 }
    );
    const weaponUpgradeSoftSpent = forecast.finalState.lifetimeWeaponUpgradeSoftSpent ?? 0;
    const finalSoft = forecast.finalState.softBalance;
    const attempts = totals.attempts;
    return {
      avgRewardPerAttempt: attempts > 0 ? totals.reward / attempts : 0,
      totalAttempts: attempts,
      totalRewardSoft: totals.reward,
      weaponUpgradeSoftSpent,
      avgWeaponUpgradeSoftPerAttempt: attempts > 0 ? weaponUpgradeSoftSpent / attempts : 0,
      netSoftDeltaPerAttempt:
        attempts > 0 ? (finalSoft - progressionForecastInitialSoft) / attempts : 0,
      finalSoft,
    };
  }, [balance, referenceWavesConfig, forecastSegmentId]);

  const forecastBasedAvgAttempt = progressionForecastMetrics.avgRewardPerAttempt;

  const avgPerAttempt = forecastBasedAvgAttempt > 0
    ? forecastBasedAvgAttempt
    : getAverageAttemptRewardSoft(balance);
  const hasManualOurAvgOverride =
    (balance.economy.ourAvgRewardPerAttemptSoftOverride ?? 0) > 0;
  const dailySoft = getDailyFreeSoftEstimate(balance);
  const rewardComparison = useMemo(
    () => getRewardEconomyComparison(balance, { ourAvgRewardPerAttemptSoft: avgPerAttempt }),
    [balance, avgPerAttempt]
  );
  const parity = rewardComparison?.parityCoefficient ?? null;
  const parityLabel = parity == null
    ? 'Н/Д'
    : parity >= 0.95 && parity <= 1.05
      ? 'В коридоре'
      : parity < 0.95
        ? 'Меньше софта за попытку → монета ценнее → IAP $ должен давать меньше монет'
        : 'Больше софта за попытку → монета дешевле → можно больше монет в IAP $';
  const parityColor = parity == null
    ? '#94a3b8'
    : parity >= 0.95 && parity <= 1.05
      ? '#22c55e'
      : parity < 0.95
        ? '#f59e0b'
        : '#94a3b8';
  const autoAdjustShopByParity = () => {
    if (!rewardComparison || rewardComparison.parityCoefficient <= 0) return;
    const k = rewardComparison.parityCoefficient;
    // k = (ourAvg/refAvg)×(refSoft$/ourSoft$). При меньшем софте за попытку k<1 → уменьшаем только iap_soft за $.
    setBalance((prev) => ({
      ...prev,
      economy: {
        ...prev.economy,
        shopItems: prev.economy.shopItems.map((item) => {
          if (item.type !== 'iap_soft') return item;
          return {
            ...item,
            quantity: Math.max(1, Math.round(item.quantity * k)),
          };
        }),
      },
    }));
  };

  const kpis = useMemo(() => {
    if (!rates) return null;
    return [
      ['1 золото', `$${rates.usdPerHard.toFixed(4)} USD`],
      ['1 монета', `$${rates.usdPerSoft.toFixed(6)} USD`],
      ['Награда за миссию (ур.1)', `${missionRewardLvl1.toFixed(0)} ≈ $${(missionRewardLvl1 * rates.usdPerSoft).toFixed(4)} USD`],
      ['Средняя награда за уровень', `${avgPerLevel.toFixed(0)} ≈ $${(avgPerLevel * rates.usdPerSoft).toFixed(4)} USD`],
      ['Средняя награда за попытку', `${avgPerAttempt.toFixed(0)} ≈ $${(avgPerAttempt * rates.usdPerSoft).toFixed(4)} USD`],
      ['Средняя награда за сессию', `${avgPerSession.toFixed(0)} ≈ $${(avgPerSession * rates.usdPerSoft).toFixed(4)} USD`],
      ['Доход в день (фриплей)', `~${dailySoft.toFixed(0)} ≈ $${(dailySoft * rates.usdPerSoft).toFixed(2)} USD`],
      [
        'Прогноз: траты на оружие / попытку',
        `${progressionForecastMetrics.avgWeaponUpgradeSoftPerAttempt.toFixed(1)} soft ≈ $${(progressionForecastMetrics.avgWeaponUpgradeSoftPerAttempt * rates.usdPerSoft).toFixed(4)} USD (сегмент: ${forecastSegmentId})`,
      ],
      [
        'Прогноз: чистый прирост софта / попытку',
        `${progressionForecastMetrics.netSoftDeltaPerAttempt.toFixed(1)} soft ≈ $${(progressionForecastMetrics.netSoftDeltaPerAttempt * rates.usdPerSoft).toFixed(4)} USD`,
      ],
    ];
  }, [
    rates,
    missionRewardLvl1,
    avgPerLevel,
    avgPerAttempt,
    avgPerSession,
    dailySoft,
    progressionForecastMetrics.avgWeaponUpgradeSoftPerAttempt,
    progressionForecastMetrics.netSoftDeltaPerAttempt,
    forecastSegmentId,
  ]);

  return (
    <section style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ marginTop: 0 }}>Экономика</h3>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>
            USD-якоря, базовые награды, курсы и параметры прогрессии.
          </p>
        </div>
        <button
          type="button"
          style={{
            border: '1px solid rgba(148, 163, 184, 0.35)',
            borderRadius: 999,
            background: 'rgba(30, 41, 59, 0.9)',
            color: '#e2e8f0',
            padding: '6px 10px',
            fontSize: 12,
          }}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? 'Развернуть' : 'Свернуть'}
        </button>
      </div>

      {!collapsed && (
        <>
          <div style={cardStyle}>
            <h4 style={{ marginTop: 0 }}>Ключевые метрики</h4>
            {rates ? (
              <table style={tableStyle}>
                <tbody>
                  {kpis?.map(([label, value]) => (
                    <tr key={label}>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{label}</td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ margin: 0 }}>Заполните USD-якоря, чтобы увидеть конвертацию.</p>
            )}
          </div>

          <div style={{ ...cardStyle, border: '1px solid rgba(34, 197, 94, 0.35)' }}>
            <h4 style={{ marginTop: 0 }}>Награда за попытку: референс vs наш</h4>
            <div style={{ marginBottom: 10, color: parityColor, fontWeight: 700 }}>
              Статус паритета: {parityLabel}{parity != null ? ` (${parity.toFixed(3)}x)` : ''}
            </div>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 10 }}>
              <label>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Референс: средняя награда за попытку (soft)</div>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  value={balance.economy.referenceAvgRewardPerAttemptSoft ?? ''}
                  onChange={(e) => setEconomyField(setBalance, 'referenceAvgRewardPerAttemptSoft', Number(e.target.value) || 0)}
                />
              </label>
              <label>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Наша средняя награда за попытку (override, soft)</div>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  value={
                    hasManualOurAvgOverride
                      ? (balance.economy.ourAvgRewardPerAttemptSoftOverride ?? '')
                      : Math.round(forecastBasedAvgAttempt)
                  }
                  onChange={(e) => setEconomyField(setBalance, 'ourAvgRewardPerAttemptSoftOverride', Number(e.target.value) || 0)}
                />
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>
                  Авто из прогноза: {forecastBasedAvgAttempt.toFixed(1)} soft (валовая награда)
                  {hasManualOurAvgOverride ? ' (сейчас переопределено вручную)' : ' (используется автоматически)'}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4, lineHeight: 1.35 }}>
                  Прогноз учитывает новую экономику оружия:{' '}
                  <strong style={{ color: '#e2e8f0' }}>
                    {Math.round(progressionForecastMetrics.weaponUpgradeSoftSpent)} soft
                  </strong>{' '}
                  на апгрейды стволов за весь прогон (
                  {progressionForecastMetrics.totalAttempts > 0
                    ? `${progressionForecastMetrics.avgWeaponUpgradeSoftPerAttempt.toFixed(1)} soft/попытку`
                    : '0 попыток'}
                  ), чистый баланс:{' '}
                  <strong style={{ color: '#e2e8f0' }}>
                    {progressionForecastMetrics.netSoftDeltaPerAttempt.toFixed(1)} soft/попытку
                  </strong>{' '}
                  (финал {Math.round(progressionForecastMetrics.finalSoft)} при старте{' '}
                  {progressionForecastInitialSoft}).
                </div>
                <div style={{ marginTop: 6 }}>
                  <button
                    type="button"
                    style={{
                      border: '1px solid rgba(148, 163, 184, 0.35)',
                      borderRadius: 999,
                      background: 'rgba(30, 41, 59, 0.9)',
                      color: '#e2e8f0',
                      padding: '4px 8px',
                      fontSize: 11,
                    }}
                    onClick={() => setEconomyField(setBalance, 'ourAvgRewardPerAttemptSoftOverride', Math.round(forecastBasedAvgAttempt))}
                  >
                    Подставить из прогноза
                  </button>
                  <button
                    type="button"
                    style={{
                      marginLeft: 6,
                      border: '1px solid rgba(148, 163, 184, 0.35)',
                      borderRadius: 999,
                      background: 'rgba(15, 23, 42, 0.95)',
                      color: '#e2e8f0',
                      padding: '4px 8px',
                      fontSize: 11,
                    }}
                    onClick={() => setEconomyField(setBalance, 'ourAvgRewardPerAttemptSoftOverride', 0)}
                  >
                    Сбросить override
                  </button>
                </div>
              </label>
            </div>
            {rewardComparison ? (
              <>
                <table style={tableStyle}>
                  <tbody>
                  <tr>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      Софт за $1 (реф. якорь / наши IAP)
                    </td>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      {rewardComparison.refSoftPerUsd.toFixed(0)} / {rewardComparison.ourSoftPerUsd.toFixed(0)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Средняя награда за попытку (реф / наш)</td>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      {rewardComparison.refAvgRewardPerAttemptSoft.toFixed(1)} / {rewardComparison.ourAvgRewardPerAttemptSoft.toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Попыток за $1 (реф / наш)</td>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      {rewardComparison.refAttemptsPerUsd.toFixed(2)} / {rewardComparison.ourAttemptsPerUsd.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>USD-стоимость 1 попытки (реф / наш)</td>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      ${rewardComparison.refUsdPerAttempt.toFixed(4)} / ${rewardComparison.ourUsdPerAttempt.toFixed(4)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      k для IAP (наш $/попытку ÷ реф. $/попытку)
                    </td>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      {rewardComparison.parityCoefficient.toFixed(3)} (новый размер пакета ≈ старый × k)
                    </td>
                  </tr>
                  </tbody>
                </table>
                <p style={{ margin: '8px 0 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                  Реф.: <code style={{ color: '#cbd5e1' }}>referencePacks.softPerUsd</code> (база без акции). Наш: среднее{' '}
                  <code style={{ color: '#cbd5e1' }}>quantity / priceUsd</code> по <code style={{ color: '#cbd5e1' }}>iap_soft</code>, тиры
                  как в <code style={{ color: '#cbd5e1' }}>cashTiers</code>. Логика: если за попытку выдаём меньше софта, одна
                  монета «весит» больше прогресса → за тот же доллар в IAP должно быть меньше монет (k {'<'} 1).
                </p>
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    style={{
                      border: '1px solid rgba(34, 197, 94, 0.55)',
                      borderRadius: 999,
                      background: 'rgba(22, 101, 52, 0.85)',
                      color: '#ecfeff',
                      padding: '6px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                    onClick={autoAdjustShopByParity}
                  >
                    Подстроить IAP монет ($) по k
                  </button>
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>
                    Только <code style={{ color: '#cbd5e1' }}>iap_soft</code>: quantity × k. Обмен золото→монеты не трогаем.
                  </span>
                </div>
              </>
            ) : (
              <p style={{ margin: 0, color: '#94a3b8', fontSize: 12 }}>
                Заполни `Референс: средняя награда за попытку (soft)` и проверь, что в `Сундуки и магазин` заполнен `referencePacks`,
                тогда здесь появится полная таблица сравнения с референсом.
              </p>
            )}
          </div>

          <div style={cardStyle}>
            <h4 style={{ marginTop: 0 }}>Якоря USD</h4>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>VIP референс (USD/нед)</div>
                <input
                  style={inputStyle}
                  type="number"
                  step="0.01"
                  value={balance.economy.referenceUsd?.vipWeeklyUsd ?? 7.99}
                  onChange={(e) => setNestedAnchor(setBalance, 'vipWeeklyUsd', Number(e.target.value) || 0)}
                />
              </label>
              <label>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Наш VIP (золото)</div>
                <input
                  style={inputStyle}
                  type="number"
                  value={balance.economy.usdAnchor?.vipPriceHard ?? 500}
                  onChange={(e) => setNestedAnchor(setBalance, 'vipPriceHard', Number(e.target.value) || 0)}
                />
              </label>
            </div>
          </div>

          <div style={cardStyle}>
            <h4 style={{ marginTop: 0 }}>Формулы и базовые значения</h4>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {[
                ['baseMissionReward', 'База награды за миссию'],
                ['baseLevelRewardMultiplier', 'Множитель награды за уровень'],
                ['missionDifficultyMultiplier', 'Множ. награды между волнами'],
                ['lossPenaltyPercent', 'Штраф за поражение %'],
                ['questBaseReward', 'Награда за квест'],
                ['cardSlotCost', 'Цена слота карты'],
                ['wavesPerLevel', 'Волн на уровень'],
                ['missionsPerSession', 'Миссий в сессии'],
              ].map(([key, label]) => (
                <label key={key as string}>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{label}</div>
                  <input
                    style={inputStyle}
                    type="number"
                    step={key === 'baseLevelRewardMultiplier' || key === 'missionDifficultyMultiplier' ? '0.01' : '1'}
                    value={(balance.economy as unknown as Record<string, number>)[key as string] ?? 0}
                    onChange={(e) => setEconomyField(setBalance, key as keyof BalanceConstants['economy'], Number(e.target.value) || 0)}
                  />
                </label>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <h4 style={{ marginTop: 0 }}>Ракетницы и награды за вход (влияет на «Прогноз»)</h4>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <label>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Покупка Hydra (софт)</div>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  value={balance.economy.rocketUnlock?.hydra70Soft ?? 5000}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    setBalance((prev) => ({
                      ...prev,
                      economy: {
                        ...prev.economy,
                        rocketUnlock: { hydra70Soft: v, hellfireSoft: prev.economy.rocketUnlock?.hellfireSoft ?? 20000 },
                      },
                    }));
                  }}
                />
              </label>
              <label>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Покупка Hellfire (софт)</div>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  value={balance.economy.rocketUnlock?.hellfireSoft ?? 20000}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    setBalance((prev) => ({
                      ...prev,
                      economy: {
                        ...prev.economy,
                        rocketUnlock: { hydra70Soft: prev.economy.rocketUnlock?.hydra70Soft ?? 5000, hellfireSoft: v },
                      },
                    }));
                  }}
                />
              </label>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ color: '#94a3b8', fontSize: 12 }}>Календарь наград за вход (день → софт/хард)</div>
                <button
                  style={buttonStyle}
                  onClick={() => {
                    setBalance((prev) => {
                      const list = [...(prev.economy.loginRewards ?? [])];
                      const nextDay = (list.map((r) => r.day).reduce((m, x) => Math.max(m, x), 0) || 0) + 1;
                      list.push({ day: nextDay, soft: 0, hard: 0 });
                      return { ...prev, economy: { ...prev.economy, loginRewards: list } };
                    });
                  }}
                >
                  + День
                </button>
              </div>
              <table style={{ ...tableStyle, marginTop: 8 }}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>День</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Софт</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Хард</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }} />
                  </tr>
                </thead>
                <tbody>
                  {(balance.economy.loginRewards ?? []).slice().sort((a, b) => a.day - b.day).map((r) => (
                    <tr key={r.day}>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{r.day}</td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input
                          style={{ ...inputStyle, width: 120 }}
                          type="number"
                          min={0}
                          value={r.soft ?? 0}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setBalance((prev) => ({
                              ...prev,
                              economy: {
                                ...prev.economy,
                                loginRewards: (prev.economy.loginRewards ?? []).map((x) =>
                                  x.day === r.day ? { ...x, soft: v } : x
                                ),
                              },
                            }));
                          }}
                        />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input
                          style={{ ...inputStyle, width: 120 }}
                          type="number"
                          min={0}
                          value={r.hard ?? 0}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setBalance((prev) => ({
                              ...prev,
                              economy: {
                                ...prev.economy,
                                loginRewards: (prev.economy.loginRewards ?? []).map((x) =>
                                  x.day === r.day ? { ...x, hard: v } : x
                                ),
                              },
                            }));
                          }}
                        />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4, textAlign: 'center' }}>
                        <button
                          style={buttonStyle}
                          onClick={() => {
                            setBalance((prev) => ({
                              ...prev,
                              economy: {
                                ...prev.economy,
                                loginRewards: (prev.economy.loginRewards ?? []).filter((x) => x.day !== r.day),
                              },
                            }));
                          }}
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(balance.economy.loginRewards ?? []).length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 8, color: '#94a3b8', fontSize: 12 }}
                      >
                        Пока пусто. Нажми «+ День», чтобы добавить календарь.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 11 }}>
                В прогнозе награда за вход начисляется 1 раз в календарный день. Траты харда пока не моделируем.
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <h4 style={{ marginTop: 0 }}>Стоимость улучшения оружия (лист Weapons)</h4>
            <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 0 }}>
              Параметры цены апгрейда теперь хранятся в стволах (`weapons.*`) и редактируются в разделе{' '}
              <strong>Оружие и карты</strong>. Здесь только справка по текущим значениям.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Оружие</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>База софта</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Коэфф. роста цены</th>
                </tr>
              </thead>
              <tbody>
                {(['machineGun', 'hydra70', 'hellfire'] as const).map((id) => (
                  <tr key={id}>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      {balance.weapons[id].displayName}
                    </td>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      {Math.round(balance.weapons[id].upgradeBaseSoft ?? 0).toLocaleString('ru-RU')}
                    </td>
                    <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      {balance.weapons[id].upgradeCostMultiplier ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={cardStyle}>
            <h4 style={{ marginTop: 0 }}>Стоимость улучшений карточек (софт и чертежи)</h4>
            <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 0 }}>
              Таблица по уровню карточки: софт по редкости и чертежи. На оружие эта таблица не влияет.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Ур.</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Софт</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Чертежи (карточки)</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(balance.economy.upgradeCostsByLevel ?? {})
                  .map(Number)
                  .sort((a, b) => a - b)
                  .map(String)
                  .map((level) => {
                    const row = balance.economy.upgradeCostsByLevel?.[level] ?? { soft: 0, blueprints: 0 };
                    return (
                      <tr key={level}>
                        <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{level}</td>
                        <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                          <input
                            style={inputStyle}
                            type="number"
                            min={0}
                            value={row.soft}
                            onChange={(e) => setUpgradeCostField(setBalance, level, 'soft', Number(e.target.value) || 0)}
                          />
                        </td>
                        <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                          <input
                            style={inputStyle}
                            type="number"
                            min={0}
                            value={row.blueprints}
                            onChange={(e) => setUpgradeCostField(setBalance, level, 'blueprints', Number(e.target.value) || 0)}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div style={cardStyle}>
            <h4 style={{ marginTop: 0 }}>Подсказка</h4>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>
              Эти поля теперь сгруппированы и визуально отделены. Если захочешь, следующим шагом можно сделать ещё и отдельные пресеты "баланс для ранней/средней/поздней игры".
            </p>
          </div>

          <div style={cardStyle}>
            <h4 style={{ marginTop: 0 }}>Управление данными</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{
                  border: '1px solid rgba(148, 163, 184, 0.35)',
                  borderRadius: 999,
                  background: 'rgba(30, 41, 59, 0.9)',
                  color: '#e2e8f0',
                  padding: '6px 10px',
                  fontSize: 12,
                }}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(balance, null, 2)], { type: 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = 'balance-export.json';
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Скачать баланс (JSON)
              </button>
              <button
                type="button"
                style={{
                  border: '1px solid #f97316',
                  borderRadius: 999,
                  background: 'rgba(15, 23, 42, 0.95)',
                  color: '#fed7aa',
                  padding: '6px 10px',
                  fontSize: 12,
                }}
                onClick={onResetToDefaults}
                disabled={!onResetToDefaults}
              >
                Сбросить к дефолту
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
