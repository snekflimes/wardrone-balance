import React, { useMemo } from 'react';
import type { BalanceConstants } from '../balance/model';
import { getBestGoldPerUsd, getBestSoftPerUsd } from '../progression/iapAndChestsModel';

type SetBalance = React.Dispatch<React.SetStateAction<BalanceConstants>>;

const sectionStyle: React.CSSProperties = {
  marginTop: 0,
  padding: 14,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  borderRadius: 14,
  background: 'rgba(15, 23, 42, 0.55)',
};

const blockStyle: React.CSSProperties = {
  marginBottom: 14,
  padding: 12,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: 10,
  background: 'rgba(15, 23, 42, 0.72)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 120,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(15, 23, 42, 0.9)',
  color: '#e2e8f0',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = { minWidth: 260, fontSize: 13, color: '#cbd5e1' };

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function patchMeta(setBalance: SetBalance, patch: Partial<BalanceConstants['meta']>) {
  setBalance((prev) => ({ ...prev, meta: { ...prev.meta, ...patch } }));
}

export const TrafficPanel: React.FC<{ balance: BalanceConstants; setBalance: SetBalance }> = ({ balance, setBalance }) => {
  const meta = balance.meta;

  const usdPerDayPayer = meta.trafficUsdPerDayPayer ?? 1.142857;
  const usdPerDayWhale = meta.trafficUsdPerDayWhale ?? 10.785714;
  const dau = meta.trafficDau ?? 70000;
  const payerShare = meta.trafficPayerShare ?? 0.08;
  const whaleShare = meta.trafficWhaleShare ?? 0.01;
  const freeShare = Math.max(0, 1 - Math.max(0, payerShare) - Math.max(0, whaleShare));
  const ecpm = meta.trafficEcpmUsd ?? 6;
  const viewsPerDay = meta.trafficViewsPerDay ?? 5;
  const marketFee = meta.trafficMarketFee ?? 0.3;
  const royalty = meta.trafficRoyalty ?? 0.3;
  const taxes = meta.trafficTaxes ?? 0.06;

  const rates = useMemo(() => {
    const softPerUsd = getBestSoftPerUsd(balance);
    const goldPerUsd = getBestGoldPerUsd(balance);
    return { softPerUsd, goldPerUsd };
  }, [balance]);

  const metrics = useMemo(() => {
    const dauClamped = Math.max(0, dau);
    const pShare = Math.max(0, Math.min(1, payerShare));
    const wShare = Math.max(0, Math.min(1, whaleShare));
    const payerUsers = dauClamped * pShare;
    const whaleUsers = dauClamped * wShare;
    const iapUsdPerDay = payerUsers * Math.max(0, usdPerDayPayer) + whaleUsers * Math.max(0, usdPerDayWhale);
    const adsUsdPerDay = dauClamped * Math.max(0, viewsPerDay) * Math.max(0, ecpm) / 1000;
    const grossUsdPerDay = iapUsdPerDay + adsUsdPerDay;
    const fee = Math.max(0, Math.min(1, marketFee)) + Math.max(0, Math.min(1, royalty)) + Math.max(0, Math.min(1, taxes));
    const netUsdPerDay = grossUsdPerDay * Math.max(0, 1 - fee);
    const arpdau = dauClamped > 0 ? grossUsdPerDay / dauClamped : 0;
    const softPerDay = iapUsdPerDay * rates.softPerUsd;
    const goldPerDay = iapUsdPerDay * rates.goldPerUsd;
    return {
      payerUsers,
      whaleUsers,
      iapUsdPerDay,
      adsUsdPerDay,
      grossUsdPerDay,
      netUsdPerDay,
      arpdau,
      softPerDay,
      goldPerDay,
      fee,
    };
  }, [
    dau,
    payerShare,
    whaleShare,
    usdPerDayPayer,
    usdPerDayWhale,
    viewsPerDay,
    ecpm,
    marketFee,
    royalty,
    taxes,
    rates.softPerUsd,
    rates.goldPerUsd,
  ]);

  return (
    <section style={sectionStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Трафик</h3>
      <p style={{ margin: 0, color: '#94a3b8', fontSize: 13, lineHeight: 1.45, maxWidth: 980 }}>
        Настройки трафика и доната, чтобы было видно, <strong style={{ color: '#e2e8f0' }}>почему</strong> меняется прогноз
        при переключении сегмента. Значения USD/день используются в прогнозе для притока софта у payer/whale.
      </p>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        <section style={blockStyle}>
          <h4 style={{ marginTop: 0, marginBottom: 8 }}>Сегменты: донат в день</h4>
          <div style={rowStyle}>
            <span style={labelStyle}>Payer USD/день</span>
            <input
              style={inputStyle}
              type="number"
              step={0.01}
              min={0}
              value={usdPerDayPayer}
              onChange={(e) => patchMeta(setBalance, { trafficUsdPerDayPayer: Math.max(0, n(e.target.value)) })}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Whale USD/день</span>
            <input
              style={inputStyle}
              type="number"
              step={0.01}
              min={0}
              value={usdPerDayWhale}
              onChange={(e) => patchMeta(setBalance, { trafficUsdPerDayWhale: Math.max(0, n(e.target.value)) })}
            />
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
            Конвертация по лучшим IAP-пакам: soft/USD ≈ {Math.round(rates.softPerUsd * 10) / 10},{' '}
            gold/USD ≈ {Math.round(rates.goldPerUsd * 10) / 10}
          </div>
        </section>

        <section style={blockStyle}>
          <h4 style={{ marginTop: 0, marginBottom: 8 }}>Трафик: аудитория и реклама</h4>
          <div style={rowStyle}>
            <span style={labelStyle}>DAU</span>
            <input
              style={inputStyle}
              type="number"
              step={1}
              min={0}
              value={dau}
              onChange={(e) => patchMeta(setBalance, { trafficDau: Math.max(0, Math.round(n(e.target.value))) })}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Доля payer (0..1)</span>
            <input
              style={inputStyle}
              type="number"
              step={0.001}
              min={0}
              max={1}
              value={payerShare}
              onChange={(e) => patchMeta(setBalance, { trafficPayerShare: Math.max(0, Math.min(1, n(e.target.value))) })}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Доля whale (0..1)</span>
            <input
              style={inputStyle}
              type="number"
              step={0.001}
              min={0}
              max={1}
              value={whaleShare}
              onChange={(e) => patchMeta(setBalance, { trafficWhaleShare: Math.max(0, Math.min(1, n(e.target.value))) })}
            />
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
            Free доля (расчёт): {Math.round(freeShare * 1000) / 10}%
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>eCPM (USD)</span>
            <input
              style={inputStyle}
              type="number"
              step={0.1}
              min={0}
              value={ecpm}
              onChange={(e) => patchMeta(setBalance, { trafficEcpmUsd: Math.max(0, n(e.target.value)) })}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Views per day</span>
            <input
              style={inputStyle}
              type="number"
              step={0.1}
              min={0}
              value={viewsPerDay}
              onChange={(e) => patchMeta(setBalance, { trafficViewsPerDay: Math.max(0, n(e.target.value)) })}
            />
          </div>
        </section>

        <section style={blockStyle}>
          <h4 style={{ marginTop: 0, marginBottom: 8 }}>Комиссии (как в CSV)</h4>
          <div style={rowStyle}>
            <span style={labelStyle}>Market fee (0..1)</span>
            <input
              style={inputStyle}
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={marketFee}
              onChange={(e) => patchMeta(setBalance, { trafficMarketFee: Math.max(0, Math.min(1, n(e.target.value))) })}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Royalty (0..1)</span>
            <input
              style={inputStyle}
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={royalty}
              onChange={(e) => patchMeta(setBalance, { trafficRoyalty: Math.max(0, Math.min(1, n(e.target.value))) })}
            />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Taxes (0..1)</span>
            <input
              style={inputStyle}
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={taxes}
              onChange={(e) => patchMeta(setBalance, { trafficTaxes: Math.max(0, Math.min(1, n(e.target.value))) })}
            />
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Итого удержаний: {Math.round(metrics.fee * 1000) / 10}%
          </div>
        </section>

        <section style={{ ...blockStyle, border: '2px solid rgba(34, 197, 94, 0.5)', background: 'rgba(22, 101, 52, 0.18)' }}>
          <h4 style={{ marginTop: 0, marginBottom: 8, color: '#86efac' }}>Расчёт (в стиле вкладки «Заработок»)</h4>
          <div style={{ display: 'grid', gap: 6, color: '#e2e8f0', fontSize: 13, lineHeight: 1.55 }}>
            <div>IAP income: <strong>${Math.round(metrics.iapUsdPerDay).toLocaleString('ru-RU')}</strong> / день</div>
            <div>Adv income: <strong>${Math.round(metrics.adsUsdPerDay).toLocaleString('ru-RU')}</strong> / день</div>
            <div>Gross income: <strong>${Math.round(metrics.grossUsdPerDay).toLocaleString('ru-RU')}</strong> / день</div>
            <div>Net income: <strong>${Math.round(metrics.netUsdPerDay).toLocaleString('ru-RU')}</strong> / день</div>
            <div>ARPDAU (gross): <strong>${Math.round(metrics.arpdau * 10000) / 10000}</strong></div>
            <div>
              Эквивалент IAP в валюте игры (по лучшим пакам):{' '}
              <strong>{Math.round(metrics.softPerDay).toLocaleString('ru-RU')}</strong> soft/день ·{' '}
              <strong>{Math.round(metrics.goldPerDay).toLocaleString('ru-RU')}</strong> gold/день
            </div>
          </div>
        </section>
      </div>
    </section>
  );
};

