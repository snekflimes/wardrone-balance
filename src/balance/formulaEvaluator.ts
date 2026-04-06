import { Parser } from 'expr-eval';
import type { BalanceConstants } from './model';

const parser = new Parser();

export type FormulaCategory = 'economy' | 'weapons';
export type FormulaSourceType = 'entity' | 'constant';
export type FormulaOperator = '+' | '-' | '*' | '/';
export type FormulaFunctionName = 'pow' | 'min' | 'max';

export interface FormulaValueInput {
  sourceType: FormulaSourceType;
  entityKey?: string;
  constantValue?: number;
  offset?: number;
}

export interface FormulaAtomBase {
  id: string;
  operator?: FormulaOperator;
  kind: 'source' | 'function';
}

export interface FormulaSourceAtom extends FormulaAtomBase {
  kind: 'source';
  source: FormulaValueInput;
}

export interface FormulaFunctionAtom extends FormulaAtomBase {
  kind: 'function';
  functionName: FormulaFunctionName;
  args: [FormulaValueInput, FormulaValueInput];
}

export type FormulaAtom = FormulaSourceAtom | FormulaFunctionAtom;

export interface FormulaAtomsBuilder {
  atoms: FormulaAtom[];
}

export interface FormulaBuilderState {
  economy?: Partial<Record<'missionReward', FormulaAtomsBuilder>>;
  weapons?: Partial<Record<'damage' | 'fireRate' | 'ammo', FormulaAtomsBuilder>>;
}

export function evaluateFormula(
  expression: string,
  scope: Record<string, number>
): number {
  const trimmed = expression.trim();
  if (!trimmed) return 0;
  try {
    const expr = parser.parse(trimmed);
    const result = expr.evaluate(scope);
    return typeof result === 'number' && Number.isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

export function validateFormula(
  expression: string,
  scope: Record<string, number>
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: true, value: 0 };
  try {
    const expr = parser.parse(trimmed);
    const result = expr.evaluate(scope);
    if (typeof result !== 'number' || !Number.isFinite(result))
      return { ok: false, error: 'Результат не число' };
    return { ok: true, value: result };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

export interface FormulaDefinition {
  id: 'missionReward' | 'damage' | 'fireRate' | 'ammo';
  category: FormulaCategory;
  name: string;
  description: string;
  defaultExpression: string;
  defaultBuilder: FormulaAtomsBuilder;
  variables: string[];
}

function makeSource(
  id: string,
  source: FormulaValueInput,
  operator?: FormulaOperator
): FormulaSourceAtom {
  return { id, kind: 'source', operator, source };
}

function makeFunction(
  id: string,
  functionName: FormulaFunctionName,
  args: [FormulaValueInput, FormulaValueInput],
  operator?: FormulaOperator
): FormulaFunctionAtom {
  return { id, kind: 'function', operator, functionName, args };
}

function makeEntity(entityKey: string, offset = 0): FormulaValueInput {
  return { sourceType: 'entity', entityKey, offset };
}

function defaultBuilder(
  first: FormulaValueInput,
  fnName: FormulaFunctionName,
  fnArgs: [FormulaValueInput, FormulaValueInput]
): FormulaAtomsBuilder {
  return {
    atoms: [
      makeSource('a1', first),
      makeFunction('a2', fnName, fnArgs, '*'),
    ],
  };
}

export const FORMULA_DEFINITIONS: FormulaDefinition[] = [
  {
    id: 'missionReward',
    category: 'economy',
    name: 'База награды за бой по игровому уровню',
    description:
      'Монеты «базы» до премиума/убийств/бонуса победы. levelIndex = 0 для ур.1. Полный итог за бой считается в симуляторе.',
    defaultExpression: 'baseMissionReward * pow(baseLevelRewardMultiplier, levelIndex)',
    defaultBuilder: defaultBuilder(
      makeEntity('baseMissionReward'),
      'pow',
      [makeEntity('baseLevelRewardMultiplier'), makeEntity('levelIndex')]
    ),
    variables: ['baseMissionReward', 'baseLevelRewardMultiplier', 'levelIndex'],
  },
  {
    id: 'damage',
    category: 'weapons',
    name: 'Урон оружия на уровне',
    description:
      'Референс: база + база × коэфф × шаг. levelIndex = 0 на ур.1 (шагов после первого). Эквивалент: baseDamage + baseDamage * coeff * (weaponLevel - 1).',
    defaultExpression: 'baseDamage + baseDamage * damageMultiplierPerLevel * levelIndex',
    defaultBuilder: { atoms: [] },
    variables: ['baseDamage', 'damageMultiplierPerLevel', 'levelIndex', 'weaponLevel'],
  },
  {
    id: 'fireRate',
    category: 'weapons',
    name: 'Скорострельность на уровне',
    description: 'Выстрелов в минуту. levelIndex = 0 для 1-го уровня.',
    defaultExpression: 'baseFireRatePerMin * pow(fireRateMultiplierPerLevel, levelIndex)',
    defaultBuilder: defaultBuilder(
      makeEntity('baseFireRatePerMin'),
      'pow',
      [makeEntity('fireRateMultiplierPerLevel'), makeEntity('levelIndex')]
    ),
    variables: ['baseFireRatePerMin', 'fireRateMultiplierPerLevel', 'levelIndex'],
  },
  {
    id: 'ammo',
    category: 'weapons',
    name: 'Боезапас на уровне',
    description:
      'Референс: линейно от базы, как урон. Итог округляется в симуляторе. levelIndex = 0 на ур.1.',
    defaultExpression: 'baseAmmo + baseAmmo * ammoMultiplierPerLevel * levelIndex',
    defaultBuilder: { atoms: [] },
    variables: ['baseAmmo', 'ammoMultiplierPerLevel', 'levelIndex', 'weaponLevel'],
  },
];

export const DEFAULT_FORMULAS = Object.fromEntries(
  FORMULA_DEFINITIONS.map((f) => [f.id, f.defaultExpression])
) as Record<string, string>;

function compileValueInput(input: FormulaValueInput | undefined): string {
  if (!input) return '0';
  const raw =
    input.sourceType === 'constant'
      ? String(Number.isFinite(input.constantValue ?? 0) ? input.constantValue ?? 0 : 0)
      : (input.entityKey?.trim() || '0');
  const offset = input.offset ?? 0;
  if (!offset) return raw;
  return offset > 0 ? `(${raw} + ${offset})` : `(${raw} - ${Math.abs(offset)})`;
}

function compileAtom(atom: FormulaAtom): string {
  if (atom.kind === 'source') {
    return compileValueInput(atom.source);
  }
  const left = compileValueInput(atom.args[0]);
  const right = compileValueInput(atom.args[1]);
  return `${atom.functionName}(${left}, ${right})`;
}

export function compileFormulaBuilder(builder: FormulaAtomsBuilder | undefined): string {
  const atoms = builder?.atoms?.filter(Boolean) ?? [];
  if (atoms.length === 0) return '';

  let expr = compileAtom(atoms[0]);
  for (let i = 1; i < atoms.length; i += 1) {
    const atom = atoms[i];
    const operator = atom.operator ?? '*';
    expr = `(${expr} ${operator} ${compileAtom(atom)})`;
  }
  return expr;
}

export function getFormulaExpression(
  constants: BalanceConstants,
  category: FormulaCategory,
  id: FormulaDefinition['id'],
  defaultExpression: string
): string {
  const builder =
    category === 'economy'
      ? constants.formulas?.builders?.economy?.[id as 'missionReward']
      : constants.formulas?.builders?.weapons?.[id as 'damage' | 'fireRate' | 'ammo'];
  const built = compileFormulaBuilder(builder);
  if (built) return built;

  const explicit =
    category === 'economy'
      ? constants.formulas?.economy?.[id as 'missionReward']
      : constants.formulas?.weapons?.[id as 'damage' | 'fireRate' | 'ammo'];
  if (explicit?.trim()) return explicit;

  return defaultExpression;
}
