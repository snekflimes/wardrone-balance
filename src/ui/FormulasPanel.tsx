import React from 'react';
import type { BalanceConstants } from '../balance/model';
import { getOutgoingSkillDamageMultiplier } from '../balance/simulator';
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
  key: 'missChancePercent' | 'partialHitChancePercent' | 'partialDamagePercent',
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

const blockStyle: React.CSSProperties = {
  marginBottom: 24,
  padding: 12,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: 8,
  background: 'rgba(15, 23, 42, 0.72)',
};

/** Заметный блок: настройки именно вкладки «Прогноз». */
const forecastBlockStyle: React.CSSProperties = {
  ...blockStyle,
  border: '2px solid rgba(56, 189, 248, 0.55)',
  background: 'rgba(12, 74, 110, 0.22)',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
  flexWrap: 'wrap',
};

const labelStyle: React.CSSProperties = { minWidth: 220, fontSize: 13, color: '#cbd5e1' };

interface FormulasPanelProps {
  balance: BalanceConstants;
  setBalance: SetBalance;
}

export const FormulasPanel: React.FC<FormulasPanelProps> = ({ balance, setBalance }) => {
  const { meta, player, economy, weapons } = balance;
  const skill = economy.combatSkill ?? {};
  const outgoingSkillMult = getOutgoingSkillDamageMultiplier(economy);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FormulaConstructor balance={balance} setBalance={setBalance} />

      <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
        Параметры, подставляемые в формулы и встроенные расчёты:
      </p>

      <section style={forecastBlockStyle}>
        <h4 style={{ marginTop: 0, marginBottom: 6, color: '#7dd3fc' }}>
          Прогноз прогрессии (вкладка «Прогноз»)
        </h4>
        <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>
          Колонка «День прохода»: лимит попыток в день. Бесплатные сундуки в прогнозе: ровно столько открытий в день, сколько
          указано ниже — по порядку первые записи в <code style={{ color: '#cbd5e1' }}>economy.freeChests</code> (1-й, 2-й,
          3-й сундук и т.д.), без таймеров от ожидания энергии.
        </p>
        <div style={rowStyle}>
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
        <div style={rowStyle}>
          <span style={labelStyle}>
            Бесплатных сундуков за календарный день прогноза (по порядку из economy.freeChests)
          </span>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={meta.forecastFreeChestsPerDay ?? 3}
            onChange={(e) =>
              updateMeta(
                setBalance,
                'forecastFreeChestsPerDay',
                Math.max(1, Math.min(20, num(e.target.value) || 3))
              )
            }
          />
        </div>
      </section>

      <section style={blockStyle}>
        <h4 style={{ marginTop: 0, marginBottom: 10 }}>Мета (глобальные лимиты)</h4>
        <div style={rowStyle}>
          <span style={labelStyle}>Макс. уровень (графики / запасной лимит)</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxWeaponLevel}
            onChange={(e) => updateMeta(setBalance, 'maxWeaponLevel', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Макс. ур. пулемёта</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxMachineGunLevel ?? meta.maxWeaponLevel}
            onChange={(e) => updateMeta(setBalance, 'maxMachineGunLevel', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Макс. ур. Hydra-70</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxHydraLevel ?? meta.maxWeaponLevel}
            onChange={(e) => updateMeta(setBalance, 'maxHydraLevel', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Макс. ур. Hellfire</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxHellfireLevel ?? meta.maxWeaponLevel}
            onChange={(e) => updateMeta(setBalance, 'maxHellfireLevel', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Макс. уровень игрока</span>
          <input
            type="number"
            min={1}
            max={999}
            value={meta.maxPlayerLevel}
            onChange={(e) => updateMeta(setBalance, 'maxPlayerLevel', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Число игровых уровней (миссии)</span>
          <input
            type="number"
            min={1}
            max={99}
            value={meta.gameLevels}
            onChange={(e) => updateMeta(setBalance, 'gameLevels', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Длительность волны (сек) — для устойчивого DPS</span>
          <input
            type="number"
            min={1}
            max={300}
            value={meta.baseWaveTimeSec}
            onChange={(e) => updateMeta(setBalance, 'baseWaveTimeSec', num(e.target.value) || 45)}
          />
        </div>
        <div style={rowStyle}>
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
        <div style={rowStyle}>
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
        <div style={rowStyle}>
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

      <section style={blockStyle}>
        <h4 style={{ marginTop: 0, marginBottom: 10 }}>Игрок / вертолёт</h4>
        <div style={rowStyle}>
          <span style={labelStyle}>Базовое HP вертолёта</span>
          <input
            type="number"
            min={1}
            value={player.baseAllyHp}
            onChange={(e) => updatePlayer(setBalance, 'baseAllyHp', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>HP союзной пехоты</span>
          <input
            type="number"
            min={1}
            value={player.baseAllyInfantryHp}
            onChange={(e) => updatePlayer(setBalance, 'baseAllyInfantryHp', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Урон союзной пехоты</span>
          <input
            type="number"
            min={0}
            value={player.baseAllyInfantryDamage}
            onChange={(e) => updatePlayer(setBalance, 'baseAllyInfantryDamage', num(e.target.value))}
          />
        </div>
      </section>

      <section style={blockStyle}>
        <h4 style={{ marginTop: 0, marginBottom: 10 }}>Формулы наград (миссии)</h4>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
          Награда за волну (софт) = baseMissionReward × baseLevelRewardMultiplier^(уровень−1) ×
          missionDifficultyMultiplier^(волна−1). На силу врагов в бою это не влияет. За уровень = сумма по волнам.
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Базовая награда за миссию (монеты)</span>
          <input
            type="number"
            min={0}
            value={economy.baseMissionReward}
            onChange={(e) => updateEconomy(setBalance, 'baseMissionReward', num(e.target.value))}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Множитель награды за уровень (baseLevelRewardMultiplier)</span>
          <input
            type="number"
            min={0.1}
            step={0.05}
            value={economy.baseLevelRewardMultiplier}
            onChange={(e) => updateEconomy(setBalance, 'baseLevelRewardMultiplier', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Множитель награды между волнами (missionDifficultyMultiplier)</span>
          <input
            type="number"
            min={0.1}
            step={0.05}
            value={economy.missionDifficultyMultiplier}
            onChange={(e) => updateEconomy(setBalance, 'missionDifficultyMultiplier', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Волн на один игровой уровень (wavesPerLevel)</span>
          <input
            type="number"
            min={1}
            max={10}
            value={economy.wavesPerLevel ?? 2}
            onChange={(e) => updateEconomy(setBalance, 'wavesPerLevel', num(e.target.value) || 2)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Миссий в одной сессии (missionsPerSession)</span>
          <input
            type="number"
            min={1}
            max={20}
            value={economy.missionsPerSession ?? 3}
            onChange={(e) => updateEconomy(setBalance, 'missionsPerSession', num(e.target.value) || 3)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Штраф за поражение (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={economy.lossPenaltyPercent}
            onChange={(e) => updateEconomy(setBalance, 'lossPenaltyPercent', num(e.target.value))}
          />
        </div>
      </section>

      <section style={blockStyle}>
        <h4 style={{ marginTop: 0, marginBottom: 10 }}>Бой и волны</h4>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, lineHeight: 1.4 }}>
          Состав и численность врагов задаются в конструкторе волн (и референсом CreateSheets). Параметры юнитов в бою не
          масштабируются от номера уровня или волны. Скилл: ожидаемый множитель исходящего DPS = (1 − промах%) ×
          ((доля слабых × сила слабого) + (1 − доля слабых)). Сейчас:{' '}
          <strong style={{ color: '#e2e8f0' }}>{outgoingSkillMult.toFixed(4)}</strong>.
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Промах (нет урона), %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={skill.missChancePercent ?? 0}
            onChange={(e) => updateCombatSkill(setBalance, 'missChancePercent', num(e.target.value))}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Слабое попадание (доля среди не-промахов), %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={skill.partialHitChancePercent ?? 0}
            onChange={(e) => updateCombatSkill(setBalance, 'partialHitChancePercent', num(e.target.value))}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Урон слабого попадания, % от полного</span>
          <input
            type="number"
            min={0}
            max={100}
            value={skill.partialDamagePercent ?? 50}
            onChange={(e) => updateCombatSkill(setBalance, 'partialDamagePercent', num(e.target.value))}
          />
        </div>
      </section>

      <section style={blockStyle}>
        <h4 style={{ marginTop: 0, marginBottom: 10 }}>Квесты и слоты карт</h4>
        <div style={rowStyle}>
          <span style={labelStyle}>Награда за квест (монеты)</span>
          <input
            type="number"
            min={0}
            value={economy.questBaseReward}
            onChange={(e) => updateEconomy(setBalance, 'questBaseReward', num(e.target.value))}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Миссий на уровень игрока</span>
          <input
            type="number"
            min={1}
            value={economy.missionsPerPlayerLevel}
            onChange={(e) => updateEconomy(setBalance, 'missionsPerPlayerLevel', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Квестов на уровень</span>
          <input
            type="number"
            min={1}
            value={economy.questsPerLevel}
            onChange={(e) => updateEconomy(setBalance, 'questsPerLevel', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Стоимость слота карт (монеты)</span>
          <input
            type="number"
            min={0}
            value={economy.cardSlotCost}
            onChange={(e) => updateEconomy(setBalance, 'cardSlotCost', num(e.target.value))}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Макс. слотов карт</span>
          <input
            type="number"
            min={1}
            value={economy.maxCardSlots}
            onChange={(e) => updateEconomy(setBalance, 'maxCardSlots', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Стартовые слоты деки (startingCardSlots)</span>
          <input
            type="number"
            min={1}
            value={economy.startingCardSlots ?? 4}
            onChange={(e) => updateEconomy(setBalance, 'startingCardSlots', num(e.target.value) || 1)}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Карт за уровень (cardSlotsPerLevel)</span>
          <input
            type="number"
            min={0}
            value={economy.cardSlotsPerLevel}
            onChange={(e) => updateEconomy(setBalance, 'cardSlotsPerLevel', num(e.target.value))}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Базовая стоимость улучшения карты</span>
          <input
            type="number"
            min={0}
            value={economy.cardBaseCost}
            onChange={(e) => updateEconomy(setBalance, 'cardBaseCost', num(e.target.value))}
          />
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Бонус карты (%)</span>
          <input
            type="number"
            min={0}
            value={economy.cardBaseBonusPercent}
            onChange={(e) => updateEconomy(setBalance, 'cardBaseBonusPercent', num(e.target.value))}
          />
        </div>
      </section>

      <section style={blockStyle}>
        <h4 style={{ marginTop: 0, marginBottom: 10 }}>Базовые значения оружия (уровень 1)</h4>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
          Индивидуальные коэффициенты роста теперь редактируются в разделе «Оружие и карты» у каждого ствола отдельно.
        </div>
        {(['machineGun', 'hydra70', 'hellfire'] as const).map((id) => (
          <div key={id} style={{ marginBottom: 12 }}>
            <strong>{weapons[id].displayName}</strong>
            <div style={rowStyle}>
              <span style={labelStyle}>Базовый урон</span>
              <input
                type="number"
                min={0}
                value={weapons[id].baseDamage}
                onChange={(e) => updateWeapon(setBalance, id, 'baseDamage', num(e.target.value))}
              />
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Выстрелов в минуту</span>
              <input
                type="number"
                min={0}
                value={weapons[id].baseFireRatePerMin}
                onChange={(e) => updateWeapon(setBalance, id, 'baseFireRatePerMin', num(e.target.value))}
              />
            </div>
            <div style={rowStyle}>
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
        <section style={blockStyle}>
          <h4 style={{ marginTop: 0, marginBottom: 10 }}>Якорь USD (VIP)</h4>
          <div style={rowStyle}>
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
