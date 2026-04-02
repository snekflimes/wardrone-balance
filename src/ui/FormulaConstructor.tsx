import React, { useMemo } from 'react';
import type { BalanceConstants } from '../balance/model';
import {
  compileFormulaBuilder,
  FORMULA_DEFINITIONS,
  getFormulaExpression,
  validateFormula,
  type FormulaAtom,
  type FormulaAtomsBuilder,
  type FormulaDefinition,
  type FormulaFunctionAtom,
  type FormulaFunctionName,
  type FormulaOperator,
  type FormulaSourceAtom,
  type FormulaValueInput,
} from '../balance/formulaEvaluator';
import { getMissionRewardSoft } from '../balance/economy';
import { getMaxWeaponLevelAcross } from '../balance/weaponMeta';

type SetBalance = React.Dispatch<React.SetStateAction<BalanceConstants>>;

const VARIABLE_LABELS: Record<string, string> = {
  // Economy
  baseMissionReward: 'Базовая награда за миссию',
  baseLevelRewardMultiplier: 'Множитель за уровень (награда)',
  levelIndex: 'Индекс уровня',
  missionRewardBase: 'База награды за миссию',
  missionDifficultyMultiplier: 'Множитель награды между волнами (софт)',
  waveIndex: 'Номер волны',
  // Weapons
  baseDamage: 'Базовый урон',
  damageMultiplierPerLevel: 'Коэфф. роста урона (линейно, × levelIndex)',
  baseFireRatePerMin: 'Базовая скорострельность (в минуту)',
  fireRateMultiplierPerLevel: 'Множитель скорострельности за уровень',
  baseAmmo: 'Базовый боезапас',
  ammoMultiplierPerLevel: 'Коэфф. роста боезапаса (линейно, × levelIndex)',
  weaponLevel: 'Уровень оружия (1…N)',
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function localizeVariableKey(key: string): string {
  return VARIABLE_LABELS[key] ?? key;
}

function localizeExpression(expression: string, variableKeys: string[]): string {
  let out = expression;
  for (const key of variableKeys) {
    const label = localizeVariableKey(key);
    if (label === key) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(key)}\\b`, 'g'), label);
  }
  return out;
}

const blockStyle: React.CSSProperties = {
  marginBottom: 24,
  padding: 16,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: 14,
  background: 'rgba(15, 23, 42, 0.55)',
};

const cardStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: 12,
  background: 'rgba(2, 6, 23, 0.55)',
  padding: 12,
  marginTop: 12,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#cbd5e1',
  minWidth: 120,
};

const fieldStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.45)',
  borderRadius: 8,
  background: 'rgba(15, 23, 42, 0.88)',
  color: '#e2e8f0',
  padding: '6px 8px',
  fontSize: 13,
};

const buttonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: 8,
  background: 'rgba(30, 41, 59, 0.9)',
  color: '#e2e8f0',
  padding: '6px 10px',
  fontSize: 12,
};

function cloneBuilder(builder: FormulaAtomsBuilder): FormulaAtomsBuilder {
  return {
    atoms: builder.atoms.map((atom) => ({
      ...atom,
      ...(atom.kind === 'source'
        ? { source: { ...atom.source } }
        : { args: atom.args.map((arg) => ({ ...arg })) as [FormulaValueInput, FormulaValueInput] }),
    })),
  };
}

function createId(prefix = 'node'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultSource(def: FormulaDefinition): FormulaValueInput {
  return {
    sourceType: 'entity',
    entityKey: def.variables[0] ?? 'levelIndex',
    offset: 0,
  };
}

function defaultFunction(def: FormulaDefinition): FormulaFunctionAtom {
  const isWaveReward = def.id === 'waveReward';
  return {
    id: createId('fn'),
    kind: 'function',
    operator: '*',
    functionName: 'pow',
    args: [
      { sourceType: 'entity', entityKey: def.variables[1] ?? def.variables[0] ?? 'x', offset: 0 },
      {
        sourceType: 'entity',
        entityKey: isWaveReward ? 'waveIndex' : 'levelIndex',
        offset: isWaveReward ? -1 : 0,
      },
    ],
  };
}

function defaultBuilder(def: FormulaDefinition): FormulaAtomsBuilder {
  return cloneBuilder(def.defaultBuilder);
}

function getStoredBuilder(
  balance: BalanceConstants,
  def: FormulaDefinition
): FormulaAtomsBuilder {
  const stored =
    def.category === 'economy'
      ? balance.formulas?.builders?.economy?.[def.id as 'missionReward' | 'waveReward']
      : balance.formulas?.builders?.weapons?.[def.id as 'damage' | 'fireRate' | 'ammo'];
  return stored ? cloneBuilder(stored) : defaultBuilder(def);
}

function getCurrentExpression(
  balance: BalanceConstants,
  def: FormulaDefinition
): string {
  return getFormulaExpression(balance, def.category, def.id, def.defaultExpression);
}

function buildScopeForPreview(
  balance: BalanceConstants,
  def: FormulaDefinition,
  rowIndex: number
): Record<string, number> {
  const { economy, weapons } = balance;
  if (def.category === 'economy') {
    if (def.id === 'missionReward') {
      return {
        baseMissionReward: economy.baseMissionReward,
        baseLevelRewardMultiplier: economy.baseLevelRewardMultiplier,
        levelIndex: rowIndex,
      };
    }
    if (def.id === 'waveReward') {
      const missionRewardBase = getMissionRewardSoft(balance, 1);
      return {
        missionRewardBase,
        missionDifficultyMultiplier: economy.missionDifficultyMultiplier ?? 1.3,
        waveIndex: rowIndex + 1,
      };
    }
  }
  if (def.category === 'weapons') {
    const w = weapons.machineGun;
    const g = weapons.growth;
    return {
      baseDamage: w.baseDamage,
      damageMultiplierPerLevel: g.damageMultiplierPerLevel,
      baseFireRatePerMin: w.baseFireRatePerMin,
      fireRateMultiplierPerLevel: g.fireRateMultiplierPerLevel,
      baseAmmo: w.baseAmmo,
      ammoMultiplierPerLevel: g.ammoMultiplierPerLevel,
      levelIndex: rowIndex,
      weaponLevel: rowIndex + 1,
    };
  }
  return {};
}

function updateFormulaBuilder(
  setBalance: SetBalance,
  def: FormulaDefinition,
  builder: FormulaAtomsBuilder
) {
  const compiled = compileFormulaBuilder(builder);
  setBalance((prev) => {
    const formulas = {
      ...(prev.formulas ?? {}),
      builders: {
        ...(prev.formulas?.builders ?? {}),
        [def.category]: {
          ...(prev.formulas?.builders?.[def.category] ?? {}),
          [def.id]: builder,
        },
      },
    };
    if (def.category === 'economy') {
      formulas.economy = {
        ...(prev.formulas?.economy ?? {}),
        [def.id]: compiled || undefined,
      };
    } else {
      formulas.weapons = {
        ...(prev.formulas?.weapons ?? {}),
        [def.id]: compiled || undefined,
      };
    }
    return { ...prev, formulas };
  });
}

function resetFormula(
  setBalance: SetBalance,
  def: FormulaDefinition
) {
  updateFormulaBuilder(setBalance, def, defaultBuilder(def));
}

function updateAtom(
  setBalance: SetBalance,
  def: FormulaDefinition,
  atomIndex: number,
  patch: Partial<FormulaAtom>
) {
  setBalance((prev) => {
    const current = getStoredBuilder(prev, def);
    const atoms = current.atoms.map((atom, index) =>
      index === atomIndex ? ({ ...atom, ...patch } as FormulaAtom) : atom
    );
    const nextBuilder = { atoms };
    const compiled = compileFormulaBuilder(nextBuilder);
    const formulas = {
      ...(prev.formulas ?? {}),
      builders: {
        ...(prev.formulas?.builders ?? {}),
        [def.category]: {
          ...(prev.formulas?.builders?.[def.category] ?? {}),
          [def.id]: nextBuilder,
        },
      },
    };
    if (def.category === 'economy') {
      formulas.economy = {
        ...(prev.formulas?.economy ?? {}),
        [def.id]: compiled || undefined,
      };
    } else {
      formulas.weapons = {
        ...(prev.formulas?.weapons ?? {}),
        [def.id]: compiled || undefined,
      };
    }
    return { ...prev, formulas };
  });
}

function addAtom(
  setBalance: SetBalance,
  def: FormulaDefinition,
  kind: 'source' | 'function'
) {
  setBalance((prev) => {
    const current = getStoredBuilder(prev, def);
    const atoms = [...current.atoms];
    const operator: FormulaOperator = atoms.length ? '*' : '*';
    const newAtom: FormulaAtom =
      kind === 'source'
        ? {
            id: createId('src'),
            kind: 'source',
            operator: atoms.length ? operator : undefined,
            source: defaultSource(def),
          }
        : defaultFunction(def);
    if (atoms.length > 0) {
      newAtom.operator = operator;
    }
    atoms.push(newAtom);
    const nextBuilder = { atoms };
    const compiled = compileFormulaBuilder(nextBuilder);
    return {
      ...prev,
      formulas: {
        ...(prev.formulas ?? {}),
        builders: {
          ...(prev.formulas?.builders ?? {}),
          [def.category]: {
            ...(prev.formulas?.builders?.[def.category] ?? {}),
            [def.id]: nextBuilder,
          },
        },
        ...(def.category === 'economy'
          ? {
              economy: {
                ...(prev.formulas?.economy ?? {}),
                [def.id]: compiled || undefined,
              },
            }
          : {
              weapons: {
                ...(prev.formulas?.weapons ?? {}),
                [def.id]: compiled || undefined,
              },
            }),
      },
    };
  });
}

function removeAtom(
  setBalance: SetBalance,
  def: FormulaDefinition,
  atomIndex: number
) {
  setBalance((prev) => {
    const current = getStoredBuilder(prev, def);
    const atoms = current.atoms.filter((_, index) => index !== atomIndex);
    const nextBuilder = { atoms };
    const compiled = compileFormulaBuilder(nextBuilder);
    return {
      ...prev,
      formulas: {
        ...(prev.formulas ?? {}),
        builders: {
          ...(prev.formulas?.builders ?? {}),
          [def.category]: {
            ...(prev.formulas?.builders?.[def.category] ?? {}),
            [def.id]: nextBuilder,
          },
        },
        ...(def.category === 'economy'
          ? {
              economy: {
                ...(prev.formulas?.economy ?? {}),
                [def.id]: compiled || undefined,
              },
            }
          : {
              weapons: {
                ...(prev.formulas?.weapons ?? {}),
                [def.id]: compiled || undefined,
              },
            }),
      },
    };
  });
}

function SourceEditor({
  atom,
  def,
  onChange,
}: {
  atom: FormulaSourceAtom;
  def: FormulaDefinition;
  onChange: (patch: Partial<FormulaSourceAtom>) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={rowStyle}>
        <span style={labelStyle}>Источник</span>
        <select
          style={fieldStyle}
          value={atom.source.sourceType}
          onChange={(e) =>
            onChange({
              source: {
                ...atom.source,
                sourceType: e.target.value as 'entity' | 'constant',
              },
            })
          }
        >
          <option value="entity">Сущность</option>
          <option value="constant">Константа</option>
        </select>
      </div>
      {atom.source.sourceType === 'entity' ? (
        <div style={rowStyle}>
          <span style={labelStyle}>Сущность</span>
          <select
            style={fieldStyle}
            value={atom.source.entityKey ?? def.variables[0] ?? 'levelIndex'}
            onChange={(e) =>
              onChange({
                source: {
                  ...atom.source,
                  entityKey: e.target.value,
                },
              })
            }
          >
            {def.variables.map((variable) => (
              <option key={variable} value={variable}>
                {localizeVariableKey(variable)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div style={rowStyle}>
          <span style={labelStyle}>Константа</span>
          <input
            type="number"
            style={fieldStyle}
            value={atom.source.constantValue ?? 0}
            onChange={(e) =>
              onChange({
                source: {
                  ...atom.source,
                  constantValue: Number(e.target.value) || 0,
                },
              })
            }
          />
        </div>
      )}
      <div style={rowStyle}>
        <span style={labelStyle}>Смещение</span>
        <input
          type="number"
          style={fieldStyle}
          value={atom.source.offset ?? 0}
          onChange={(e) =>
            onChange({
              source: {
                ...atom.source,
                offset: Number(e.target.value) || 0,
              },
            })
          }
        />
      </div>
    </div>
  );
}

function FunctionEditor({
  atom,
  def,
  onChange,
}: {
  atom: FormulaFunctionAtom;
  def: FormulaDefinition;
  onChange: (patch: Partial<FormulaFunctionAtom>) => void;
}) {
  const setArg = (index: 0 | 1, patch: Partial<FormulaValueInput>) => {
    const nextArgs = [...atom.args] as [FormulaValueInput, FormulaValueInput];
    nextArgs[index] = { ...nextArgs[index], ...patch };
    onChange({ args: nextArgs });
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={rowStyle}>
        <span style={labelStyle}>Функция</span>
        <select
          style={fieldStyle}
          value={atom.functionName}
          onChange={(e) =>
            onChange({ functionName: e.target.value as FormulaFunctionName })
          }
        >
          <option value="pow">pow (степень)</option>
          <option value="min">min (минимум)</option>
          <option value="max">max (максимум)</option>
        </select>
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Аргумент A</div>
        <SourceEditor
          atom={{ id: 'arg-a', kind: 'source', source: atom.args[0] }}
          def={def}
          onChange={(patch) => setArg(0, patch.source ?? atom.args[0])}
        />
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Аргумент B</div>
        <SourceEditor
          atom={{ id: 'arg-b', kind: 'source', source: atom.args[1] }}
          def={def}
          onChange={(patch) => setArg(1, patch.source ?? atom.args[1])}
        />
      </div>
    </div>
  );
}

interface FormulaConstructorProps {
  balance: BalanceConstants;
  setBalance: SetBalance;
}

export const FormulaConstructor: React.FC<FormulaConstructorProps> = ({
  balance,
  setBalance,
}) => {
  return (
    <section style={blockStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Конструктор формул</h3>
      <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
        Формула теперь собирается из нод: можно выбирать сущность или константу, добавлять операторы и функции, а справа сразу видеть готовое выражение и превью.
      </p>
      {FORMULA_DEFINITIONS.map((def) => (
        <FormulaEditor
          key={def.id}
          def={def}
          balance={balance}
          setBalance={setBalance}
        />
      ))}
    </section>
  );
};

function FormulaEditor({
  def,
  balance,
  setBalance,
}: {
  def: FormulaDefinition;
  balance: BalanceConstants;
  setBalance: SetBalance;
}) {
  const builder = getStoredBuilder(balance, def);
  const expression = getCurrentExpression(balance, def);
  const localizedExpression = localizeExpression(
    expression || def.defaultExpression,
    def.variables
  );

  const previewRows = useMemo(() => {
    const isEconomy = def.category === 'economy';
    const n = isEconomy
      ? def.id === 'waveReward'
        ? 2
        : balance.meta.gameLevels
      : getMaxWeaponLevelAcross(balance);
    const rows: { label: string; value: number; error?: string }[] = [];
    for (let i = 0; i < n; i += 1) {
      const scope = buildScopeForPreview(balance, def, i);
      const result = validateFormula(expression || def.defaultExpression, scope);
      rows.push(
        result.ok
          ? {
              label: def.id === 'waveReward' ? `Волна ${i + 1}` : `Ур.${i + 1}`,
              value: Math.round(result.value * 100) / 100,
            }
          : { label: `#${i + 1}`, value: 0, error: result.error }
      );
    }
    return rows;
  }, [balance, def, expression]);

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: 15, color: '#f8fafc' }}>
            {def.name}
          </h4>
          <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>{def.description}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={buttonStyle} onClick={() => resetFormula(setBalance, def)}>
            Сбросить шаблон
          </button>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => addAtom(setBalance, def, 'source')}
          >
            + Сущность/константа
          </button>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => addAtom(setBalance, def, 'function')}
          >
            + Функция
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
        {builder.atoms.map((atom, index) => (
          <div
            key={atom.id}
            style={{
              border: '1px solid rgba(148, 163, 184, 0.24)',
              borderRadius: 12,
              padding: 12,
              background: 'rgba(15, 23, 42, 0.7)',
            }}
          >
            {index > 0 && (
              <div style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#94a3b8', marginRight: 8 }}>
                  Действие
                </span>
                <select
                  style={fieldStyle}
                  value={atom.operator ?? '*'}
                  onChange={(e) =>
                    updateAtom(setBalance, def, index, {
                      operator: e.target.value as FormulaOperator,
                    })
                  }
                >
                  <option value="+">+</option>
                  <option value="-">-</option>
                  <option value="*">*</option>
                  <option value="/">/</option>
                </select>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                {atom.kind === 'source' ? (
                  <SourceEditor
                    atom={atom}
                    def={def}
                    onChange={(patch) => updateAtom(setBalance, def, index, patch)}
                  />
                ) : (
                  <FunctionEditor
                    atom={atom}
                    def={def}
                    onChange={(patch) => updateAtom(setBalance, def, index, patch)}
                  />
                )}
              </div>
              <div>
                <button
                  type="button"
                  style={{ ...buttonStyle, color: '#fecaca', borderColor: 'rgba(248, 113, 113, 0.45)' }}
                  onClick={() => removeAtom(setBalance, def, index)}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(2, 6, 23, 0.7)' }}>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Собранное выражение</div>
        <code style={{ fontSize: 12, color: '#e2e8f0', wordBreak: 'break-word' }}>
          {localizedExpression}
        </code>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Превью</div>
        <table
          style={{
            borderCollapse: 'collapse',
            fontSize: 12,
            width: '100%',
          }}
        >
          <tbody>
            <tr>
              {previewRows.map((r) => (
                <td
                  key={r.label}
                  style={{
                    border: '1px solid rgba(148, 163, 184, 0.24)',
                    padding: '6px 8px',
                    color: '#e2e8f0',
                    background: r.error ? 'rgba(127, 29, 29, 0.35)' : 'rgba(15, 23, 42, 0.8)',
                  }}
                  title={r.error}
                >
                  {r.error ? '—' : r.value}
                </td>
              ))}
            </tr>
            <tr>
              {previewRows.map((r) => (
                <td
                  key={r.label}
                  style={{
                    border: '1px solid rgba(148, 163, 184, 0.24)',
                    padding: '4px 8px',
                    color: '#94a3b8',
                    background: 'rgba(15, 23, 42, 0.5)',
                  }}
                >
                  {r.label}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
