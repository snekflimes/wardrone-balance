import React from 'react';
import type { BalanceConstants } from '../balance/model';
import {
  getOutgoingCombatRealismMultiplier,
  getOutgoingSkillDamageMultiplier,
} from '../balance/simulator';
import { resolveForecastOutgoingCombatRealism } from '../balance/forecastCalibration';
import { FormulaConstructor } from './FormulaConstructor';

type SetBalance = React.Dispatch<React.SetStateAction<BalanceConstants>>;

function num(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function updateMeta(setBalance: SetBalance, key: keyof BalanceConstants['meta'], value: number) {
  setBalance((prev) => ({
    ...prev,
    meta: { ...prev.meta, [key]: value },
  }));
}

function updatePlayer(setBalance: SetBalance, key: keyof BalanceConstants['player'], value: number) {
  setBalance((prev) => ({
    ...prev,
    player: { ...prev.player, [key]: value },
  }));
}

function updateEconomy(setBalance: SetBalance, key: string, value: number) {
  setBalance((prev) => ({
    ...prev,
    economy: { ...prev.economy, [key]: value } as BalanceConstants['economy'],
  }));
}

function updateCombatSkill(
  setBalance: SetBalance,
  key:
    | 'missChancePercent'
    | 'partialHitChancePercent'
    | 'partialDamagePercent'
    | 'spreadSpatialEfficiencyPercent'
    | 'reachLeakPercent'
    | 'forecastOutgoingRealismGlobal'
    | 'forecastRetryPowerGainPerAttempt',
  value: number
) {
  setBalance((prev) => ({
    ...prev,
    economy: {
      ...prev.economy,
      combatSkill: {
        ...(prev.economy.combatSkill ?? {}),
        [key]: value,
      },
    },
  }));
}

function updateWeapon(
  setBalance: SetBalance,
  weaponId: 'machineGun' | 'hydra70' | 'hellfire',
  key: 'baseDamage' | 'baseFireRatePerMin' | 'baseAmmo',
  value: number
) {
  setBalance((prev) => ({
    ...prev,
    weapons: {
      ...prev.weapons,
      [weaponId]: { ...prev.weapons[weaponId], [key]: value },
    },
  }));
}

const labelStyle: React.CSSProperties = { minWidth: 180, fontSize: 13, color: '#cbd5e1' };

interface FormulasPanelProps {
  balance: BalanceConstants;
  setBalance: SetBalance;
}

export const FormulasPanel: React.FC<FormulasPanelProps> = ({ balance, setBalance }) => {
  const { meta, player, economy, weapons } = balance;
  const skill = economy.combatSkill ?? {};
  const outgoingSkillMult = getOutgoingSkillDamageMultiplier(economy);
  const outgoingCombatRealismMult = getOutgoingCombatRealismMultiplier(economy);
  const forecastCombatRealismMult = resolveForecastOutgoingCombatRealism(1, economy);

  return (
    <div className="ui-stack">
      <FormulaConstructor balance={balance} setBalance={setBalance} />

      <p className="ui-hint">Параметры для формул и встроенных расчётов:</p>

      <section className="ui-block ui-block--accent">
        <h4 style={{ color: '#7dd3fc' }}>Прогноз (вкладка «Прогноз»)</h4>
        <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
          Колонка «День прохода»: лимит попыток в день. Бесплатные сундуки в прогнозе: по ключам за попытку уровня (победа /
          поражение), цикл сундуков — порядок в <code style={{ color: '#cbd5e1' }}>economy.freeChests</code>; параметры в{' '}
          <code style={{ color: '#cbd5e1' }}>economy.freeChestKeyProgression</code> (вкладка «Сундуки и магазин»).
        </p>
        <div className="ui-field">
          <span style={labelStyle}>Макс. попыток уровня в календарный день прогноза</span>
          <input
            type="number"
            min={1}
            max={500}
            step={1}
            value={meta.forecastMaxAttemptsPerDay ?? 10}
            onChange={(e) =>
              updateMeta(
                setBalance,
                'forecastMaxAttemptsPerDay',
                Math.max(1, num(e.target.value) || 10)
              )
            }
          />
        </div>
      </section>

      <section className="ui-block">
        <h4 style={{ marginBottom: 10 }}>Мета (глобальные лимиты)</h4>
        <div className="ui-field">
          <span style={labelStyle}>Макс. уровень (графики / запасной лимит)</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxWeaponLevel}
            onChange={(e) => updateMeta(setBalance, 'maxWeaponLevel', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Макс. ур. пулемёта</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxMachineGunLevel ?? meta.maxWeaponLevel}
            onChange={(e) => updateMeta(setBalance, 'maxMachineGunLevel', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Макс. ур. Hydra-70</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxHydraLevel ?? meta.maxWeaponLevel}
            onChange={(e) => updateMeta(setBalance, 'maxHydraLevel', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Макс. ур. Hellfire</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxHellfireLevel ?? meta.maxWeaponLevel}
            onChange={(e) => updateMeta(setBalance, 'maxHellfireLevel', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Макс. уровень игрока</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxPlayerLevel}
            onChange={(e) => updateMeta(setBalance, 'maxPlayerLevel', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Число игровых уровней (миссии)</span>
          <input
            type="number"
            min={1}
            max={99}
            value={meta.gameLevels}
            onChange={(e) => updateMeta(setBalance, 'gameLevels', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Длительность волны (сек) — для устойчивого DPS</span>
          <input
            type="number"
            min={1}
            max={300}
            value={meta.baseWaveTimeSec}
            onChange={(e) => updateMeta(setBalance, 'baseWaveTimeSec', num(e.target.value) || 45)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>
            Дистанция спавна до VIP (юниты) — влияет на порядок «кто раньше выходит на стрельбу»; секунды урона
            нормализуются в окно ниже
          </span>
          <input
            type="number"
            min={0}
            max={5000}
            value={meta.defaultSpawnDistanceFromVip ?? 512}
            onChange={(e) =>
              updateMeta(
                setBalance,
                'defaultSpawnDistanceFromVip',
                Math.max(0, num(e.target.value) || 512)
              )
            }
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>
            Подход волны: первые типы начинают бить VIP через (сек)
          </span>
          <input
            type="number"
            min={0}
            max={120}
            step={0.5}
            value={meta.waveThreatEngageMinSec ?? 3}
            onChange={(e) =>
              updateMeta(
                setBalance,
                'waveThreatEngageMinSec',
                Math.max(0, num(e.target.value) || 3)
              )
            }
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Подход волны: последние типы — полный DPS через (сек)</span>
          <input
            type="number"
            min={0}
            max={120}
            step={0.5}
            value={meta.waveThreatEngageMaxSec ?? 6}
            onChange={(e) =>
              updateMeta(
                setBalance,
                'waveThreatEngageMaxSec',
                Math.max(0, num(e.target.value) || 6)
              )
            }
          />
        </div>
      </section>

      <section className="ui-block">
        <h4 style={{ marginBottom: 10 }}>Защищаемая цель</h4>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, lineHeight: 1.45 }}>
          Объект на карте, который нельзя потерять: враги бьют по нему, при 0 HP — поражение. Дополнительный max HP даёт
          пассивная карта №17 «Укрепление базы» (вкладка «Оружие и карты»).
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Базовое HP защищаемой цели</span>
          <input
            type="number"
            min={1}
            value={player.protectedTargetBaseHp ?? player.baseAllyInfantryHp ?? player.baseAllyHp ?? 175}
            onChange={(e) =>
              updatePlayer(setBalance, 'protectedTargetBaseHp', num(e.target.value) || 1)
            }
          />
        </div>
      </section>

      <section className="ui-block">
        <h4 style={{ marginBottom: 10 }}>Формулы наград (бой)</h4>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, lineHeight: 1.45 }}>
          Глобальная база (одинаковая на всех уровнях) задаётся полем ниже и конструктором формулы. Награда за бой: база × премиум
          (если есть) + награда за убийства; при победе дополнительно бонус victoryBonusMultiplier × (база×премиум +
          убийства). При поражении бонус не начисляется, база и убийства — да. Номер этапа в симуляторе базу не множит —
          только состав противников (геймплей).
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Базовая награда за бой (монеты, до премиума/убийств/бонуса)</span>
          <input
            type="number"
            min={0}
            value={economy.baseMissionReward}
            onChange={(e) => updateEconomy(setBalance, 'baseMissionReward', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Боёв подряд на уровень в симуляторе (meta.wavesPerLevel)</span>
          <input
            type="number"
            min={1}
            max={10}
            value={meta.wavesPerLevel ?? 2}
            onChange={(e) =>
              updateMeta(setBalance, 'wavesPerLevel', Math.max(1, Math.min(10, num(e.target.value) || 2)))
            }
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Коэфф. премиума к базе (premiumRewardMultiplier)</span>
          <input
            type="number"
            min={1}
            step={0.05}
            value={economy.premiumRewardMultiplier ?? 2}
            onChange={(e) => updateEconomy(setBalance, 'premiumRewardMultiplier', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Бонус за победу от суммы базы+убийств (victoryBonusMultiplier)</span>
          <input
            type="number"
            min={0}
            max={3}
            step={0.05}
            value={economy.victoryBonusMultiplier ?? 0.75}
            onChange={(e) => updateEconomy(setBalance, 'victoryBonusMultiplier', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Миссий в одной сессии (missionsPerSession)</span>
          <input
            type="number"
            min={1}
            max={20}
            value={economy.missionsPerSession ?? 3}
            onChange={(e) => updateEconomy(setBalance, 'missionsPerSession', num(e.target.value) || 3)}
          />
        </div>
      </section>

      <section className="ui-block">
        <h4 style={{ marginBottom: 10 }}>Бой и волны</h4>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, lineHeight: 1.4 }}>
          Состав волн — конструктор / референс. Параметры юнитов не масштабируются от номера уровня.{' '}
          <strong style={{ color: '#e2e8f0' }}>Промахи/слабые попадания</strong>: множитель{' '}
          <strong style={{ color: '#e2e8f0' }}>{outgoingSkillMult.toFixed(4)}</strong>.{' '}
          <strong style={{ color: '#e2e8f0' }}>Разброс целей</strong> (доля урона стволов в эффективное снятие HP): ещё ×
          (разброс&nbsp;% / 100). <strong style={{ color: '#e2e8f0' }}>Итого реализм стволов</strong>:{' '}
          <strong style={{ color: '#e2e8f0' }}>{outgoingCombatRealismMult.toFixed(4)}</strong> — песочница боя.{' '}
          <strong style={{ color: '#e2e8f0' }}>Прогноз</strong>: ×{' '}
          <strong style={{ color: '#e2e8f0' }}>{forecastCombatRealismMult.toFixed(4)}</strong> (база × global, все уровни
          одинаково). У reach: «утечка» при уже мёртвой волне.
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Промах (нет урона), %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={skill.missChancePercent ?? 0}
            onChange={(e) => updateCombatSkill(setBalance, 'missChancePercent', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Слабое попадание (доля среди не-промахов), %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={skill.partialHitChancePercent ?? 0}
            onChange={(e) => updateCombatSkill(setBalance, 'partialHitChancePercent', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Урон слабого попадания, % от полного</span>
          <input
            type="number"
            min={0}
            max={100}
            value={skill.partialDamagePercent ?? 50}
            onChange={(e) => updateCombatSkill(setBalance, 'partialDamagePercent', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Эффективность урона по разнесённым целям, %</span>
          <input
            type="number"
            min={5}
            max={100}
            value={skill.spreadSpatialEfficiencyPercent ?? 100}
            onChange={(e) =>
              updateCombatSkill(setBalance, 'spreadSpatialEfficiencyPercent', num(e.target.value))
            }
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Утечка reach (взрыв при уже мёртвой волне), %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={skill.reachLeakPercent ?? 0}
            onChange={(e) => updateCombatSkill(setBalance, 'reachLeakPercent', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>
            Прогноз: global к плейтесту (forecastOutgoingRealismGlobal, 0.02–1)
          </span>
          <input
            type="number"
            min={0.02}
            max={1}
            step={0.01}
            value={skill.forecastOutgoingRealismGlobal ?? 0.15}
            onChange={(e) =>
              updateCombatSkill(
                setBalance,
                'forecastOutgoingRealismGlobal',
                Math.max(0.02, Math.min(1, num(e.target.value) || 0.15))
              )
            }
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>
            Прогноз: рост силы за ретрай попытки (forecastRetryPowerGainPerAttempt)
          </span>
          <input
            type="number"
            min={0}
            max={0.2}
            step={0.005}
            value={skill.forecastRetryPowerGainPerAttempt ?? 0.01}
            onChange={(e) =>
              updateCombatSkill(
                setBalance,
                'forecastRetryPowerGainPerAttempt',
                Math.max(0, Math.min(0.2, num(e.target.value)))
              )
            }
          />
        </div>
      </section>

      <section className="ui-block">
        <h4 style={{ marginBottom: 10 }}>Слоты карт</h4>
        <div className="ui-field">
          <span style={labelStyle}>Миссий на уровень игрока</span>
          <input
            type="number"
            min={1}
            value={economy.missionsPerPlayerLevel}
            onChange={(e) => updateEconomy(setBalance, 'missionsPerPlayerLevel', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Стоимость слота карт (монеты)</span>
          <input
            type="number"
            min={0}
            value={economy.cardSlotCost}
            onChange={(e) => updateEconomy(setBalance, 'cardSlotCost', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Макс. слотов карт</span>
          <input
            type="number"
            min={1}
            value={economy.maxCardSlots}
            onChange={(e) => updateEconomy(setBalance, 'maxCardSlots', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Стартовые слоты деки (startingCardSlots)</span>
          <input
            type="number"
            min={1}
            value={economy.startingCardSlots ?? 4}
            onChange={(e) => updateEconomy(setBalance, 'startingCardSlots', num(e.target.value) || 1)}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Карт за уровень (cardSlotsPerLevel)</span>
          <input
            type="number"
            min={0}
            value={economy.cardSlotsPerLevel}
            onChange={(e) => updateEconomy(setBalance, 'cardSlotsPerLevel', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Базовая стоимость улучшения карты</span>
          <input
            type="number"
            min={0}
            value={economy.cardBaseCost}
            onChange={(e) => updateEconomy(setBalance, 'cardBaseCost', num(e.target.value))}
          />
        </div>
        <div className="ui-field">
          <span style={labelStyle}>Бонус карты (%)</span>
          <input
            type="number"
            min={0}
            value={economy.cardBaseBonusPercent}
            onChange={(e) => updateEconomy(setBalance, 'cardBaseBonusPercent', num(e.target.value))}
          />
        </div>
      </section>

      <section className="ui-block">
        <h4 style={{ marginBottom: 10 }}>Базовые значения оружия (уровень 1)</h4>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
          Индивидуальные коэффициенты роста теперь редактируются в разделе «Оружие и карты» у каждого ствола отдельно.
        </div>
        {(['machineGun', 'hydra70', 'hellfire'] as const).map((id) => (
          <div key={id} style={{ marginBottom: 12 }}>
            <strong>{weapons[id].displayName}</strong>
            <div className="ui-field">
              <span style={labelStyle}>Базовый урон</span>
              <input
                type="number"
                min={0}
                value={weapons[id].baseDamage}
                onChange={(e) => updateWeapon(setBalance, id, 'baseDamage', num(e.target.value))}
              />
            </div>
            <div className="ui-field">
              <span style={labelStyle}>Выстрелов в минуту</span>
              <input
                type="number"
                min={0}
                value={weapons[id].baseFireRatePerMin}
                onChange={(e) => updateWeapon(setBalance, id, 'baseFireRatePerMin', num(e.target.value))}
              />
            </div>
            <div className="ui-field">
              <span style={labelStyle}>Боезапас</span>
              <input
                type="number"
                min={0}
                value={weapons[id].baseAmmo}
                onChange={(e) => updateWeapon(setBalance, id, 'baseAmmo', num(e.target.value))}
              />
            </div>
          </div>
        ))}
      </section>

      {economy.usdAnchor && (
        <section className="ui-block">
          <h4 style={{ marginBottom: 10 }}>Якорь USD (VIP)</h4>
          <div className="ui-field">
            <span style={labelStyle}>Цена VIP в золоте (для курса gold→USD)</span>
            <input
              type="number"
              min={1}
              value={economy.usdAnchor.vipPriceHard}
              onChange={(e) =>
                setBalance((prev) => ({
                  ...prev,
                  economy: {
                    ...prev.economy,
                    usdAnchor: { ...prev.economy.usdAnchor!, vipPriceHard: num(e.target.value) || 1 },
                  },
                }))
              }
            />
          </div>
        </section>
      )}
    </div>
  );
};
