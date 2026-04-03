import type { BalanceConstants, SupportCardConfig, SupportCardManualLevel } from './model';
import type { ThreatEngagementSegment, WeaponLevelStats } from './schema';

function activeIncomingThreatDps(segments: ThreatEngagementSegment[], t: number): number {
  let s = 0;
  for (const seg of segments) {
    if (t + 1e-9 >= seg.engageAfterSec) s += seg.dps;
  }
  return s;
}

/** Как в Clash Royale: 1 единица маны каждые 1.2 с. */
export const MANA_PER_SECOND = 1 / 1.2;

const SIM_DT = 0.25;
/** Доля угрозы врага по «союзникам на поле» (пехота, техника), пока у них есть HP. */
const ALLY_THREAT_SHARE = 0.62;
const VIP_THREAT_SHARE = 1 - ALLY_THREAT_SHARE;

function getRowForCardLevel(card: SupportCardConfig, level: number): SupportCardManualLevel | null {
  const rows = card.manualLevels ?? [];
  if (rows.length === 0) return null;
  const exact = rows.find((r) => r.level === level);
  if (exact) return exact;
  const le = rows.filter((r) => r.level <= level).sort((a, b) => b.level - a.level);
  return le[0] ?? null;
}

function num(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return v;
}

function findValue(row: SupportCardManualLevel, predicate: (key: string) => boolean): number {
  const values = row.values ?? {};
  for (const key of Object.keys(values)) {
    if (predicate(key)) {
      const n = num(values[key]);
      if (n > 0 || key.toLowerCase().includes('перезарядка')) return n;
    }
  }
  return 0;
}

function manaCost(row: SupportCardManualLevel): number {
  const m = findValue(row, (k) => /мана/i.test(k));
  return m > 0 ? m : 4;
}

function cooldownSec(row: SupportCardManualLevel): number {
  const c = findValue(row, (k) => /перезарядка/i.test(k));
  return Math.max(0, c);
}

function p1(row: SupportCardManualLevel, card: SupportCardConfig): number {
  return num(row.values?.[card.param1Name]);
}

function p2(row: SupportCardManualLevel, card: SupportCardConfig): number {
  if (card.param2Name === '-' || !card.param2Name) return 0;
  return num(row.values?.[card.param2Name]);
}

function levelScale(level: number): number {
  return 1 + 0.12 * Math.max(0, level - 1);
}

export interface ManaCombatParams {
  constants: BalanceConstants;
  waveDurationSec: number;
  /** Устойчивый DPS стволов с модификаторами по составу волны и skill, без карт. */
  playerWeaponDps: number;
  totalEnemyHp: number;
  /** Входящий DPS по времени: сегменты «после подхода с спавна к дистанции стрельбы». */
  threatSegments: ThreatEngagementSegment[];
  vipMaxHp: number;
  supportCardLevels: Record<number, number>;
  combatPowerMultiplier: number;
  mg: WeaponLevelStats;
  hydra: WeaponLevelStats;
  hellfire: WeaponLevelStats;
  unlocked: { machineGun: boolean; hydra70: boolean; hellfire: boolean };
}

export interface ManaCombatResult {
  victory: boolean;
  timeToKillSec: number;
  vipHpEnd: number;
  /** Для UI: эквивалент стационарного входящего DPS по VIP в худший момент. */
  peakVipIncomingDps: number;
}

interface TimedBuff {
  until: number;
  value: number;
}

interface AllyPool {
  hp: number;
  hpMax: number;
  dps: number;
}

/**
 * Пошаговая модель волны: мана, перезарядки, эффект каждой карты по типу.
 * Союзники (десант, дроны, техника) имеют общий пул HP и DPS; пока HP > 0, часть угрозы идёт в них.
 */
export function simulateCombatWithManaAndSupport(p: ManaCombatParams): ManaCombatResult {
  const {
    constants,
    waveDurationSec,
    playerWeaponDps,
    totalEnemyHp,
    threatSegments,
    vipMaxHp,
    supportCardLevels,
    combatPowerMultiplier,
    mg,
    hydra,
    hellfire,
    unlocked,
  } = p;

  const mult = Math.max(0.01, combatPowerMultiplier);

  let enemyHp = Math.max(0, totalEnemyHp);
  let vipHp = vipMaxHp;
  let mana = 0;
  let ally: AllyPool = { hp: 0, hpMax: 0, dps: 0 };

  const readyAt: Record<number, number> = {};
  const empBuffs: TimedBuff[] = [];
  const reflectBuffs: TimedBuff[] = [];
  let repairUntil = 0;
  let repairHps = 0;

  let peakVipIncoming = 0;
  let t = 0;
  let timeKill: number | null = null;

  const tryPlayCards = () => {
    const cards = [...constants.supportCards].sort((a, b) => a.id - b.id);
    let played = true;
    while (played) {
      played = false;
      for (const card of cards) {
        const lvl = supportCardLevels[card.id] ?? 0;
        if (lvl <= 0) continue;
        if (t < (readyAt[card.id] ?? 0)) continue;
        const row = getRowForCardLevel(card, lvl);
        if (!row) continue;
        const cost = manaCost(row);
        if (mana + 1e-6 < cost) continue;
        const cd = cooldownSec(row);

        mana -= cost;
        readyAt[card.id] = t + cd;
        played = true;

        const v1 = p1(row, card);
        const v2 = p2(row, card);

        switch (card.type) {
          case 'spell': {
            if (card.id === 2) {
              const mines = Math.max(0, Math.round(v1));
              const dmg = Math.max(0, v2);
              enemyHp -= mines * dmg;
            } else if (card.id === 12) {
              const dur = Math.max(0.1, v1);
              const pct = Math.max(0, v2);
              empBuffs.push({ until: t + dur, value: pct / 100 });
            } else if (card.id === 15) {
              const n = Math.max(0, Math.round(v1));
              const dmg = Math.max(0, v2);
              enemyHp -= n * dmg;
            }
            break;
          }
          case 'defence': {
            if (card.id === 14) {
              const dur = Math.max(0.1, v1);
              const pct = Math.max(0, Math.min(95, v2));
              reflectBuffs.push({ until: t + dur, value: pct / 100 });
            }
            break;
          }
          case 'support': {
            if (card.id === 13) {
              repairHps = Math.max(0, v1);
              repairUntil = t + Math.max(0.1, v2);
            }
            break;
          }
          case 'resource': {
            if (card.id === 10 && unlocked.machineGun) {
              enemyHp -= Math.max(0, v1) * mg.damagePerShot;
            } else if (card.id === 8 && unlocked.hydra70) {
              enemyHp -= Math.max(0, v1) * hydra.damagePerShot;
            } else if (card.id === 9 && unlocked.hellfire) {
              enemyHp -= Math.max(0, v1) * hellfire.damagePerShot;
            }
            break;
          }
          case 'summon': {
            let addHp = 0;
            let addDps = 0;
            const count = Math.max(0, Math.round(v1));
            const lv = Math.max(1, Math.round(v2 || 1));

            if (card.id === 7) {
              const inf = constants.enemies.infantry;
              const sc = levelScale(lv);
              addHp = count * inf.baseHp * sc;
              addDps =
                count *
                inf.baseDamage *
                ((inf.baseFireRatePerMin ?? 60) / 60) *
                sc;
            } else if (card.id === 16) {
              const u = constants.enemies.rpgInfantry;
              if (u) {
                const sc = levelScale(lv);
                addHp = count * u.baseHp * sc;
                addDps =
                  count *
                  u.baseDamage *
                  ((u.baseFireRatePerMin ?? 60) / 60) *
                  sc;
              }
            } else if (card.id === 4) {
              const u = constants.enemies.jeep;
              const sc = levelScale(lv);
              addHp = count * u.baseHp * sc;
              addDps =
                count * u.baseDamage * ((u.baseFireRatePerMin ?? 60) / 60) * sc;
            } else if (card.id === 5) {
              const u = constants.enemies.apc;
              const sc = levelScale(lv);
              addHp = count * u.baseHp * sc;
              addDps =
                count * u.baseDamage * ((u.baseFireRatePerMin ?? 60) / 60) * sc;
            } else if (card.id === 6) {
              const u = constants.enemies.heavyTank;
              const sc = levelScale(lv);
              addHp = count * u.baseHp * sc;
              addDps =
                count * u.baseDamage * ((u.baseFireRatePerMin ?? 60) / 60) * sc;
            } else if (card.id === 3) {
              addHp = Math.max(0, v1);
              addDps = Math.max(0, v2) * 1.2;
            } else if (card.id === 1) {
              const perHp = 18 + lv * 2;
              const perDps = Math.max(0, v2);
              addHp = count * perHp;
              addDps = count * perDps;
            } else if (card.id === 11) {
              const rockets = Math.max(0, Math.round(v1));
              const dmg = Math.max(0, v2);
              enemyHp -= rockets * dmg;
            }
            if (addHp > 0 || addDps > 0) {
              ally.hpMax += addHp;
              ally.hp += addHp;
              ally.dps += addDps;
            }
            break;
          }
          default: {
            if (v1 > 0) enemyHp -= Math.max(0, v1) * 2;
            break;
          }
        }
      }
    }
  };

  while (t < waveDurationSec + SIM_DT && enemyHp > 0 && vipHp > 0) {
    mana += MANA_PER_SECOND * SIM_DT;
    tryPlayCards();

    const empMult =
      1 + empBuffs.filter((b) => t <= b.until).reduce((s, b) => s + b.value, 0);
    const reflect =
      reflectBuffs.filter((b) => t <= b.until).reduce((m, b) => Math.max(m, b.value), 0);

    const playerOut = playerWeaponDps * mult * empMult;
    enemyHp -= playerOut * SIM_DT;

    const allyFrac = ally.hpMax > 0 ? Math.max(0, Math.min(1, ally.hp / ally.hpMax)) : 0;
    const allyDpsNow = ally.dps * allyFrac;
    enemyHp -= allyDpsNow * SIM_DT;

    if (enemyHp <= 0) {
      if (timeKill == null) timeKill = t + SIM_DT;
      break;
    }

    const E = activeIncomingThreatDps(threatSegments, t);
    const hasAllies = ally.hp > 0;
    const toAllies = hasAllies ? E * ALLY_THREAT_SHARE : 0;
    const toVipBase = hasAllies ? E * VIP_THREAT_SHARE : E;
    const toVip = (toVipBase * (1 - reflect)) / mult;

    peakVipIncoming = Math.max(peakVipIncoming, toVip);

    if (ally.hp > 0) {
      ally.hp = Math.max(0, ally.hp - toAllies * SIM_DT);
    }

    if (t <= repairUntil && repairHps > 0) {
      vipHp = Math.min(vipMaxHp, vipHp + repairHps * SIM_DT);
    }

    vipHp -= toVip * SIM_DT;

    t += SIM_DT;

    if (vipHp <= 0) break;
  }

  if (enemyHp <= 0 && timeKill == null) timeKill = t;
  const victory =
    enemyHp <= 0 && vipHp > 0 && (timeKill != null ? timeKill <= waveDurationSec : false);

  return {
    victory,
    timeToKillSec: timeKill ?? Number.POSITIVE_INFINITY,
    vipHpEnd: vipHp,
    peakVipIncomingDps: peakVipIncoming,
  };
}
