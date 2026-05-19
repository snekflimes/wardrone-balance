import React from 'react';
import type { BalanceConstants } from '../balance/model';

export const ForecastCombatCalibrationControls: React.FC<{
  balance: BalanceConstants;
  setBalance?: React.Dispatch<React.SetStateAction<BalanceConstants>>;
  forecastBaseRealismMult: number;
  forecastEffectiveRealismMult: number;
  forecastCalibrationHint: string;
  patchCombatSkill: (
    key: 'forecastOutgoingRealismGlobal' | 'forecastRetryPowerGainPerAttempt',
    value: number
  ) => void;
  inputStyle: React.CSSProperties;
}> = ({
  balance,
  setBalance,
  forecastBaseRealismMult,
  forecastEffectiveRealismMult,
  forecastCalibrationHint,
  patchCombatSkill,
  inputStyle,
}) => {
  const combatSkill = balance.economy.combatSkill ?? {};

  return (
    <div
      style={{
        marginTop: 12,
        marginBottom: 12,
        padding: 14,
        borderRadius: 10,
        border: '2px solid rgba(251, 191, 36, 0.45)',
        background: 'rgba(120, 53, 15, 0.22)',
      }}
    >
      <h4 style={{ margin: '0 0 8px 0', fontWeight: 700, color: '#fcd34d', fontSize: 15 }}>
        Калибровка боя (плейтест)
      </h4>
      <p style={{ margin: '0 0 12px 0', fontSize: 12, color: '#fde68a', lineHeight: 1.5, maxWidth: 920 }}>
        Один коэффициент на <strong style={{ color: '#fef3c7' }}>все</strong> уровни: итоговый урон в прогнозе = промахи/разброс
        (×{forecastBaseRealismMult.toFixed(3)}) × <strong style={{ color: '#fef3c7' }}>global</strong> ={' '}
        <strong style={{ color: '#fef3c7' }}>×{forecastEffectiveRealismMult.toFixed(3)}</strong>. Уменьшайте global, если
        прогноз легче плейтеста; увеличивайте — если жёстче. {forecastCalibrationHint}.
      </p>
      {setBalance ? (
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}
        >
          <label>
            <div style={{ color: '#fde68a', fontSize: 12, marginBottom: 6 }}>
              Global к плейтесту (forecastOutgoingRealismGlobal)
            </div>
            <input
              style={inputStyle}
              type="number"
              min={0.02}
              max={1}
              step={0.01}
              value={combatSkill.forecastOutgoingRealismGlobal ?? 0.147}
              onChange={(e) =>
                patchCombatSkill(
                  'forecastOutgoingRealismGlobal',
                  Math.max(0.02, Math.min(1, Number(e.target.value) || 0.147))
                )
              }
            />
          </label>
          <label>
            <div style={{ color: '#fde68a', fontSize: 12, marginBottom: 6 }}>
              Рост силы за ретрай попытки (forecastRetryPowerGainPerAttempt)
            </div>
            <input
              style={inputStyle}
              type="number"
              min={0}
              max={0.2}
              step={0.005}
              value={combatSkill.forecastRetryPowerGainPerAttempt ?? 0.01}
              onChange={(e) =>
                patchCombatSkill(
                  'forecastRetryPowerGainPerAttempt',
                  Math.max(0, Math.min(0.2, Number(e.target.value)))
                )
              }
            />
          </label>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#fde68a' }}>
          global = {combatSkill.forecastOutgoingRealismGlobal ?? 0.147}, ретрай ={' '}
          {combatSkill.forecastRetryPowerGainPerAttempt ?? 0.01}
        </div>
      )}
      <p style={{ margin: '10px 0 0 0', fontSize: 11, color: '#ca8a04' }}>
        Промахи и разброс — вкладка «Формулы» → «Бой и волны».
      </p>
    </div>
  );
};
