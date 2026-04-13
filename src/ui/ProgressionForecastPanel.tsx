import React, { useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from 'recharts';
import type { BalanceConstants } from '../balance/model';
import type { SegmentId } from '../progression/types';
import type { ReferenceWavesConfig } from '../balance/referenceWaves';
import { fullWeaponAndSupportUpgradePolicy } from '../progression/fullUpgradePolicy';
import { simulateProgressionForecast } from '../progression/progressionSimulator';
import { autoTuneReferenceWaves } from '../progression/autoTuneLevels';
import { effectiveEnergyRegenIntervalSec, resolveEnergyRegenPerHour } from '../progression/energyRegenForecast';
import { rocketWeaponLevelDisplay, showRocketLevelsInSummary } from '../progression/weaponLevelDisplay';

export type TuneMode = 'pass_rate' | 'attempt_range';
export type PresetKind = 'onboarding' | 'midcore' | 'hardcore';
export type SavedTunePreset = {
  mode: TuneMode;
  targets: Record<number, number>;
  ranges: Record<number, { min: number; max: number }>;
};
/** Резервная копия пресетов в браузере (читается при старте вместе с БД). */
const TUNE_PRESETS_BACKUP_STORAGE_KEY = 'war-drone-tune-presets-v1';

export type ForecastUiState = {
  maxAttemptsPerLevel: number;
  energyPerLevel: number;
  energyStart: number;
  energyPerAttempt: number;
  /** Секунд на 1 ед. энергии (бесплатник). Референс: 600. */
  energyRegenIntervalSec: number;
  /** Секунд на 1 ед. энергии (премиум/VIP: платящий, кит). Референс: 300. */
  energyRegenIntervalSecPremium: number;
  tuneTargets: Record<number, number>;
  tuneMode: TuneMode;
  selectedPreset: PresetKind;
  tuneAttemptRanges: Record<number, { min: number; max: number }>;
  presetName: string;
  savedPresets: Record<string, SavedTunePreset>;
  selectedSavedPreset: string;
  autoApplyOnLoadPreset: boolean;
  bulkPassFrom: number;
  bulkPassTo: number;
  bulkMinFrom: number;
  bulkMinTo: number;
  bulkMaxFrom: number;
  bulkMaxTo: number;
  fillDownFromLevel: number;
  fillDownPassValue: number;
  fillDownMinValue: number;
  fillDownMaxValue: number;
};

function sumObjectValues(obj: Record<string, number> | null | undefined): number {
  if (!obj) return 0;
  return Object.values(obj).reduce((sum, v) => sum + v, 0);
}

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
};

const tdStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.24)',
  padding: 4,
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  minWidth: 180,
};

export const ProgressionForecastPanel: React.FC<{
  balance: BalanceConstants;
  playerLevel: number;
  initialSoft?: number;
  referenceWavesConfig?: ReferenceWavesConfig;
  setReferenceWavesConfig?: React.Dispatch<React.SetStateAction<ReferenceWavesConfig>>;
  referenceWavesRevision?: number;
  activePresetName?: string;
  onActivePresetNameChange?: (name: string) => void;
  segmentId?: SegmentId;
  onSegmentIdChange?: (segment: SegmentId) => void;
  forecastUiState?: ForecastUiState;
  onForecastUiStateChange?: (state: ForecastUiState) => void;
  /** Чтобы менять meta прогноза прямо на этой вкладке (дублирует блок «Формулы»). */
  setBalance?: React.Dispatch<React.SetStateAction<BalanceConstants>>;
}> = ({
  balance,
  playerLevel,
  initialSoft,
  referenceWavesConfig,
  setReferenceWavesConfig,
  referenceWavesRevision = 0,
  activePresetName,
  onActivePresetNameChange,
  segmentId: segmentIdProp,
  onSegmentIdChange,
  forecastUiState,
  onForecastUiStateChange,
  setBalance,
}) => {
  const suppressNextEmitRef = useRef(false);
  type TuneDiagnosticsRow = {
    level: number;
    targetMin: number;
    targetMax: number;
    effectiveMin: number;
    effectiveMax: number;
    attemptsFact: number;
    passed: boolean;
    inRange: boolean;
    reachableByDefinition: boolean;
    hasUnits: boolean;
    accuracyPercent: number | null;
  };

  const getAccuracyColor = (accuracy: number | null): string => {
    if (accuracy == null) return '#94a3b8';
    const clamped = Math.max(0, Math.min(100, accuracy));
    const hue = (clamped / 100) * 120; // 0=red, 120=green
    return `hsl(${hue}, 85%, 52%)`;
  };

  const computeAccuracyPercent = (
    hasUnits: boolean,
    passed: boolean,
    attempts: number,
    min: number,
    max: number
  ): number | null => {
    if (!hasUnits) return null;
    if (!passed) return 0;
    if (attempts >= min && attempts <= max) {
      const center = (min + max) / 2;
      const half = Math.max(1, (max - min) / 2);
      const dist = Math.abs(attempts - center);
      const inside = Math.max(0, 1 - dist / half);
      return 90 + inside * 10;
    }
    const deviation = attempts < min ? min - attempts : attempts - max;
    return Math.max(0, 90 - deviation * 18);
  };

  const [segmentIdInternal, setSegmentIdInternal] = useState<SegmentId>('free');
  const segmentId = segmentIdProp ?? segmentIdInternal;
  const setSegmentId = (segment: SegmentId) => {
    if (onSegmentIdChange) onSegmentIdChange(segment);
    else setSegmentIdInternal(segment);
  };
  const [maxAttemptsPerLevel, setMaxAttemptsPerLevel] = useState<number>(forecastUiState?.maxAttemptsPerLevel ?? 200);
  const [energyPerLevel, setEnergyPerLevel] = useState<number>(forecastUiState?.energyPerLevel ?? 100);
  const [energyStart, setEnergyStart] = useState<number>(forecastUiState?.energyStart ?? 100);
  const [energyPerAttempt, setEnergyPerAttempt] = useState<number>(forecastUiState?.energyPerAttempt ?? 1);
  const [energyRegenIntervalSec, setEnergyRegenIntervalSec] = useState<number>(
    forecastUiState?.energyRegenIntervalSec ?? 600
  );
  const [energyRegenIntervalSecPremium, setEnergyRegenIntervalSecPremium] = useState<number>(
    forecastUiState?.energyRegenIntervalSecPremium ?? 300
  );
  const [tuneTargets, setTuneTargets] = useState<Record<number, number>>(() => {
    if (forecastUiState?.tuneTargets) return forecastUiState.tuneTargets;
    const out: Record<number, number> = {};
    for (let level = 1; level <= 15; level += 1) {
      if (level <= 3) out[level] = 100;
      else out[level] = Math.max(25, 100 - (level - 3) * 6);
    }
    return out;
  });
  const [tuneMode, setTuneMode] = useState<TuneMode>(forecastUiState?.tuneMode ?? 'pass_rate');
  const [selectedPreset, setSelectedPreset] = useState<PresetKind>(forecastUiState?.selectedPreset ?? 'onboarding');
  const [tuneAttemptRanges, setTuneAttemptRanges] = useState<Record<number, { min: number; max: number }>>(() => {
    if (forecastUiState?.tuneAttemptRanges) return forecastUiState.tuneAttemptRanges;
    const out: Record<number, { min: number; max: number }> = {};
    for (let level = 1; level <= 15; level += 1) {
      if (level <= 3) out[level] = { min: 2, max: 2 };
      else out[level] = { min: 3 + (level - 4), max: 5 + (level - 4) * 2 };
    }
    return out;
  });
  const [tuneStatus, setTuneStatus] = useState<string>('');
  const [tuneDiagnostics, setTuneDiagnostics] = useState<TuneDiagnosticsRow[]>([]);
  const [presetName, setPresetName] = useState<string>(forecastUiState?.presetName ?? 'Мой пресет');
  const [savedPresets, setSavedPresets] = useState<Record<string, SavedTunePreset>>(forecastUiState?.savedPresets ?? {});
  const [selectedSavedPreset, setSelectedSavedPreset] = useState<string>(forecastUiState?.selectedSavedPreset ?? activePresetName ?? '');
  const [autoApplyOnLoadPreset, setAutoApplyOnLoadPreset] = useState<boolean>(forecastUiState?.autoApplyOnLoadPreset ?? true);
  const setAutoApplyAndPersist = (value: boolean) => {
    setAutoApplyOnLoadPreset(value);
  };
  const [bulkPassFrom, setBulkPassFrom] = useState<number>(forecastUiState?.bulkPassFrom ?? 100);
  const [bulkPassTo, setBulkPassTo] = useState<number>(forecastUiState?.bulkPassTo ?? 25);
  const [bulkMinFrom, setBulkMinFrom] = useState<number>(forecastUiState?.bulkMinFrom ?? 2);
  const [bulkMinTo, setBulkMinTo] = useState<number>(forecastUiState?.bulkMinTo ?? 10);
  const [bulkMaxFrom, setBulkMaxFrom] = useState<number>(forecastUiState?.bulkMaxFrom ?? 2);
  const [bulkMaxTo, setBulkMaxTo] = useState<number>(forecastUiState?.bulkMaxTo ?? 25);
  const [fillDownFromLevel, setFillDownFromLevel] = useState<number>(forecastUiState?.fillDownFromLevel ?? 1);
  const [fillDownPassValue, setFillDownPassValue] = useState<number>(forecastUiState?.fillDownPassValue ?? 100);
  const [fillDownMinValue, setFillDownMinValue] = useState<number>(forecastUiState?.fillDownMinValue ?? 2);
  const [fillDownMaxValue, setFillDownMaxValue] = useState<number>(forecastUiState?.fillDownMaxValue ?? 2);
  const [attemptPowerFrom, setAttemptPowerFrom] = useState<number>(1);
  const [attemptPowerTo, setAttemptPowerTo] = useState<number>(999999);
  const [attemptPowerYMin, setAttemptPowerYMin] = useState<number>(0);
  const [attemptPowerYMax, setAttemptPowerYMax] = useState<number>(0);

  React.useEffect(() => {
    if (activePresetName != null) setSelectedSavedPreset(activePresetName);
  }, [activePresetName]);
  React.useEffect(() => {
    if (!forecastUiState) return;
    suppressNextEmitRef.current = true;
    setMaxAttemptsPerLevel(forecastUiState.maxAttemptsPerLevel ?? 200);
    setEnergyPerLevel(forecastUiState.energyPerLevel ?? 100);
    setEnergyStart(forecastUiState.energyStart ?? 100);
    setEnergyPerAttempt(forecastUiState.energyPerAttempt ?? 1);
    setEnergyRegenIntervalSec(forecastUiState.energyRegenIntervalSec ?? 600);
    setEnergyRegenIntervalSecPremium(forecastUiState.energyRegenIntervalSecPremium ?? 300);
    setTuneTargets(forecastUiState.tuneTargets ?? {});
    setTuneMode(forecastUiState.tuneMode ?? 'pass_rate');
    setSelectedPreset(forecastUiState.selectedPreset ?? 'onboarding');
    setTuneAttemptRanges(forecastUiState.tuneAttemptRanges ?? {});
    setPresetName(forecastUiState.presetName ?? 'Мой пресет');
    setSavedPresets(forecastUiState.savedPresets ?? {});
    setSelectedSavedPreset(forecastUiState.selectedSavedPreset ?? '');
    setAutoApplyOnLoadPreset(forecastUiState.autoApplyOnLoadPreset ?? true);
    setBulkPassFrom(forecastUiState.bulkPassFrom ?? 100);
    setBulkPassTo(forecastUiState.bulkPassTo ?? 25);
    setBulkMinFrom(forecastUiState.bulkMinFrom ?? 2);
    setBulkMinTo(forecastUiState.bulkMinTo ?? 10);
    setBulkMaxFrom(forecastUiState.bulkMaxFrom ?? 2);
    setBulkMaxTo(forecastUiState.bulkMaxTo ?? 25);
    setFillDownFromLevel(forecastUiState.fillDownFromLevel ?? 1);
    setFillDownPassValue(forecastUiState.fillDownPassValue ?? 100);
    setFillDownMinValue(forecastUiState.fillDownMinValue ?? 2);
    setFillDownMaxValue(forecastUiState.fillDownMaxValue ?? 2);
  }, [forecastUiState]);
  React.useEffect(() => {
    if (suppressNextEmitRef.current) {
      suppressNextEmitRef.current = false;
      return;
    }
    onForecastUiStateChange?.({
      maxAttemptsPerLevel,
      energyPerLevel,
      energyStart,
      energyPerAttempt,
      energyRegenIntervalSec,
      energyRegenIntervalSecPremium,
      tuneTargets,
      tuneMode,
      selectedPreset,
      tuneAttemptRanges,
      presetName,
      savedPresets,
      selectedSavedPreset,
      autoApplyOnLoadPreset,
      bulkPassFrom,
      bulkPassTo,
      bulkMinFrom,
      bulkMinTo,
      bulkMaxFrom,
      bulkMaxTo,
      fillDownFromLevel,
      fillDownPassValue,
      fillDownMinValue,
      fillDownMaxValue,
    });
  }, [
    onForecastUiStateChange,
    maxAttemptsPerLevel,
    energyPerLevel,
    energyStart,
    energyPerAttempt,
    energyRegenIntervalSec,
    energyRegenIntervalSecPremium,
    tuneTargets,
    tuneMode,
    selectedPreset,
    tuneAttemptRanges,
    presetName,
    savedPresets,
    selectedSavedPreset,
    autoApplyOnLoadPreset,
    bulkPassFrom,
    bulkPassTo,
    bulkMinFrom,
    bulkMinTo,
    bulkMaxFrom,
    bulkMaxTo,
    fillDownFromLevel,
    fillDownPassValue,
    fillDownMinValue,
    fillDownMaxValue,
  ]);

  const applyPreset = (preset: 'onboarding' | 'midcore' | 'hardcore') => {
    setSelectedPreset(preset);
    const levels = balance.meta.gameLevels;

    if (tuneMode === 'pass_rate') {
      const next: Record<number, number> = {};
      for (let level = 1; level <= levels; level += 1) {
        if (preset === 'onboarding') {
          if (level <= 3) next[level] = 100;
          else next[level] = Math.max(20, 95 - (level - 3) * 7);
        } else if (preset === 'midcore') {
          if (level <= 2) next[level] = 100;
          else next[level] = Math.max(15, 88 - (level - 2) * 8);
        } else {
          if (level <= 1) next[level] = 100;
          else next[level] = Math.max(8, 75 - (level - 1) * 9);
        }
      }
      setTuneTargets(next);
      setTuneStatus('Пресет применён к целям % прохождения.');
      return;
    }

    const nextRanges: Record<number, { min: number; max: number }> = {};
    for (let level = 1; level <= levels; level += 1) {
      if (preset === 'onboarding') {
        if (level <= 3) nextRanges[level] = { min: 2, max: 2 };
        else nextRanges[level] = { min: 3 + (level - 4), max: 6 + (level - 4) * 2 };
      } else if (preset === 'midcore') {
        if (level <= 2) nextRanges[level] = { min: 2, max: 3 };
        else nextRanges[level] = { min: 4 + (level - 3), max: 8 + (level - 3) * 2 };
      } else {
        if (level <= 1) nextRanges[level] = { min: 3, max: 4 };
        else nextRanges[level] = { min: 6 + (level - 2), max: 10 + (level - 2) * 2 };
      }
    }
    setTuneAttemptRanges(nextRanges);
    setTuneStatus('Пресет применён к диапазонам попыток.');
  };

  const persistSavedPresets = (next: typeof savedPresets) => {
    setSavedPresets(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TUNE_PRESETS_BACKUP_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // ignore quota / privacy mode
    }
  };

  const saveCurrentPreset = () => {
    const name = presetName.trim();
    if (!name) {
      setTuneStatus('Введите название пресета.');
      return;
    }
    const next = {
      ...savedPresets,
      [name]: {
        mode: tuneMode,
        targets: tuneTargets,
        ranges: tuneAttemptRanges,
      },
    };
    persistSavedPresets(next);
    setSelectedSavedPreset(name);
    onActivePresetNameChange?.(name);
    setTuneStatus(`Пресет "${name}" сохранён.`);
  };

  const loadSavedPreset = () => {
    const name = selectedSavedPreset;
    if (!name) return;
    const preset = savedPresets[name];
    if (!preset) {
      setTuneStatus('Пресет не найден.');
      return;
    }
    setTuneMode(preset.mode);
    setTuneTargets(preset.targets);
    setTuneAttemptRanges(preset.ranges);
    setPresetName(name);
    onActivePresetNameChange?.(name);
    if (autoApplyOnLoadPreset) {
      handleAutoTune({
        mode: preset.mode,
        targetsByLevel: preset.targets,
        attemptRangesByLevel: preset.ranges,
      });
      return;
    }
    setTuneStatus(`Пресет "${name}" загружен в цели.`);
  };

  const deleteSavedPreset = () => {
    const name = selectedSavedPreset;
    if (!name) return;
    if (!savedPresets[name]) return;
    const next = { ...savedPresets };
    delete next[name];
    persistSavedPresets(next);
    setSelectedSavedPreset('');
    onActivePresetNameChange?.('');
    setTuneStatus(`Пресет "${name}" удалён.`);
  };

  const applyBulkFill = () => {
    const levels = balance.meta.gameLevels;
    if (levels <= 1) return;
    if (tuneMode === 'pass_rate') {
      const next: Record<number, number> = {};
      for (let level = 1; level <= levels; level += 1) {
        const t = (level - 1) / (levels - 1);
        const value = bulkPassFrom + (bulkPassTo - bulkPassFrom) * t;
        next[level] = Math.max(0, Math.min(100, Math.round(value)));
      }
      setTuneTargets(next);
      setTuneStatus('Массовое заполнение целей % применено.');
      return;
    }

    const ranges: Record<number, { min: number; max: number }> = {};
    for (let level = 1; level <= levels; level += 1) {
      const t = (level - 1) / (levels - 1);
      const minV = Math.max(1, Math.round(bulkMinFrom + (bulkMinTo - bulkMinFrom) * t));
      const maxV = Math.max(minV, Math.round(bulkMaxFrom + (bulkMaxTo - bulkMaxFrom) * t));
      ranges[level] = { min: minV, max: maxV };
    }
    setTuneAttemptRanges(ranges);
    setTuneStatus('Массовое заполнение диапазонов попыток применено.');
  };

  const fillDownFromCurrentLevelValues = () => {
    const level = Math.max(1, Math.min(balance.meta.gameLevels, fillDownFromLevel));
    if (tuneMode === 'pass_rate') {
      const value = Math.max(0, Math.min(100, tuneTargets[level] ?? 0));
      setFillDownPassValue(value);
      const next = { ...tuneTargets };
      for (let l = level; l <= balance.meta.gameLevels; l += 1) next[l] = value;
      setTuneTargets(next);
      setTuneStatus(`Значение ${value}% протянуто с уровня ${level} до конца.`);
      return;
    }
    const range = tuneAttemptRanges[level] ?? { min: 2, max: 6 };
    const min = Math.max(1, range.min);
    const max = Math.max(min, range.max);
    setFillDownMinValue(min);
    setFillDownMaxValue(max);
    const next = { ...tuneAttemptRanges };
    for (let l = level; l <= balance.meta.gameLevels; l += 1) next[l] = { min, max };
    setTuneAttemptRanges(next);
    setTuneStatus(`Диапазон ${min}-${max} протянут с уровня ${level} до конца.`);
  };

  const applyFillDownManual = () => {
    const level = Math.max(1, Math.min(balance.meta.gameLevels, fillDownFromLevel));
    if (tuneMode === 'pass_rate') {
      const value = Math.max(0, Math.min(100, fillDownPassValue));
      const next = { ...tuneTargets };
      for (let l = level; l <= balance.meta.gameLevels; l += 1) next[l] = value;
      setTuneTargets(next);
      setTuneStatus(`Значение ${value}% протянуто с уровня ${level} до конца.`);
      return;
    }
    const min = Math.max(1, fillDownMinValue);
    const max = Math.max(min, fillDownMaxValue);
    const next = { ...tuneAttemptRanges };
    for (let l = level; l <= balance.meta.gameLevels; l += 1) next[l] = { min, max };
    setTuneAttemptRanges(next);
    setTuneStatus(`Диапазон ${min}-${max} протянут с уровня ${level} до конца.`);
  };

  const applySavedPresetAndAutoTune = () => {
    const name = selectedSavedPreset;
    if (!name) {
      setTuneStatus('Сначала выберите сохранённый пресет.');
      return;
    }
    const preset = savedPresets[name];
    if (!preset) {
      setTuneStatus('Сохранённый пресет не найден.');
      return;
    }
    setTuneMode(preset.mode);
    setTuneTargets(preset.targets);
    setTuneAttemptRanges(preset.ranges);
    setPresetName(name);
    handleAutoTune({
      mode: preset.mode,
      targetsByLevel: preset.targets,
      attemptRangesByLevel: preset.ranges,
    });
  };

  const segmentLabelById: Record<SegmentId, string> = {
    free: 'Бесплатник',
    payer: 'Платящий',
    whale: 'Кит',
  };

  const weaponLabel = {
    machineGun: balance.weapons.machineGun.displayName,
    hydra70: balance.weapons.hydra70.displayName,
    hellfire: balance.weapons.hellfire.displayName,
  };

  const cardNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of balance.supportCards) map.set(c.id, c.name);
    return map;
  }, [balance]);

  const computedInitialSoft = useMemo(() => {
    if (initialSoft != null) return initialSoft;
    return 0;
  }, [initialSoft]);

  const activeEnergyRegenIntervalSec = useMemo(
    () =>
      effectiveEnergyRegenIntervalSec({
        segmentId,
        energyRegenIntervalSec,
        energyRegenIntervalSecPremium,
      }),
    [segmentId, energyRegenIntervalSec, energyRegenIntervalSecPremium]
  );

  const energyRegenPerHourForSegment = useMemo(
    () =>
      resolveEnergyRegenPerHour({
        segmentId,
        energyRegenIntervalSec,
        energyRegenIntervalSecPremium,
      }),
    [segmentId, energyRegenIntervalSec, energyRegenIntervalSecPremium]
  );

  const forecast = useMemo(() => {
    return simulateProgressionForecast(balance, {
      segmentId,
      playerLevel,
      initialSoft: computedInitialSoft,
      maxAttemptsPerLevel,
      energyPerLevel,
      energyPerAttempt,
      energyStart,
      energyRegenIntervalSec,
      energyRegenIntervalSecPremium,
      upgradePolicy: fullWeaponAndSupportUpgradePolicy,
      referenceWavesConfig,
    });
  }, [
    balance,
    segmentId,
    playerLevel,
    computedInitialSoft,
    referenceWavesConfig,
    referenceWavesRevision,
    maxAttemptsPerLevel,
    energyPerLevel,
    energyPerAttempt,
    energyStart,
    energyRegenIntervalSec,
    energyRegenIntervalSecPremium,
  ]);

  const topSupportCards = useMemo(() => {
    const items = Object.entries(forecast.finalState.supportCardLevels)
      .map(([idStr, lvl]) => ({ id: Number(idStr), lvl }))
      .filter((x) => Number.isFinite(x.lvl) && x.lvl > 0)
      .sort((a, b) => b.lvl - a.lvl)
      .slice(0, 5);
    return items;
  }, [forecast.finalState.supportCardLevels]);

  const topSupportCardsText = useMemo(() => {
    return topSupportCards
      .map((c) => `${cardNameById.get(c.id) ?? `#${c.id}`} (lvl ${c.lvl})`)
      .join('; ');
  }, [topSupportCards, cardNameById]);

  const supportProgressRows = useMemo(() => {
    return balance.supportCards
      .map((card) => ({
        id: card.id,
        name: card.name,
        level: forecast.finalState.supportCardLevels[card.id] ?? 0,
        blueprints: forecast.finalState.supportCardBlueprints[card.id] ?? 0,
      }))
      .filter((r) => r.level > 0 || r.blueprints > 0)
      .sort((a, b) => b.level - a.level || b.blueprints - a.blueprints);
  }, [balance.supportCards, forecast.finalState.supportCardLevels, forecast.finalState.supportCardBlueprints]);

  const chestOpenSummary = useMemo(() => {
    const freeMap = forecast.expectedFreeChestOpensById ?? {};
    const paidMap = forecast.expectedPaidChestOpensById ?? {};
    const freeChests = balance.economy.freeChests ?? [];
    const freeRows = Object.entries(freeMap)
      .filter(([, n]) => n > 0.0005)
      .map(([id, count]) => ({
        id,
        name: freeChests.find((c) => c.id === id)?.name ?? id,
        count,
      }))
      .sort((a, b) => b.count - a.count);
    const paidRows = Object.entries(paidMap)
      .filter(([, n]) => n > 0.0005)
      .map(([id, count]) => ({ id, name: id, count }))
      .sort((a, b) => b.count - a.count);
    const freeOpensSum = freeRows.reduce((s, r) => s + r.count, 0);
    const configuredFreeChestCount = (balance.economy.freeChests ?? []).length;
    return {
      freeRows,
      paidRows,
      waitHoursTotal: forecast.progressionElapsedHours ?? 0,
      calendarHoursTotal: forecast.progressionElapsedCalendarHours ?? 0,
      freeOpensSum,
      configuredFreeChestCount,
      freeKeyForecast: forecast.freeChestKeyForecast ?? null,
    };
  }, [
    forecast.expectedFreeChestOpensById,
    forecast.expectedPaidChestOpensById,
    forecast.progressionElapsedHours,
    forecast.progressionElapsedCalendarHours,
    forecast.freeChestKeyForecast,
    balance.economy.freeChests,
  ]);

  const finalSoftBalance = forecast.finalState.softBalance;
  const finalWeaponLevels = forecast.finalState.weaponLevels;
  const finalWeaponUpgradeSoftSpent = forecast.finalState.lifetimeWeaponUpgradeSoftSpent ?? 0;
  const maxSimulatedGameLevel = useMemo(
    () => forecast.levels.reduce((m, r) => Math.max(m, r.levelIndex), 0),
    [forecast.levels]
  );
  const showRocketSummary = showRocketLevelsInSummary(maxSimulatedGameLevel);
  const passedLevelsCount = forecast.levels.filter((l) => l.passed).length;
  const totalLevels = balance.meta.gameLevels;
  const maxDayReachedInForecast = useMemo(
    () => forecast.levels.reduce((m, r) => Math.max(m, r.dayReached ?? 0), 0),
    [forecast.levels]
  );

  const tableRows = useMemo(() => {
    return forecast.levels
      .map((row) => {
        const unitsTotal = sumObjectValues(row.unitsByEnemyId as unknown as Record<string, number>);
        return {
          level: row.levelIndex,
          passed: row.passed,
          winRatePercent: row.passed ? 100 : 0,
          unitsTotal,
          unitsRawSumFromEditor: row.unitsRawSumFromEditor,
          totalEnemyHpScaled: row.totalEnemyHpScaled,
          totalEnemyLevelPowerScaled: row.totalEnemyLevelPowerScaled,
          attemptsTotal: row.attemptsTotal,
          avgRewardPerAttempt: row.avgRewardPerAttempt,
          totalRewardSoft: row.totalRewardSoft,
          endingSoftBalance: row.endingSoftBalance,
          weaponUpgradeSoftSpentOnLevel: row.weaponUpgradeSoftSpentOnLevel,
          weaponUpgradeSoftSpentCumulative: row.weaponUpgradeSoftSpentCumulative,
          rocketUnlockSoftSpentOnLevel: row.rocketUnlockSoftSpentOnLevel ?? 0,
          rocketUnlockSoftSpentCumulative: row.rocketUnlockSoftSpentCumulative ?? 0,
          deckSlotsSoftSpentOnLevel: row.deckSlotsSoftSpentOnLevel ?? 0,
          deckSlotsSoftSpentCumulative: row.deckSlotsSoftSpentCumulative ?? 0,
          dayReached: row.dayReached,
          mg: row.finalWeaponLevels.machineGunLevel,
          hydra: row.finalWeaponLevels.hydraLevel,
          hellfire: row.finalWeaponLevels.hellfireLevel,
        };
      })
      ;
  }, [forecast.levels]);

  const handleAutoTune = (
    override?: {
      mode?: 'pass_rate' | 'attempt_range';
      targetsByLevel?: Record<number, number>;
      attemptRangesByLevel?: Record<number, { min: number; max: number }>;
    },
  ) => {
    if (!referenceWavesConfig || !setReferenceWavesConfig) {
      setTuneStatus('Автоподбор недоступен: нет конфигурации волн.');
      return;
    }
    const effectiveMode = override?.mode ?? tuneMode;
    const effectiveTargets = override?.targetsByLevel ?? tuneTargets;
    const effectiveRanges = override?.attemptRangesByLevel ?? tuneAttemptRanges;
    const normalizedRanges = effectiveRanges;
    const result = autoTuneReferenceWaves(balance, referenceWavesConfig, {
      segmentId,
      playerLevel,
      initialSoft: computedInitialSoft,
      maxAttemptsPerLevel,
      energyPerLevel,
      energyPerAttempt,
      energyStart,
      energyRegenIntervalSec,
      energyRegenIntervalSecPremium,
      mode: effectiveMode,
      targetsByLevel: effectiveTargets,
      attemptRangesByLevel: effectiveMode === 'attempt_range' ? normalizedRanges : effectiveRanges,
    });
    setReferenceWavesConfig(result.tunedConfig);

    // Повторно прогоняем прогноз на уже подобранных волнах, чтобы статус автоподбора
    // отражал фактическую проходимость, а не только число попыток.
    const tunedForecast = simulateProgressionForecast(balance, {
      segmentId,
      playerLevel,
      initialSoft: computedInitialSoft,
      maxAttemptsPerLevel,
      energyPerLevel,
      energyPerAttempt,
      energyStart,
      energyRegenIntervalSec,
      energyRegenIntervalSecPremium,
      upgradePolicy: fullWeaponAndSupportUpgradePolicy,
      referenceWavesConfig: result.tunedConfig,
    });
    const tunedRowsByLevel = new Map(tunedForecast.levels.map((r) => [r.levelIndex, r]));

    if (effectiveMode === 'pass_rate') {
      const avgErr =
        Object.entries(result.scoreByLevel).reduce((sum, [level, score]) => {
          const target = effectiveTargets[Number(level)] ?? 0;
          return sum + Math.abs(score - target);
        }, 0) / Math.max(1, Object.keys(result.scoreByLevel).length);
      const failedLevels = tunedForecast.levels.filter((l) => !l.passed).map((l) => l.levelIndex);
      const failedSuffix = failedLevels.length > 0
        ? ` Непроходимые уровни: ${failedLevels.slice(0, 6).join(', ')}${failedLevels.length > 6 ? '...' : ''}.`
        : '';
      setTuneStatus(`Автоподбор выполнен. Средняя ошибка по целям: ${avgErr.toFixed(1)}%.${failedSuffix}`);
      setTuneDiagnostics([]);
    } else {
      let levelsInError = 0;
      const avgErr =
        Object.entries(result.scoreByLevel).reduce((sum, [levelKey, attempts]) => {
          const level = Number(levelKey);
          const range = normalizedRanges[level] ?? { min: 2, max: 6 };
          const row = tunedRowsByLevel.get(level);
          const unitsTotal = sumObjectValues((row?.unitsByEnemyId ?? {}) as unknown as Record<string, number>);
          if (unitsTotal <= 0) return sum;
          levelsInError += 1;
          if (!row || !row.passed) return sum + 1000;
          if (attempts < range.min) return sum + (range.min - attempts);
          if (attempts > range.max) return sum + (attempts - range.max);
          return sum;
        }, 0) / Math.max(1, levelsInError);
      const failedLevels = tunedForecast.levels.filter((l) => !l.passed).map((l) => l.levelIndex);
      const diagnostics: TuneDiagnosticsRow[] = [];
      for (let level = 1; level <= balance.meta.gameLevels; level += 1) {
        const target = effectiveRanges[level] ?? { min: 2, max: 6 };
        const effective = normalizedRanges[level] ?? target;
        const row = tunedRowsByLevel.get(level);
        const unitsTotal = sumObjectValues((row?.unitsByEnemyId ?? {}) as unknown as Record<string, number>);
        const attemptsFact = row?.attemptsTotal ?? 0;
        const passed = row?.passed ?? false;
        const hasUnits = unitsTotal > 0;
        const inRange = hasUnits && passed && attemptsFact >= effective.min && attemptsFact <= effective.max;
        const accuracyPercent = computeAccuracyPercent(
          hasUnits,
          passed,
          attemptsFact,
          effective.min,
          effective.max
        );
        diagnostics.push({
          level,
          targetMin: target.min,
          targetMax: target.max,
          effectiveMin: effective.min,
          effectiveMax: effective.max,
          attemptsFact,
          passed,
          inRange,
          reachableByDefinition: true,
          hasUnits,
          accuracyPercent,
        });
      }
      setTuneDiagnostics(diagnostics);
      const failedSuffix = failedLevels.length > 0
        ? ` Непроходимые уровни: ${failedLevels.slice(0, 6).join(', ')}${failedLevels.length > 6 ? '...' : ''}.`
        : '';
      setTuneStatus(`Автоподбор выполнен. Среднее отклонение по попыткам: ${avgErr.toFixed(1)}.${failedSuffix}`);
    }
  };

  const attemptsChartData = useMemo(() => {
    return tableRows.map((r) => ({
      level: `Ур. ${r.level}`,
      attempts: Math.round(r.attemptsTotal * 10) / 10,
    }));
  }, [tableRows]);

  const rewardChartData = useMemo(() => {
    return tableRows.map((r) => ({
      level: `Ур. ${r.level}`,
      reward: Math.round(r.avgRewardPerAttempt * 10) / 10,
    }));
  }, [tableRows]);

  const endingSoftChartData = useMemo(() => {
    return tableRows.map((r) => ({
      level: `Ур. ${r.level}`,
      soft: Math.round(r.endingSoftBalance),
    }));
  }, [tableRows]);

  const weaponSpendChartData = useMemo(() => {
    return tableRows.map((r) => ({
      level: `Ур. ${r.level}`,
      weaponSpend: Math.round(r.weaponUpgradeSoftSpentOnLevel),
    }));
  }, [tableRows]);

  const attemptPowerChartData = useMemo(() => {
    const rows = forecast.attemptsTimeline ?? [];
    return rows.map((p) => ({
      attempt: p.attemptOrdinal,
      playerPower: Math.round(p.playerPower * 10) / 10,
      enemyPower: Math.round(p.enemyPower * 10) / 10,
      powerDelta: Math.round(p.powerDelta * 10) / 10,
      level: p.levelIndex,
      day: p.forecastDay,
    }));
  }, [forecast.attemptsTimeline]);

  const attemptLevelSpans = useMemo(() => {
    const rows = forecast.attemptsTimeline ?? [];
    const byLevel = new Map<number, { start: number; end: number }>();
    for (const row of rows) {
      const cur = byLevel.get(row.levelIndex);
      if (!cur) {
        byLevel.set(row.levelIndex, { start: row.attemptOrdinal, end: row.attemptOrdinal });
      } else {
        cur.start = Math.min(cur.start, row.attemptOrdinal);
        cur.end = Math.max(cur.end, row.attemptOrdinal);
      }
    }
    return [...byLevel.entries()]
      .map(([level, span]) => ({ level, ...span }))
      .sort((a, b) => a.level - b.level);
  }, [forecast.attemptsTimeline]);

  const attemptPowerBounds = useMemo(() => {
    if (attemptPowerChartData.length === 0) {
      return { minAttempt: 1, maxAttempt: 1, minY: 0, maxY: 1 };
    }
    const minAttempt = attemptPowerChartData[0].attempt;
    const maxAttempt = attemptPowerChartData[attemptPowerChartData.length - 1].attempt;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const row of attemptPowerChartData) {
      minY = Math.min(minY, row.playerPower, row.enemyPower, row.powerDelta);
      maxY = Math.max(maxY, row.playerPower, row.enemyPower, row.powerDelta);
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY === maxY) {
      return { minAttempt, maxAttempt, minY: 0, maxY: Math.max(1, maxY || 1) };
    }
    return { minAttempt, maxAttempt, minY, maxY };
  }, [attemptPowerChartData]);

  const attemptPowerVisibleData = useMemo(() => {
    const left = Math.max(attemptPowerBounds.minAttempt, Math.floor(attemptPowerFrom || attemptPowerBounds.minAttempt));
    const right = Math.min(attemptPowerBounds.maxAttempt, Math.floor(attemptPowerTo || attemptPowerBounds.maxAttempt));
    const from = Math.min(left, right);
    const to = Math.max(left, right);
    return attemptPowerChartData.filter((r) => r.attempt >= from && r.attempt <= to);
  }, [attemptPowerChartData, attemptPowerFrom, attemptPowerTo, attemptPowerBounds]);

  const attemptPowerYDomain = useMemo<[number, number] | ['auto', 'auto']>(() => {
    if (attemptPowerYMin === 0 && attemptPowerYMax === 0) return ['auto', 'auto'];
    const min = Math.min(attemptPowerYMin, attemptPowerYMax);
    const max = Math.max(attemptPowerYMin, attemptPowerYMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return ['auto', 'auto'];
    return [min, max];
  }, [attemptPowerYMin, attemptPowerYMax]);

  return (
    <section>
      <div className="ui-toolbar" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h3>Прогноз прогрессии</h3>
          <p className="ui-hint" style={{ maxWidth: 640, marginBottom: 0 }}>
            Попытки, награды и прокачка по референсным волнам. Сегмент, энергия и лимит попыток —{' '}
            <strong style={{ color: '#e2e8f0' }}>как на «Уровни»</strong> (строка K = «Симулировать 1–K»). Ранние уровни
            усиливаются множителями из «Формулы → Бой и референсные волны».
          </p>
        </div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <label>
            Сегмент:&nbsp;
            <select style={selectStyle} value={segmentId} onChange={(e) => setSegmentId(e.target.value as SegmentId)}>
              <option value="free">{segmentLabelById.free}</option>
              <option value="payer">{segmentLabelById.payer}</option>
              <option value="whale">{segmentLabelById.whale}</option>
            </select>
          </label>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            Стартовый софт: {Math.round(computedInitialSoft)} монет
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            Пройдено уровней: {passedLevelsCount} из {totalLevels}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            Версия конструктора: {referenceWavesRevision}
          </div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Лимит попыток/уровень</span>
            <input
              style={inputStyle}
              type="number"
              min={1}
              max={100000}
              value={maxAttemptsPerLevel}
              onChange={(e) => setMaxAttemptsPerLevel(Math.max(1, Number(e.target.value) || 200))}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Энергия максимум</span>
            <input
              style={inputStyle}
              type="number"
              min={0}
              max={100000}
              value={energyPerLevel}
              onChange={(e) => setEnergyPerLevel(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Стартовая энергия</span>
            <input
              style={inputStyle}
              type="number"
              min={0}
              max={100000}
              value={energyStart}
              onChange={(e) => setEnergyStart(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Энергия на попытку</span>
            <input
              style={inputStyle}
              type="number"
              min={1}
              max={100000}
              value={energyPerAttempt}
              onChange={(e) => setEnergyPerAttempt(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }} title="Референс: 600 с на 1 ед. энергии">
              Интервал регена, с (бесплатник)
            </span>
            <input
              style={inputStyle}
              type="number"
              min={1}
              max={86400}
              step={1}
              value={energyRegenIntervalSec}
              onChange={(e) => setEnergyRegenIntervalSec(Math.max(1, Number(e.target.value) || 600))}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }} title="Референс: 300 с (VIP / премиум)">
              Интервал регена, с (премиум / VIP)
            </span>
            <input
              style={inputStyle}
              type="number"
              min={1}
              max={86400}
              step={1}
              value={energyRegenIntervalSecPremium}
              onChange={(e) => setEnergyRegenIntervalSecPremium(Math.max(1, Number(e.target.value) || 300))}
            />
          </label>
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: 12,
          borderRadius: 10,
          border: '1px solid rgba(148, 163, 184, 0.28)',
          background: 'rgba(30, 41, 59, 0.35)',
          color: '#cbd5e1',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Что влияет на прогноз (где редактировать)</div>
        <div>
          - Покупка ракетниц: Hydra = <strong>{balance.economy.rocketUnlock?.hydra70Soft ?? 0}</strong> soft, Hellfire ={' '}
          <strong>{balance.economy.rocketUnlock?.hellfireSoft ?? 0}</strong> soft (вкладка <strong>«Экономика»</strong>).
        </div>
        <div>
          - Слоты деки: старт = <strong>{balance.economy.startingCardSlots ?? 4}</strong>, цена слота ={' '}
          <strong>{balance.economy.cardSlotCost ?? 0}</strong> soft, максимум = <strong>{balance.economy.maxCardSlots ?? 0}</strong> (вкладка{' '}
          <strong>«Формулы»</strong> или <strong>«Экономика»</strong>).
        </div>
        <div>
          - Ежедневные награды (login): дней в календаре = <strong>{(balance.economy.loginRewards ?? []).length}</strong> (вкладка{' '}
          <strong>«Экономика»</strong>).
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          padding: 14,
          borderRadius: 10,
          border: '2px solid rgba(56, 189, 248, 0.5)',
          background: 'rgba(12, 74, 110, 0.28)',
        }}
      >
        <div style={{ fontWeight: 700, color: '#7dd3fc', marginBottom: 8, fontSize: 15 }}>Время и сундуки в прогнозе</div>
        <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.55, display: 'grid', gap: 6 }}>
          <div>
            Ожидание энергии (реген, без сундуков):{' '}
            <strong>{Math.round((forecast.progressionElapsedHours ?? 0) * 10) / 10} ч</strong>
            <span style={{ color: '#94a3b8' }}>
              {' '}
              · интервал для «{segmentLabelById[segmentId]}»: {Math.round(activeEnergyRegenIntervalSec)} с/ед. энергии
            </span>
          </div>
          {((forecast.segmentSoftIncomePerDay ?? 0) > 0.0001) && (
            <div>
              Донатный софт сегмента (iap_soft):{' '}
              <strong>{Math.round((forecast.segmentSoftIncomePerDay ?? 0) * 10) / 10} / день</strong>
            </div>
          )}
          {((forecast.segmentHardIncomePerDay ?? 0) > 0.0001) && (
            <div>
              Донатное золото сегмента (iap_gold, доля недельного USD):{' '}
              <strong>{Math.round((forecast.segmentHardIncomePerDay ?? 0) * 10) / 10} / день</strong> — в прогнозе целиком
              тратится на сундуки с карточками (хард).
            </div>
          )}
          {segmentId !== 'free' && (
            <div>
              Стартер-пак (<code style={{ color: '#cbd5e1' }}>shop_starter_pack</code>, содержимое из{' '}
              <code style={{ color: '#cbd5e1' }}>referencePacks.starterPack</code> с учётом экономики):{' '}
              <strong>
                {forecast.finalState.forecastStarterPackPurchased
                  ? 'куплен один раз (когда после начислений дня хватило золота, до автотраты на сундуки)'
                  : 'не куплен за прогон (не набралось золота или нет конфигурации)'}
              </strong>
            </div>
          )}
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Бесплатник: весь хард из логина и бесплатных сундуков тоже уходит в сундуки с картами. Платящие: часть USD в софт на
            оружие, часть в золото на сундуки; апгрейд оружия не только в «лучший DPS».
          </div>
          <div>
            Лимит попыток в календарный день (meta): <strong>{balance.meta.forecastMaxAttemptsPerDay ?? 10}</strong> ·
            Макс. «День прохода» в таблице:{' '}
            <strong>{maxDayReachedInForecast > 0 ? maxDayReachedInForecast : '—'}</strong>
          </div>
          <div>
            Календарные часы модели (ожидание энергии + 24 ч за каждую смену дня по лимиту попыток):{' '}
            <strong>{Math.round((forecast.progressionElapsedCalendarHours ?? 0) * 10) / 10} ч</strong>
          </div>
          <div>
            Бесплатные сундуки: <strong>по ключам за попытку уровня</strong> (победа / поражение), цикл по{' '}
            <strong>{chestOpenSummary.configuredFreeChestCount}</strong> слотам в <code style={{ color: '#cbd5e1' }}>freeChests</code>.
            {chestOpenSummary.freeKeyForecast && (
              <>
                {' '}
                Прогон: попыток <strong>{chestOpenSummary.freeKeyForecast.attempts}</strong> (побед{' '}
                <strong>{chestOpenSummary.freeKeyForecast.wins}</strong>, поражений{' '}
                <strong>{chestOpenSummary.freeKeyForecast.losses}</strong>), ключей набрано{' '}
                <strong>{Math.round(chestOpenSummary.freeKeyForecast.keysEarnedTotal * 100) / 100}</strong>, остаток банка{' '}
                <strong>{Math.round(chestOpenSummary.freeKeyForecast.keyBankRemaining * 100) / 100}</strong>.
              </>
            )}
          </div>
          <div>
            Σ открытий бесплатных сундуков за прогон:{' '}
            <strong>{Math.round(chestOpenSummary.freeOpensSum * 100) / 100}</strong>
          </div>
        </div>
        {setBalance && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid rgba(148, 163, 184, 0.35)',
              display: 'grid',
              gap: 10,
              fontSize: 13,
              color: '#cbd5e1',
            }}
          >
            <label style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <span style={{ minWidth: 200 }}>Макс. попыток в календарный день</span>
              <input
                style={inputStyle}
                type="number"
                min={1}
                max={500}
                step={1}
                value={balance.meta.forecastMaxAttemptsPerDay ?? 10}
                onChange={(e) => {
                  const v = Math.max(1, Number(e.target.value) || 10);
                  setBalance((prev) => ({
                    ...prev,
                    meta: { ...prev.meta, forecastMaxAttemptsPerDay: v },
                  }));
                }}
              />
            </label>
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
          Подробности по сундукам — ниже в блоке «Прокачка карточек поддержки». Дублирование настроек: вкладка «Формулы»,
          голубой блок вверху страницы.
        </div>
      </div>

      <div style={{ marginTop: 14, color: '#94a3b8', fontSize: 13, lineHeight: 1.35 }}>
        <strong style={{ color: '#e2e8f0' }}>Как рассчитывается прокачка:</strong>{' '}
        1 попытка = 1 уровень (все волны внутри). После каждой попытки тратится софт
        на апгрейд по policy: оружие — линейная цена из карточки ствола (
        <code style={{ color: '#cbd5e1' }}>upgradeBaseSoft</code>,{' '}
        <code style={{ color: '#cbd5e1' }}>upgradeCostMultiplier</code>
        ), support-карты — ожидаемыми чертежами через сундуки (сундук с максимальной эффективностью по rarity).
        <br />
        <strong style={{ color: '#e2e8f0' }}>Не пройдено</strong> = не удалось пройти уровень за лимит попыток ({maxAttemptsPerLevel}) или не хватило энергии (макс: {energyPerLevel}, старт: {energyStart}, интервал регена для «{segmentLabelById[segmentId]}»:{' '}
        {Math.round(activeEnergyRegenIntervalSec)} с/ед. ≈ {Math.round(energyRegenPerHourForSegment * 10) / 10} ед./ч, цена попытки: {energyPerAttempt}).
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>
          <div>
            <strong style={{ color: '#e2e8f0' }}>Итоговая прокачка:</strong>
          </div>
          <div>
            Оружие: {finalWeaponLevels.machineGunLevel} /{' '}
            {showRocketSummary ? finalWeaponLevels.hydraLevel : '—'} /{' '}
            {showRocketSummary ? finalWeaponLevels.hellfireLevel : '—'}
          </div>
          <div>Софт на балансе: {Math.round(finalSoftBalance)} монет</div>
          <div>Траты софта на апгрейд оружия (весь прогон): {Math.round(finalWeaponUpgradeSoftSpent)} монет</div>
          <div>
            Траты софта на покупку ракетниц (весь прогон):{' '}
            {Math.round(forecast.finalState.lifetimeRocketUnlockSoftSpent ?? 0)} монет
          </div>
          <div>
            Траты софта на слоты деки (весь прогон):{' '}
            {Math.round(forecast.finalState.deckSlots?.lifetimeSoftSpent ?? 0)} монет · слотов: {forecast.finalState.deckSlots?.slots ?? 0}
          </div>
          {segmentId !== 'free' && (
            <div>
              Стартер-пак:{' '}
              {forecast.finalState.forecastStarterPackPurchased ? 'был куплен в прогнозе' : 'не куплен'}
            </div>
          )}
          {topSupportCards.length > 0 && (
            <div>
              Поддержка (топ): {topSupportCardsText}
            </div>
          )}
        </div>
      </div>
      {(supportProgressRows.length > 0 ||
        chestOpenSummary.freeRows.length > 0 ||
        chestOpenSummary.paidRows.length > 0) && (
        <div style={{ marginTop: 10 }}>
          <h4 style={{ margin: '0 0 6px 0' }}>Прокачка карточек поддержки</h4>
          <div
            style={{
              margin: '0 0 12px 0',
              padding: 10,
              borderRadius: 8,
              border: '1px solid rgba(148, 163, 184, 0.35)',
              background: 'rgba(30, 41, 59, 0.55)',
              fontSize: 12,
              color: '#94a3b8',
              lineHeight: 1.5,
            }}
          >
            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 6 }}>Как это считается</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>Бесплатные сундуки:</strong> за каждую <strong>попытку уровня</strong> начисляются ключи: победа +{' '}
                {chestOpenSummary.freeKeyForecast?.keysPerWin ?? 1}, поражение +{' '}
                {chestOpenSummary.freeKeyForecast?.keysPerLoss ?? 0.5}. После{' '}
                {chestOpenSummary.freeKeyForecast?.keysToOpenChest ?? 3} ключей открывается следующий сундук по порядку в{' '}
                <code style={{ color: '#cbd5e1' }}>economy.freeChests</code> (1★ → 2★ → 3★ → снова 1★). Параметры:{' '}
                <code style={{ color: '#cbd5e1' }}>economy.freeChestKeyProgression</code>.
              </li>
              <li style={{ marginTop: 6 }}>
                <strong>Карты поддержки:</strong> после <strong>победной</strong> попытки уровня (после последней волны)
                за один шаг тратится софт на <strong>одну</strong> цель: выбирается карта, которая ближе всего к
                следующему уровню по прогрессу чертежей (и с мягким учётом цены). Под неё же покупаются{' '}
                <strong>платные</strong> сундуки (эффективность по rarity). Чертежи с <strong>бесплатных</strong> сундуков
                копятся по дропу на <strong>все</strong> карты; апгрейд уровня — только при хватке чертежей и софта на
                монеты. С ур. 3 миссии в симуляции выдаётся стартовый набор карт ур.1 (мины, десант и т.д.).
              </li>
            </ul>
          </div>
          {(chestOpenSummary.waitHoursTotal > 0.001 || chestOpenSummary.calendarHoursTotal > 0.001) && (
            <div style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: 11, lineHeight: 1.45 }}>
              <div>
                Ожидание энергии (реген): {Math.round(chestOpenSummary.waitHoursTotal * 10) / 10} ч · Календарные часы
                модели: {Math.round(chestOpenSummary.calendarHoursTotal * 10) / 10} ч
              </div>
              <div style={{ marginTop: 4 }}>
                «День прохода» — лимит попыток/день. Бесплатные сундуки — от ключей за попытки, см. блок «Как это считается».
              </div>
            </div>
          )}
          {(chestOpenSummary.freeRows.length > 0 || chestOpenSummary.paidRows.length > 0) && (
            <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {chestOpenSummary.freeRows.length > 0 && (
                <div style={{ minWidth: 220 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Бесплатные сундуки (EV за прогон, по ключам)
                  </div>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Сундук</th>
                        <th style={thStyle}>Открытий (EV)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chestOpenSummary.freeRows.map((r) => (
                        <tr key={r.id}>
                          <td style={tdStyle}>{r.name}</td>
                          <td style={tdStyle}>{Math.round(r.count * 100) / 100}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {chestOpenSummary.freeRows.length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: '#94a3b8',
                        lineHeight: 1.45,
                        maxWidth: 560,
                      }}
                    >
                      Открытия накапливаются от попыток уровня (см. ключи выше). Σ по строкам:{' '}
                      {Math.round(chestOpenSummary.freeOpensSum * 100) / 100}
                      {chestOpenSummary.freeKeyForecast
                        ? ` · всего открытий (сундуков): ${Math.round(chestOpenSummary.freeKeyForecast.chestOpensTotal * 100) / 100}`
                        : ''}
                      .
                    </div>
                  )}
                </div>
              )}
              {chestOpenSummary.paidRows.length > 0 && (
                <div style={{ minWidth: 220 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Платные сундуки (ожид. покупок за софт за прогон)
                  </div>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>ID сундука</th>
                        <th style={thStyle}>Покупок (EV)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chestOpenSummary.paidRows.map((r) => (
                        <tr key={r.id}>
                          <td style={tdStyle}>
                            <code style={{ color: '#cbd5e1' }}>{r.name}</code>
                          </td>
                          <td style={tdStyle}>{Math.round(r.count * 100) / 100}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {supportProgressRows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Карточка</th>
                    <th style={thStyle}>Итоговый уровень</th>
                    <th style={thStyle}>Ожид. чертежей (остаток)</th>
                  </tr>
                </thead>
                <tbody>
                  {supportProgressRows.map((r) => (
                    <tr key={r.id}>
                      <td style={tdStyle}>{r.name}</td>
                      <td style={tdStyle}>{r.level}</td>
                      <td style={tdStyle}>{Math.round(r.blueprints * 100) / 100}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <section style={{ marginTop: 14, border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: 10, padding: 10 }}>
        <h4 style={{ marginTop: 0, marginBottom: 8 }}>Автоподбор волн (эмпирика)</h4>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
          Режимы: по проценту прохождения или по диапазону попыток на уровень.
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <label style={{ color: '#94a3b8', fontSize: 12 }}>
            <input
              type="radio"
              name="tune_mode"
              checked={tuneMode === 'pass_rate'}
              onChange={() => setTuneMode('pass_rate')}
            />{' '}
            Цель: % прохождения
          </label>
          <label style={{ color: '#94a3b8', fontSize: 12 }}>
            <input
              type="radio"
              name="tune_mode"
              checked={tuneMode === 'attempt_range'}
              onChange={() => setTuneMode('attempt_range')}
            />{' '}
            Цель: диапазон попыток (на уровень)
          </label>
          <label style={{ color: '#94a3b8', fontSize: 12 }}>
            Пресет:&nbsp;
            <select
              style={{ ...inputStyle, minWidth: 180 }}
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value as 'onboarding' | 'midcore' | 'hardcore')}
            >
              <option value="onboarding">Ранний onboarding</option>
              <option value="midcore">Мидкор</option>
              <option value="hardcore">Хардкор</option>
            </select>
          </label>
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
            onClick={() => applyPreset(selectedPreset)}
          >
            Применить пресет
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Имя пресета</span>
            <input
              style={{ ...inputStyle, minWidth: 220 }}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </label>
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
            onClick={saveCurrentPreset}
          >
            Сохранить пресет
          </button>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Сохранённые</span>
            <select
              style={{ ...inputStyle, minWidth: 220 }}
              value={selectedSavedPreset}
              onChange={(e) => {
                setSelectedSavedPreset(e.target.value);
                onActivePresetNameChange?.(e.target.value);
              }}
            >
              <option value="">—</option>
              {Object.keys(savedPresets).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
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
            onClick={loadSavedPreset}
            disabled={!selectedSavedPreset}
          >
            Загрузить в цели
          </button>
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
            onClick={applySavedPresetAndAutoTune}
            disabled={!selectedSavedPreset}
            title="Загрузить пресет и сразу применить к волнам"
          >
            Применить к волнам
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
            onClick={deleteSavedPreset}
            disabled={!selectedSavedPreset}
          >
            Удалить
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={autoApplyOnLoadPreset}
              onChange={(e) => setAutoApplyAndPersist(e.target.checked)}
            />
            Автоприменять к волнам при загрузке
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 10, flexWrap: 'wrap' }}>
          {tuneMode === 'pass_rate' ? (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>Массово %: от</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  max={100}
                  value={bulkPassFrom}
                  onChange={(e) => setBulkPassFrom(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>до</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  max={100}
                  value={bulkPassTo}
                  onChange={(e) => setBulkPassTo(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                />
              </label>
            </>
          ) : (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>Массово min: от</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  value={bulkMinFrom}
                  onChange={(e) => setBulkMinFrom(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>до</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  value={bulkMinTo}
                  onChange={(e) => setBulkMinTo(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>Массово max: от</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  value={bulkMaxFrom}
                  onChange={(e) => setBulkMaxFrom(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>до</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  value={bulkMaxTo}
                  onChange={(e) => setBulkMaxTo(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </>
          )}
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
            onClick={applyBulkFill}
          >
            Массово заполнить
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>Протянуть вниз с уровня</span>
            <input
              style={inputStyle}
              type="number"
              min={1}
              max={balance.meta.gameLevels}
              value={fillDownFromLevel}
              onChange={(e) => setFillDownFromLevel(Math.max(1, Math.min(balance.meta.gameLevels, Number(e.target.value) || 1)))}
            />
          </label>
          {tuneMode === 'pass_rate' ? (
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Значение %</span>
              <input
                style={inputStyle}
                type="number"
                min={0}
                max={100}
                value={fillDownPassValue}
                onChange={(e) => setFillDownPassValue(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
            </label>
          ) : (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>min</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  value={fillDownMinValue}
                  onChange={(e) => setFillDownMinValue(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>max</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  value={fillDownMaxValue}
                  onChange={(e) => setFillDownMaxValue(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </>
          )}
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
            onClick={applyFillDownManual}
          >
            Протянуть
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
            onClick={fillDownFromCurrentLevelValues}
          >
            Взять из уровня и протянуть
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: 8 }}>
          {Array.from({ length: balance.meta.gameLevels }, (_, i) => i + 1).map((level) => {
            if (tuneMode === 'pass_rate') {
              return (
                <label key={level} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>Ур. {level}, цель %</span>
                  <input
                    style={inputStyle}
                    type="number"
                    min={0}
                    max={100}
                    value={tuneTargets[level] ?? 0}
                    onChange={(e) =>
                      setTuneTargets((prev) => ({
                        ...prev,
                        [level]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </label>
              );
            }
            const range = tuneAttemptRanges[level] ?? { min: 2, max: 6 };
            const unreachableByDefinition = false;
            return (
              <div key={level} style={{ display: 'grid', gap: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>Ур. {level}, попытки на уровень min/max</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <input
                    style={{
                      ...inputStyle,
                      border: unreachableByDefinition
                        ? '1px solid rgba(245, 158, 11, 0.65)'
                        : inputStyle.border,
                    }}
                    type="number"
                    min={1}
                    max={100000}
                    value={range.min}
                    onChange={(e) => {
                      const min = Math.max(1, Number(e.target.value) || 1);
                      setTuneAttemptRanges((prev) => ({
                        ...prev,
                        [level]: { min, max: Math.max(min, prev[level]?.max ?? min) },
                      }));
                    }}
                  />
                  <input
                    style={{
                      ...inputStyle,
                      border: unreachableByDefinition
                        ? '1px solid rgba(245, 158, 11, 0.65)'
                        : inputStyle.border,
                    }}
                    type="number"
                    min={1}
                    max={100000}
                    value={range.max}
                    onChange={(e) => {
                      const max = Math.max(1, Number(e.target.value) || 1);
                      setTuneAttemptRanges((prev) => ({
                        ...prev,
                        [level]: { min: Math.min(prev[level]?.min ?? max, max), max },
                      }));
                    }}
                  />
                </div>
                {unreachableByDefinition && null}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
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
            onClick={() => handleAutoTune()}
          >
            Автоподбор по целям
          </button>
          {tuneStatus && <span style={{ color: '#94a3b8', fontSize: 12 }}>{tuneStatus}</span>}
        </div>
        {tuneMode === 'attempt_range' && tuneDiagnostics.length > 0 && (
          <div style={{ marginTop: 10, overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Ур.</th>
                  <th style={thStyle}>Цель min/max</th>
                  <th style={thStyle}>Эффективная цель</th>
                  <th style={thStyle}>Факт попыток</th>
                  <th style={thStyle}>Проход</th>
                  <th style={thStyle}>Точность</th>
                </tr>
              </thead>
              <tbody>
                {tuneDiagnostics.map((r) => (
                  <tr key={r.level}>
                    <td style={tdStyle}>{r.level}</td>
                    <td style={tdStyle}>{r.targetMin}..{r.targetMax}</td>
                    <td style={tdStyle}>
                      {r.effectiveMin}..{r.effectiveMax}
                      {!r.reachableByDefinition ? ' (скорректировано)' : ''}
                    </td>
                    <td style={tdStyle}>{r.attemptsFact}</td>
                    <td style={tdStyle}>
                      <span style={{ color: !r.hasUnits ? '#94a3b8' : (r.passed ? '#22c55e' : '#ef4444'), fontWeight: 700 }}>
                        {!r.hasUnits ? 'Н/Д' : (r.passed ? 'ДА' : 'НЕТ')}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: getAccuracyColor(r.accuracyPercent), fontWeight: 800 }}>
                        {r.accuracyPercent == null ? 'НЕТ ДАННЫХ' : `${Math.round(r.accuracyPercent)}%`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24, marginTop: 18 }}>
        {/* Визуально показываем сегмент-зависимую метрику первой */}
        <section>
          <h4 style={{ margin: '0 0 8px 0' }}>Траты софта на оружие по уровням</h4>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={weaponSpendChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="level" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="weaponSpend" fill="#f97316" name="Софт на оружие" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <h4 style={{ margin: '0 0 8px 0' }}>Остаток софта по уровням</h4>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={endingSoftChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="level" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="soft" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="Софт" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <h4 style={{ margin: '0 0 8px 0' }}>Мощь по попыткам: игрок vs уровень</h4>
          <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#64748b', lineHeight: 1.45, maxWidth: 760 }}>
            Ось X — сквозные попытки прогноза. Линия «Мощь игрока» учитывает устойчивый DPS оружия, множитель боевого
            навыка, уровни support-карт и retry-множитель. «Сложность уровня» = 0.7×requiredDps + 0.3×входящая угроза
            по волнам текущего уровня.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Попытки: от</span>
              <input
                style={{ ...inputStyle, minWidth: 100 }}
                type="number"
                min={attemptPowerBounds.minAttempt}
                max={attemptPowerBounds.maxAttempt}
                value={attemptPowerFrom}
                onChange={(e) => setAttemptPowerFrom(Math.max(1, Number(e.target.value) || attemptPowerBounds.minAttempt))}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>до</span>
              <input
                style={{ ...inputStyle, minWidth: 100 }}
                type="number"
                min={attemptPowerBounds.minAttempt}
                max={attemptPowerBounds.maxAttempt}
                value={attemptPowerTo}
                onChange={(e) => setAttemptPowerTo(Math.max(1, Number(e.target.value) || attemptPowerBounds.maxAttempt))}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Y min (0 = auto)</span>
              <input
                style={{ ...inputStyle, minWidth: 120 }}
                type="number"
                step={0.1}
                value={attemptPowerYMin}
                onChange={(e) => setAttemptPowerYMin(Number(e.target.value) || 0)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>Y max (0 = auto)</span>
              <input
                style={{ ...inputStyle, minWidth: 120 }}
                type="number"
                step={0.1}
                value={attemptPowerYMax}
                onChange={(e) => setAttemptPowerYMax(Number(e.target.value) || 0)}
              />
            </label>
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
              onClick={() => {
                setAttemptPowerFrom(attemptPowerBounds.minAttempt);
                setAttemptPowerTo(attemptPowerBounds.maxAttempt);
              }}
            >
              Весь диапазон X
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
              onClick={() => {
                setAttemptPowerYMin(0);
                setAttemptPowerYMax(0);
              }}
            >
              Авто Y
            </button>
          </div>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={attemptPowerVisibleData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="attempt" />
                <YAxis domain={attemptPowerYDomain} />
                {attemptLevelSpans.map((span, idx) => (
                  <ReferenceArea
                    key={`lvl-area-${span.level}`}
                    x1={span.start}
                    x2={span.end}
                    fill={idx % 2 === 0 ? '#38bdf8' : '#a78bfa'}
                    fillOpacity={0.08}
                    ifOverflow="extendDomain"
                  />
                ))}
                {attemptLevelSpans.map((span) => (
                  <ReferenceLine
                    key={`lvl-start-${span.level}`}
                    x={span.start}
                    stroke="#94a3b8"
                    strokeOpacity={0.55}
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                    label={{ value: `L${span.level} start`, position: 'insideTopLeft', fill: '#94a3b8', fontSize: 10 }}
                  />
                ))}
                {attemptLevelSpans.map((span) => (
                  <ReferenceLine
                    key={`lvl-end-${span.level}`}
                    x={span.end}
                    stroke="#94a3b8"
                    strokeOpacity={0.55}
                    strokeDasharray="2 6"
                    ifOverflow="extendDomain"
                    label={{ value: `L${span.level} end`, position: 'insideTopRight', fill: '#94a3b8', fontSize: 10 }}
                  />
                ))}
                <Tooltip
                  formatter={(value: unknown, name: unknown) => {
                    if (typeof value !== 'number') return [String(value), String(name)];
                    const label =
                      name === 'playerPower'
                        ? 'Мощь игрока'
                        : name === 'enemyPower'
                          ? 'Сложность уровня'
                          : name === 'powerDelta'
                            ? 'Дельта (игрок-враг)'
                            : String(name);
                    return [value.toFixed(1), label];
                  }}
                  labelFormatter={(label: unknown, payload: any[]) => {
                    const row = payload?.[0]?.payload;
                    if (!row) return `Попытка ${String(label)}`;
                    return `Попытка ${String(label)} · ур. ${row.level} · день ${row.day}`;
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="playerPower" stroke="#22c55e" strokeWidth={2} dot={false} name="Мощь игрока" />
                <Line type="monotone" dataKey="enemyPower" stroke="#ef4444" strokeWidth={2} dot={false} name="Сложность уровня" />
                <Line type="monotone" dataKey="powerDelta" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Дельта" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <h4 style={{ margin: '0 0 8px 0' }}>Метрики по уровням</h4>
          <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#64748b', lineHeight: 1.45, maxWidth: 720 }}>
            «День прохода» = номер календарного дня при лимите попыток в день (по умолчанию 10). Каждая попытка уровня
            (включая провал) считается; на новый день лимит обнуляется. Сундуки считаются только от ожидания энергии.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Уровень</th>
                  <th style={thStyle}>Проход</th>
                  <th style={thStyle}>Прохождение (%)</th>
                  <th style={thStyle} title="Сумма юнитов по волнам">
                    Юнитов ∑
                  </th>
                  <th style={thStyle} title="Σ HP (baseHp × N) по волнам">
                    Σ HP
                  </th>
                  <th
                    style={thStyle}
                    title="Σ по волнам: 0,7×requiredDps + 0,3×угроза — та же мощь, что «Сложность уровня» на графике"
                  >
                    Σ мощь
                  </th>
                  <th style={thStyle}>Пыток (итого)</th>
                  <th style={thStyle}>Средняя награда за попытку</th>
                  <th style={thStyle}>Сумма награды</th>
                  <th style={thStyle}>Траты на оружие (уровень)</th>
                  <th style={thStyle}>Траты на оружие (кум.)</th>
                  <th style={thStyle}>Покупка ракет (ур.)</th>
                  <th style={thStyle}>Покупка ракет (кум.)</th>
                  <th style={thStyle}>Слоты деки (ур.)</th>
                  <th style={thStyle}>Слоты деки (кум.)</th>
                  <th style={thStyle}>Остаток софта</th>
                  <th
                    style={thStyle}
                    title="День прогноза по лимиту meta.forecastMaxAttemptsPerDay попыток в календарный день (по умолч. 10). Сундуки только от ожидания энергии."
                  >
                    День прохода
                  </th>
                  <th
                    style={thStyle}
                    title="Гидра и Hellfire в бою подключаются с игрового ур. 2; для строки ур. 1 в ячейке — «—»."
                  >
                    Уровни оружия: {weaponLabel.machineGun} / {weaponLabel.hydra70} / {weaponLabel.hellfire}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.level}>
                    <td style={tdStyle}>{r.level}</td>
                    <td style={tdStyle} title={r.passed ? 'Уровень пройден' : 'Уровень не пройден'}>
                      <span style={{ color: r.passed ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
                        {r.passed ? 'ПРОЙДЕНО' : 'НЕ ПРОЙДЕНО'}
                      </span>
                    </td>
                    <td style={tdStyle}>{r.winRatePercent}%</td>
                    <td style={tdStyle}>
                      {r.unitsTotal > 0
                        ? r.unitsRawSumFromEditor != null && r.unitsRawSumFromEditor > 0
                          ? r.unitsRawSumFromEditor
                          : r.unitsTotal
                        : '—'}
                    </td>
                    <td style={tdStyle}>
                      {r.totalEnemyHpScaled != null && r.totalEnemyHpScaled > 0
                        ? Math.round(r.totalEnemyHpScaled).toLocaleString('ru-RU')
                        : '—'}
                    </td>
                    <td style={tdStyle}>
                      {r.totalEnemyLevelPowerScaled != null && r.totalEnemyLevelPowerScaled > 0
                        ? Math.round(r.totalEnemyLevelPowerScaled).toLocaleString('ru-RU')
                        : '—'}
                    </td>
                    <td style={tdStyle}>{r.unitsTotal > 0 ? r.attemptsTotal : '—'}</td>
                    <td style={tdStyle}>{r.unitsTotal > 0 ? r.avgRewardPerAttempt.toFixed(1) : '—'}</td>
                    <td style={tdStyle}>{r.unitsTotal > 0 ? Math.round(r.totalRewardSoft) : '—'}</td>
                    <td style={tdStyle}>{r.unitsTotal > 0 ? Math.round(r.weaponUpgradeSoftSpentOnLevel) : '—'}</td>
                    <td style={tdStyle}>{Math.round(r.weaponUpgradeSoftSpentCumulative)}</td>
                    <td style={tdStyle}>{r.unitsTotal > 0 ? Math.round(r.rocketUnlockSoftSpentOnLevel) : '—'}</td>
                    <td style={tdStyle}>{Math.round(r.rocketUnlockSoftSpentCumulative)}</td>
                    <td style={tdStyle}>{r.unitsTotal > 0 ? Math.round(r.deckSlotsSoftSpentOnLevel) : '—'}</td>
                    <td style={tdStyle}>{Math.round(r.deckSlotsSoftSpentCumulative)}</td>
                    <td style={tdStyle}>{Math.round(r.endingSoftBalance)}</td>
                    <td style={tdStyle}>{r.dayReached ?? '—'}</td>
                    <td style={tdStyle} title="Ракеты не участвуют в бою на ур. 1 — уровни Гидры/Hellfire показываются как «—».">
                      {r.mg} / {rocketWeaponLevelDisplay(r.level, r.hydra)} /{' '}
                      {rocketWeaponLevelDisplay(r.level, r.hellfire)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h4 style={{ margin: '0 0 8px 0' }}>Попытки на прохождение</h4>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={attemptsChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="level" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="attempts" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <h4 style={{ margin: '0 0 8px 0' }}>Средняя награда за попытку</h4>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={rewardChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="level" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="reward" stroke="#82ca9d" strokeWidth={2} dot={{ r: 4 }} name="Награда" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </section>
  );
};

