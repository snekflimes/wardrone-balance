import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import type { BalanceConstants } from '../balance/model';
import { getWeaponLevelStats } from '../balance/simulator';
import { getMaxWeaponLevelAcross } from '../balance/weaponMeta';
import { getMissionRewardSoft, getWaveRewardSoft, getLevelRewardSoft } from '../balance/economy';

interface ChartsProps {
  balance: BalanceConstants;
}

export const Charts: React.FC<ChartsProps> = ({ balance }) => {
  const maxLevel = getMaxWeaponLevelAcross(balance);
  const gameLevels = balance.meta.gameLevels;

  const dpsData = React.useMemo(() => {
    const rows = [];
    for (let level = 1; level <= maxLevel; level++) {
      const mg = getWeaponLevelStats(balance, 'machineGun', level);
      const hydra = getWeaponLevelStats(balance, 'hydra70', level);
      const hellfire = getWeaponLevelStats(balance, 'hellfire', level);
      rows.push({
        level,
        Пулемёт: Math.round(mg.sustainedDps * 10) / 10,
        'Hydra-70': Math.round(hydra.sustainedDps * 10) / 10,
        Hellfire: Math.round(hellfire.sustainedDps * 10) / 10,
        'Суммарный DPS': Math.round((mg.sustainedDps + hydra.sustainedDps + hellfire.sustainedDps) * 10) / 10,
      });
    }
    return rows;
  }, [balance, maxLevel]);

  const rewardByLevelData = React.useMemo(() => {
    const rows = [];
    for (let level = 1; level <= gameLevels; level++) {
      const wave1 = getWaveRewardSoft(balance, level, 1);
      const wave2 = getWaveRewardSoft(balance, level, 2);
      const levelTotal = getLevelRewardSoft(balance, level);
      rows.push({
        level: 'Ур.' + level,
        'Волна 1': Math.round(wave1),
        'Волна 2': Math.round(wave2),
        'За уровень': Math.round(levelTotal),
      });
    }
    return rows;
  }, [balance, gameLevels]);

  const missionRewardCurve = React.useMemo(() => {
    return Array.from({ length: gameLevels }, (_, i) => ({
      level: i + 1,
      награда: Math.round(getMissionRewardSoft(balance, i + 1)),
    }));
  }, [balance, gameLevels]);

  return (
    <div className="ui-stack">
      <section>
        <h3>DPS оружия (устойчивый)</h3>
        <p className="ui-hint">По уровням стволов из баланса.</p>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={dpsData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="level" name="Уровень" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="Пулемёт" stroke="#8884d8" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Hydra-70" stroke="#82ca9d" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Hellfire" stroke="#ffc658" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Суммарный DPS" stroke="#ff7c7c" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3>Награда за миссию</h3>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={missionRewardCurve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="level" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="награда" stroke="#82ca9d" strokeWidth={2} dot={{ r: 4 }} name="Монет" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3>Награды по волнам и уровню</h3>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={rewardByLevelData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="level" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="Волна 1" fill="#8884d8" />
              <Bar dataKey="Волна 2" fill="#82ca9d" />
              <Bar dataKey="За уровень" fill="#ffc658" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
};
