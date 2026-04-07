import type { BalanceConstants, SupportCardConfig, SupportCardManualLevel } from './model';
import type { ThreatEngagementSegment, ThreatReachBurst, WeaponLevelStats } from './schema';
import { parseSupportCardBattleRow, type ParsedSupportCardBattleRow } from './supportCardRowSemantics';

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

/**
 * Урон в секунду из урона за попадание и колонки скорострельности.
 * ≤20 — считаем выстрелы/сек; иначе — выстр./мин (RPM).
 */
function dpsFromShotDamageAndFireColumn(dmgPerShot: number, fireCol: number, fallbackRpm: number): number {
  if (dmgPerShot <= 0) return 0;
  if (fireCol <= 1e-6) return dmgPerShot * (fallbackRpm / 60);
  if (fireCol <= 20) return dmgPerShot * fireCol;
  return dmgPerShot * (fireCol / 60);
}

/** Множители от скорости/дальности/радиуса для союзников на поле. */
function allyStatMultipliers(st: {
  speed: number;
  attackRange: number;
  fireRate: number;
  blastRadius: number;
}): { hpMult: number; dpsMult: number } {
  let hpM = 1;
  let dpsM = 1;
  if (st.speed > 0) {
    dpsM *= 1 + Math.min(0.35, st.speed / 200);
    hpM *= 1 + Math.min(0.22, st.speed / 260);
  }
  if (st.attackRange > 0) {
    dpsM *= 1 + Math.min(0.28, st.attackRange / 420);
    hpM *= 1 + Math.min(0.18, st.attackRange / 550);
  }
  if (st.blastRadius > 0) {
    dpsM *= 1 + Math.min(0.38, st.blastRadius / 16);
  }
  return { hpMult: hpM, dpsMult: dpsM };
}

function allyStatMultipliersFromParsed(p: ParsedSupportCardBattleRow): { hpMult: number; dpsMult: number } {
  return allyStatMultipliers({
    speed: p.speed,
    attackRange: p.attackRange,
    fireRate: p.fireRate,
    blastRadius: p.blastRadius,
  });
}

function spellBlastMultiplier(blastRadius: number): number {
  if (blastRadius <= 0) return 1;
  return 1 + Math.min(0.55, blastRadius / 12);
}

function levelScale(level: number): number {
  return 1 + 0.12 * Math.max(0, level - 1);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export interface ManaCombatParams {
  constants: BalanceConstants;
  waveDurationSec: number;
  /** Устойчивый DPS стволов с модификаторами по составу волны и skill, без карт. */
  playerWeaponDps: number;
  totalEnemyHp: number;
  /** Входящий DPS по времени: сегменты «после подхода с спавна к дистанции стрельбы». */
  threatSegments: ThreatEngagementSegment[];
  /** Разовый урон при подъезде (камикадзе); не использует скорострельность. */
  reachBursts?: ThreatReachBurst[];
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
    reachBursts = [],
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
  const reachBurstApplied = new Set<number>();
  const reachLeak = clamp01((constants.economy.combatSkill?.reachLeakPercent ?? 0) / 100);

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
        const parsed = parseSupportCardBattleRow(row, card);
        const allyM = allyStatMultipliersFromParsed(parsed);

        switch (card.type) {
          case 'spell': {
            if (card.id === 2) {
              const mines = Math.max(0, Math.round(parsed.count > 0 ? parsed.count : v1));
              const dmg = Math.max(0, parsed.damagePerHit > 0 ? parsed.damagePerHit : v2);
              const blast = spellBlastMultiplier(parsed.blastRadius);
              const spd = parsed.speed > 0 ? 1 + Math.min(0.2, parsed.speed / 220) : 1;
              enemyHp -= mines * dmg * blast * spd;
            } else if (card.id === 12) {
              const dur = Math.max(
                0.1,
                (parsed.durationSec > 0 ? parsed.durationSec : v1) *
                  (parsed.attackRange > 0 ? 1 + Math.min(0.15, parsed.attackRange / 500) : 1)
              );
              const pct =
                Math.max(0, parsed.damageBonusPercent > 0 ? parsed.damageBonusPercent : v2) *
                (parsed.blastRadius > 0 ? 1 + Math.min(0.12, parsed.blastRadius / 40) : 1);
              empBuffs.push({ until: t + dur, value: pct / 100 });
            } else if (card.id === 15) {
              const n = Math.max(0, Math.round(parsed.count > 0 ? parsed.count : v1));
              const dmg = Math.max(0, parsed.damagePerHit > 0 ? parsed.damagePerHit : v2);
              enemyHp -= n * dmg * spellBlastMultiplier(parsed.blastRadius);
            }
            break;
          }
          case 'defence': {
            if (card.id === 14) {
              const dur = Math.max(
                0.1,
                (parsed.durationSec > 0 ? parsed.durationSec : v1) *
                  (parsed.speed > 0 ? 1 + Math.min(0.12, parsed.speed / 300) : 1)
              );
              const pctRaw = parsed.reflectPercent > 0 ? parsed.reflectPercent : v2;
              const pct = Math.max(0, Math.min(95, pctRaw * (parsed.blastRadius > 0 ? 1 + Math.min(0.1, parsed.blastRadius / 35) : 1)));
              reflectBuffs.push({ until: t + dur, value: pct / 100 });
            }
            break;
          }
          case 'support': {
            if (card.id === 13) {
              const spd = parsed.speed > 0 ? 1 + Math.min(0.18, parsed.speed / 180) : 1;
              const rng = parsed.attackRange > 0 ? 1 + Math.min(0.12, parsed.attackRange / 450) : 1;
              repairHps = Math.max(0, parsed.healPerSec > 0 ? parsed.healPerSec : v1) * spd * rng;
              repairUntil =
                t +
                Math.max(
                  0.1,
                  (parsed.durationSec > 0 ? parsed.durationSec : v2) *
                    (parsed.blastRadius > 0 ? 1 + Math.min(0.1, parsed.blastRadius / 50) : 1)
                );
            }
            break;
          }
          case 'resource': {
            const resMult =
              (parsed.speed > 0 ? 1 + Math.min(0.12, parsed.speed / 220) : 1) *
              (parsed.fireRate > 0 ? 1 + Math.min(0.14, parsed.fireRate / 90) : 1) *
              (parsed.attackRange > 0 ? 1 + Math.min(0.08, parsed.attackRange / 600) : 1) *
              (parsed.blastRadius > 0 ? 1 + Math.min(0.1, parsed.blastRadius / 45) : 1);
            const ammo = Math.max(0, parsed.count > 0 ? parsed.count : v1);
            if (card.id === 10 && unlocked.machineGun) {
              enemyHp -= ammo * mg.damagePerShot * resMult;
            } else if (card.id === 8 && unlocked.hydra70) {
              enemyHp -= ammo * hydra.damagePerShot * resMult;
            } else if (card.id === 9 && unlocked.hellfire) {
              enemyHp -= ammo * hellfire.damagePerShot * resMult;
            }
            break;
          }
          case 'summon': {
            let addHp = 0;
            let addDps = 0;
            const count = Math.max(0, Math.round(parsed.count > 0 ? parsed.count : v1));
            const lvLegacy = Math.max(1, Math.round(parsed.param2 > 0 ? parsed.param2 : v2 || 1));

            if (card.id === 7) {
              const inf = constants.enemies.infantry;
              const sc = levelScale(lvLegacy);
              const fbRpm = inf.baseFireRatePerMin ?? 60;
              if (parsed.allyHpTotal > 0) {
                addHp = parsed.allyHpTotal * allyM.hpMult;
              } else if (parsed.allyHpEach > 0 && count > 0) {
                addHp = count * parsed.allyHpEach * allyM.hpMult;
              } else {
                addHp = count * inf.baseHp * sc * allyM.hpMult;
              }
              const dmg =
                parsed.damagePerHit > 0 ? parsed.damagePerHit : inf.baseDamage * sc;
              const dpsPer = dpsFromShotDamageAndFireColumn(dmg, parsed.fireRate, fbRpm);
              addDps = count * dpsPer * allyM.dpsMult;
            } else if (card.id === 16) {
              const u = constants.enemies.rpgInfantry;
              if (u) {
                const fbRpm = u.baseFireRatePerMin ?? 60;
                const dmg =
                  parsed.damagePerHit > 0 ? parsed.damagePerHit : v2 > 1e-6 ? v2 : u.baseDamage;
                const hpScale = Math.min(2.2, Math.max(0.85, dmg / Math.max(1, u.baseDamage)));
                if (parsed.allyHpTotal > 0) {
                  addHp = parsed.allyHpTotal * allyM.hpMult;
                } else if (parsed.allyHpEach > 0 && count > 0) {
                  addHp = count * parsed.allyHpEach * allyM.hpMult;
                } else {
                  addHp = count * u.baseHp * hpScale * allyM.hpMult;
                }
                const dpsPer = dpsFromShotDamageAndFireColumn(dmg, parsed.fireRate, fbRpm);
                addDps = count * dpsPer * allyM.dpsMult;
              }
            } else if (card.id === 4) {
              const u = constants.enemies.jeep;
              const sc = levelScale(lvLegacy);
              const fbRpm = u.baseFireRatePerMin ?? 60;
              if (parsed.allyHpTotal > 0) addHp = parsed.allyHpTotal * allyM.hpMult;
              else if (parsed.allyHpEach > 0 && count > 0) addHp = count * parsed.allyHpEach * allyM.hpMult;
              else addHp = count * u.baseHp * sc * allyM.hpMult;
              const dmg = parsed.damagePerHit > 0 ? parsed.damagePerHit : u.baseDamage * sc;
              addDps = count * dpsFromShotDamageAndFireColumn(dmg, parsed.fireRate, fbRpm) * allyM.dpsMult;
            } else if (card.id === 5) {
              const u = constants.enemies.apc;
              const sc = levelScale(lvLegacy);
              const fbRpm = u.baseFireRatePerMin ?? 60;
              if (parsed.allyHpTotal > 0) addHp = parsed.allyHpTotal * allyM.hpMult;
              else if (parsed.allyHpEach > 0 && count > 0) addHp = count * parsed.allyHpEach * allyM.hpMult;
              else addHp = count * u.baseHp * sc * allyM.hpMult;
              const dmg = parsed.damagePerHit > 0 ? parsed.damagePerHit : u.baseDamage * sc;
              addDps = count * dpsFromShotDamageAndFireColumn(dmg, parsed.fireRate, fbRpm) * allyM.dpsMult;
            } else if (card.id === 6) {
              const u = constants.enemies.heavyTank;
              const sc = levelScale(lvLegacy);
              const fbRpm = u.baseFireRatePerMin ?? 60;
              if (parsed.allyHpTotal > 0) addHp = parsed.allyHpTotal * allyM.hpMult;
              else if (parsed.allyHpEach > 0 && count > 0) addHp = count * parsed.allyHpEach * allyM.hpMult;
              else addHp = count * u.baseHp * sc * allyM.hpMult;
              const dmg = parsed.damagePerHit > 0 ? parsed.damagePerHit : u.baseDamage * sc;
              addDps = count * dpsFromShotDamageAndFireColumn(dmg, parsed.fireRate, fbRpm) * allyM.dpsMult;
            } else if (card.id === 3) {
              const shot = Math.max(0, parsed.damagePerHit > 0 ? parsed.damagePerHit : v2) * 1.2;
              const dpsPer = dpsFromShotDamageAndFireColumn(shot, parsed.fireRate, 45);
              if (parsed.allyHpTotal > 0) addHp = parsed.allyHpTotal * allyM.hpMult;
              else if (parsed.allyHpEach > 0) addHp = parsed.allyHpEach * allyM.hpMult;
              else addHp = Math.max(0, v1) * allyM.hpMult;
              addDps = dpsPer * allyM.dpsMult;
            } else if (card.id === 1) {
              const dmg = Math.max(0, parsed.damagePerHit > 0 ? parsed.damagePerHit : v2);
              let perHp =
                parsed.allyHpEach > 0 ? parsed.allyHpEach : 18 + lvl * 2;
              if (parsed.allyHpTotal > 0 && count > 0) {
                perHp = parsed.allyHpTotal / count;
              }
              addHp = count * perHp * allyM.hpMult;
              addDps = count * dpsFromShotDamageAndFireColumn(dmg, parsed.fireRate, 60) * allyM.dpsMult;
            } else if (card.id === 11) {
              const rockets = Math.max(0, Math.round(parsed.count > 0 ? parsed.count : v1));
              const dmg = Math.max(0, parsed.damagePerHit > 0 ? parsed.damagePerHit : v2);
              enemyHp -= rockets * dmg * spellBlastMultiplier(parsed.blastRadius);
            }
            if (addHp > 0 || addDps > 0) {
              ally.hpMax += addHp;
              ally.hp += addHp;
              ally.dps += addDps;
            }
            break;
          }
          default: {
            if (v1 > 0) {
              const m =
                spellBlastMultiplier(parsed.blastRadius) *
                (parsed.speed > 0 ? 1 + Math.min(0.15, parsed.speed / 250) : 1);
              enemyHp -= Math.max(0, v1) * 2 * m;
            }
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

    for (let i = 0; i < reachBursts.length; i++) {
      if (reachBurstApplied.has(i)) continue;
      const b = reachBursts[i]!;
      if (b.atSec <= t + 1e-9) {
        reachBurstApplied.add(i);
        let dmg = b.damage;
        if (enemyHp <= 0) dmg *= reachLeak;
        const hasAllies = ally.hp > 0;
        const toAlliesBurst = hasAllies ? dmg * ALLY_THREAT_SHARE : 0;
        const toVipBurstBase = hasAllies ? dmg * VIP_THREAT_SHARE : dmg;
        const toVipBurst = (toVipBurstBase * (1 - reflect)) / mult;
        peakVipIncoming = Math.max(peakVipIncoming, toVipBurst / SIM_DT);
        if (ally.hp > 0) ally.hp = Math.max(0, ally.hp - toAlliesBurst);
        vipHp -= toVipBurst;
      }
    }
    if (vipHp <= 0) break;

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
