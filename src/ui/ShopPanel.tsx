import React, { useCallback, useMemo, useState } from 'react';
import type { BalanceConstants, ChestConfig, RefStarterPack, ShopItemConfig } from '../balance/model';
import { resolveStarterPackGrants } from '../balance/starterPack';
import {
  getEconomyUsdRates,
  getRewardEconomyComparison,
  getShopItemGrindReferenceUsd,
  getShopItemUsd,
} from '../balance/economy';
import {
  getExpectedKeysPerAttempt,
  getFreeChestKeyProgression,
  getFreeChestsForKeyCycle,
} from '../progression/iapAndChestsModel';

type SetBalance = React.Dispatch<React.SetStateAction<BalanceConstants>>;

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: 12,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 90,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: 'rgba(15, 23, 42, 0.9)',
  color: '#e2e8f0',
  boxSizing: 'border-box',
};

function setStarterPackRefField(setBalance: SetBalance, patch: Partial<RefStarterPack>) {
  setBalance((prev) => {
    const rp = prev.economy.referencePacks;
    if (!rp) return prev;
    const cur: RefStarterPack = rp.starterPack ?? {
      priceGold: 300,
      soft: 0,
      chestBronze: 0,
      chestSilver: 0,
      chestGold: 0,
    };
    return {
      ...prev,
      economy: {
        ...prev.economy,
        referencePacks: {
          ...rp,
          starterPack: { ...cur, ...patch },
        },
      },
    };
  });
}

function setChestField(
  setBalance: SetBalance,
  chestId: string,
  patch: Partial<ChestConfig>
) {
  setBalance((prev) => ({
    ...prev,
    economy: {
      ...prev.economy,
      chests: {
        ...prev.economy.chests,
        [chestId]: {
          ...prev.economy.chests[chestId],
          ...patch,
        },
      },
    },
  }));
}

function setChestChance(
  setBalance: SetBalance,
  chestId: string,
  key: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
  value: number
) {
  setBalance((prev) => ({
    ...prev,
    economy: {
      ...prev.economy,
      chests: {
        ...prev.economy.chests,
        [chestId]: {
          ...prev.economy.chests[chestId],
          dropChancesPercent: {
            ...(prev.economy.chests[chestId].dropChancesPercent ?? {
              common: 0,
              uncommon: 0,
              rare: 0,
              epic: 0,
              legendary: 0,
            }),
            [key]: value,
          },
        },
      },
    },
  }));
}

function setRarityWeight(
  setBalance: SetBalance,
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary',
  value: number
) {
  setBalance((prev) => ({
    ...prev,
    economy: {
      ...prev.economy,
      cardRarityWeights: {
        ...(prev.economy.cardRarityWeights ?? {}),
        [rarity]: value,
      },
    },
  }));
}

function createDefaultChest(): ChestConfig {
  return {
    priceSoft: 0,
    priceHard: 0,
    cards: 1,
    dropChancesPercent: {
      common: 1,
      uncommon: 1,
      rare: 1,
      epic: 1,
      legendary: 1,
    },
  };
}

function pickWeightedIndex(weights: number[]): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return -1;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function setFreeChestKeyProgressionField(
  setBalance: SetBalance,
  patch: Partial<NonNullable<BalanceConstants['economy']['freeChestKeyProgression']>>
) {
  setBalance((prev) => ({
    ...prev,
    economy: {
      ...prev.economy,
      freeChestKeyProgression: {
        ...(prev.economy.freeChestKeyProgression ?? {}),
        ...patch,
      },
    },
  }));
}

function setShopItemField(
  setBalance: SetBalance,
  itemId: string,
  patch: Partial<ShopItemConfig>
) {
  setBalance((prev) => ({
    ...prev,
    economy: {
      ...prev.economy,
      shopItems: prev.economy.shopItems.map((item) =>
        item.id === itemId ? { ...item, ...patch } : item
      ),
    },
  }));
}

export const ShopPanel: React.FC<{
  balance: BalanceConstants;
  setBalance: SetBalance;
}> = ({ balance, setBalance }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [newChestId, setNewChestId] = useState('');
  const [newPackId, setNewPackId] = useState('');
  const [newPackName, setNewPackName] = useState('');
  const [newPackCurrency, setNewPackCurrency] = useState<'soft' | 'hard'>('soft');
  const [newPackQuantity, setNewPackQuantity] = useState(1000);
  const [newPackPriceSoft, setNewPackPriceSoft] = useState(0);
  const [newPackPriceHard, setNewPackPriceHard] = useState(0);
  const [newPackBaseWeight, setNewPackBaseWeight] = useState(1);
  const [newFreeChestId, setNewFreeChestId] = useState('');
  const [newFreeChestName, setNewFreeChestName] = useState('');
  const [simChestQtyById, setSimChestQtyById] = useState<Record<string, number>>({});
  const [simCardId, setSimCardId] = useState<number>(14);
  const [simNeedBlueprints, setSimNeedBlueprints] = useState<number>(10);
  const [simResult, setSimResult] = useState<{
    softSpent: number;
    hardSpent: number;
    totalDrops: number;
    targetCardBlueprints: number;
    byCard: Record<number, number>;
    byRarity: Record<string, number>;
    expectedTargetPerCycle: number;
    cyclesForTarget: number | null;
    chanceByRarityPercent: Record<string, number>;
    chanceTargetCardPercent: number;
    chanceByItemPercent: Array<{ name: string; chancePercent: number }>;
  } | null>(null);
  const rates = getEconomyUsdRates(balance);
  const rewardComparison = useMemo(() => getRewardEconomyComparison(balance), [balance]);
  const resolvedStarterPack = useMemo(() => resolveStarterPackGrants(balance), [balance]);
  const starterRef = balance.economy.referencePacks?.starterPack;
  const keyProg = useMemo(() => getFreeChestKeyProgression(balance), [balance]);
  const keysPerAttemptAt50 = useMemo(
    () => getExpectedKeysPerAttempt(0.5, keyProg),
    [keyProg]
  );
  const chestIds = Object.keys(balance.economy.chests);
  /** Только сундуки цикла по ключам (легаси 5м/15м/30м не показываем, если уже есть 1★–3★). */
  const freeChests = useMemo(
    () => getFreeChestsForKeyCycle(balance.economy.freeChests),
    [balance.economy.freeChests]
  );
  const hasHiddenLegacyFreeChests = useMemo(() => {
    const raw = balance.economy.freeChests ?? [];
    return raw.length > getFreeChestsForKeyCycle(raw).length;
  }, [balance.economy.freeChests]);

  const stripLegacyFreeChestsFromBalance = useCallback(() => {
    setBalance((prev) => ({
      ...prev,
      economy: {
        ...prev.economy,
        freeChests: getFreeChestsForKeyCycle(prev.economy.freeChests),
      },
    }));
  }, [setBalance]);

  const toggleFreeChestPack = (freeChestId: string, packId: string) => {
    setBalance((prev) => ({
      ...prev,
      economy: {
        ...prev.economy,
        freeChests: (prev.economy.freeChests ?? []).map((ch) => {
          if (ch.id !== freeChestId) return ch;
          const exists = ch.packIds.includes(packId);
          return {
            ...ch,
            packIds: exists ? ch.packIds.filter((x) => x !== packId) : [...ch.packIds, packId],
          };
        }),
      },
    }));
  };
  const toggleFreeChestRarity = (
    freeChestId: string,
    rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  ) => {
    setBalance((prev) => ({
      ...prev,
      economy: {
        ...prev.economy,
        freeChests: (prev.economy.freeChests ?? []).map((ch) => {
          if (ch.id !== freeChestId) return ch;
          const exists = ch.blueprintRarities.includes(rarity);
          return {
            ...ch,
            blueprintRarities: exists
              ? ch.blueprintRarities.filter((x) => x !== rarity)
              : [...ch.blueprintRarities, rarity],
          };
        }),
      },
    }));
  };

  const addChest = () => {
    const id = newChestId.trim().toLowerCase();
    if (!id) return;
    if (balance.economy.chests[id]) return;
    setBalance((prev) => ({
      ...prev,
      economy: {
        ...prev.economy,
        chests: {
          ...prev.economy.chests,
          [id]: createDefaultChest(),
        },
      },
    }));
    setNewChestId('');
  };

  const removeChest = (chestId: string) => {
    setBalance((prev) => {
      const nextChests = { ...prev.economy.chests } as Record<string, ChestConfig>;
      delete nextChests[chestId];
      return {
        ...prev,
        economy: {
          ...prev.economy,
          chests: nextChests,
          shopItems: prev.economy.shopItems.filter((item) => item.chestId !== chestId),
        },
      };
    });
  };

  const runChestSimulation = () => {
    const rarityWeights = balance.economy.cardRarityWeights ?? {};
    const cards = balance.supportCards;
    const cardByRarity = new Map<string, typeof cards>();
    for (const c of cards) {
      const list = cardByRarity.get(c.rarity) ?? [];
      list.push(c);
      cardByRarity.set(c.rarity, list);
    }

    const byCard: Record<number, number> = {};
    const byRarity: Record<string, number> = {};
    const expectedByPack: Record<string, number> = {};
    const expectedByCard: Record<number, number> = {};
    const expectedByRarity: Record<string, number> = {};
    let expectedDropsTotal = 0;
    let softSpent = 0;
    let hardSpent = 0;
    let totalDrops = 0;

    // Платные сундуки: cards роллов по взвешенной формуле (как в SimulatorChest).
    for (const chestId of chestIds) {
      const qty = Math.max(0, Math.floor(simChestQtyById[chestId] ?? 0));
      if (qty <= 0) continue;
      const chest = balance.economy.chests[chestId];
      if (!chest) continue;
      softSpent += (chest.priceSoft ?? 0) * qty;
      hardSpent += (chest.priceHard ?? 0) * qty;
      const options = cards.map((card) => {
        const baseWeight = card.chestBaseWeight ?? 1;
        const rarityWeight = rarityWeights[card.rarity] ?? 1;
        const chestMult = chest.dropChancesPercent?.[card.rarity as keyof typeof chest.dropChancesPercent] ?? 1;
        return Math.max(0, baseWeight * rarityWeight * chestMult);
      });
      const rolls = Math.max(0, Math.floor(chest.cards * qty));
      const totalWeight = options.reduce((s, w) => s + w, 0);
      if (totalWeight > 0 && rolls > 0) {
        cards.forEach((card, idx) => {
          const p = options[idx] / totalWeight;
          expectedByCard[card.id] = (expectedByCard[card.id] ?? 0) + p * rolls;
          expectedByRarity[card.rarity] = (expectedByRarity[card.rarity] ?? 0) + p * rolls;
        });
        expectedDropsTotal += rolls;
      }
      for (let i = 0; i < rolls; i += 1) {
        const idx = pickWeightedIndex(options);
        if (idx < 0) continue;
        const card = cards[idx];
        byCard[card.id] = (byCard[card.id] ?? 0) + 1;
        byRarity[card.rarity] = (byRarity[card.rarity] ?? 0) + 1;
        totalDrops += 1;
      }
    }

    // Бесплатные сундуки: строго 1 дроп на сундук (пак ИЛИ 1 чертёж).
    const packsById = new Map((balance.economy.currencyPacks ?? []).map((p) => [p.id, p]));
    for (const chest of freeChests) {
      const qty = Math.max(0, Math.floor(simChestQtyById[chest.id] ?? 0));
      if (qty <= 0) continue;
      const pool: Array<{ kind: 'pack' | 'blueprint'; key: string; weight: number }> = [];
      for (const packId of chest.packIds ?? []) {
        const pack = packsById.get(packId);
        if (!pack) continue;
        pool.push({ kind: 'pack', key: packId, weight: Math.max(0, pack.baseWeight ?? 0) });
      }
      for (const rarity of chest.blueprintRarities ?? []) {
        pool.push({ kind: 'blueprint', key: rarity, weight: Math.max(0, rarityWeights[rarity] ?? 0) });
      }
      const weights = pool.map((p) => p.weight);
      const totalWeight = weights.reduce((s, w) => s + Math.max(0, w), 0);
      if (totalWeight > 0 && qty > 0) {
        for (const drop of pool) {
          const p = Math.max(0, drop.weight) / totalWeight;
          if (drop.kind === 'blueprint') {
            expectedByRarity[drop.key] = (expectedByRarity[drop.key] ?? 0) + p * qty;
            const list = cardByRarity.get(drop.key) ?? [];
            if (list.length > 0) {
              const perCard = (p * qty) / list.length;
              for (const c of list) expectedByCard[c.id] = (expectedByCard[c.id] ?? 0) + perCard;
            }
          } else {
            expectedByPack[drop.key] = (expectedByPack[drop.key] ?? 0) + p * qty;
          }
        }
        expectedDropsTotal += qty;
      }
      for (let i = 0; i < qty; i += 1) {
        const dropIdx = pickWeightedIndex(weights);
        if (dropIdx < 0) continue;
        const drop = pool[dropIdx];
        totalDrops += 1;
        if (drop.kind !== 'blueprint') continue;
        const rarity = drop.key;
        const list = cardByRarity.get(rarity) ?? [];
        if (list.length <= 0) continue;
        const card = list[Math.floor(Math.random() * list.length)];
        byCard[card.id] = (byCard[card.id] ?? 0) + 1;
        byRarity[rarity] = (byRarity[rarity] ?? 0) + 1;
      }
    }

    const targetCard = cards.find((c) => c.id === simCardId);
    let expectedTargetPerCycle = 0;
    if (targetCard) {
      expectedTargetPerCycle = expectedByCard[simCardId] ?? 0;
    }
    const cyclesForTarget = expectedTargetPerCycle > 0
      ? simNeedBlueprints / expectedTargetPerCycle
      : null;

    const packsByIdObj = Object.fromEntries((balance.economy.currencyPacks ?? []).map((p) => [p.id, p]));
    const chanceByItemPercent: Array<{ name: string; chancePercent: number }> = [];
    for (const card of cards) {
      const expected = expectedByCard[card.id] ?? 0;
      if (expectedDropsTotal <= 0 || expected <= 0) continue;
      chanceByItemPercent.push({
        name: `Чертёж: ${card.name}`,
        chancePercent: (expected / expectedDropsTotal) * 100,
      });
    }
    for (const [packId, expected] of Object.entries(expectedByPack)) {
      if (expectedDropsTotal <= 0 || expected <= 0) continue;
      const pack = packsByIdObj[packId];
      chanceByItemPercent.push({
        name: `Пак: ${pack?.name ?? packId}`,
        chancePercent: (expected / expectedDropsTotal) * 100,
      });
    }
    chanceByItemPercent.sort((a, b) => b.chancePercent - a.chancePercent);

    setSimResult({
      softSpent,
      hardSpent,
      totalDrops,
      targetCardBlueprints: byCard[simCardId] ?? 0,
      byCard,
      byRarity,
      expectedTargetPerCycle,
      cyclesForTarget,
      chanceByRarityPercent: Object.fromEntries(
        Object.entries(expectedByRarity).map(([r, v]) => [r, expectedDropsTotal > 0 ? (v / expectedDropsTotal) * 100 : 0])
      ),
      chanceTargetCardPercent: expectedDropsTotal > 0 ? ((expectedByCard[simCardId] ?? 0) / expectedDropsTotal) * 100 : 0,
      chanceByItemPercent,
    });
  };

  const applyReferenceFreeChestsPreset = () => {
    setBalance((prev) => ({
      ...prev,
      economy: {
        ...prev.economy,
        freeChestKeyProgression: {
          keysPerWin: 1,
          keysPerLoss: 0.5,
          keysToOpenChest: 3,
        },
        freeChests: [
          {
            id: 'free_1star',
            name: 'Бесплатный сундук 1★',
            packIds: ['soft_small', 'soft_medium', 'soft_big', 'hard_small'],
            blueprintRarities: ['common', 'uncommon'],
          },
          {
            id: 'free_2star',
            name: 'Бесплатный сундук 2★',
            packIds: ['soft_medium', 'soft_big', 'hard_small', 'hard_medium'],
            blueprintRarities: ['common', 'uncommon', 'rare'],
          },
          {
            id: 'free_3star',
            name: 'Бесплатный сундук 3★',
            packIds: ['soft_big', 'hard_medium', 'hard_big'],
            blueprintRarities: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
          },
        ],
      },
    }));
  };

  const addCurrencyPack = () => {
    const id = newPackId.trim();
    const name = newPackName.trim();
    if (!id || !name) return;
    if (balance.economy.shopItems.some((i) => i.id === id)) return;
    const type = newPackCurrency === 'soft' ? 'currency_soft_pack' : 'currency_hard_pack';
    setBalance((prev) => ({
      ...prev,
      economy: {
        ...prev.economy,
        shopItems: [
          ...prev.economy.shopItems,
          {
            id,
            name,
            type,
            quantity: Math.max(0, newPackQuantity),
            priceSoft: Math.max(0, newPackPriceSoft),
            priceHard: Math.max(0, newPackPriceHard),
            baseWeight: Math.max(0, newPackBaseWeight),
          },
        ],
      },
    }));
    setNewPackId('');
    setNewPackName('');
  };

  const addFreeChest = () => {
    const id = newFreeChestId.trim();
    const name = newFreeChestName.trim();
    if (!id || !name) return;
    if ((balance.economy.freeChests ?? []).some((c) => c.id === id)) return;
    setBalance((prev) => ({
      ...prev,
      economy: {
        ...prev.economy,
        freeChests: [
          ...(prev.economy.freeChests ?? []),
          {
            id,
            name,
            packIds: [],
            blueprintRarities: ['common'],
          },
        ],
      },
    }));
    setNewFreeChestId('');
    setNewFreeChestName('');
  };

  return (
    <section>
      <div className="ui-toolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <div>
          <h3>Сундуки и магазин</h3>
          <p className="ui-hint" style={{ marginBottom: 0 }}>
            Сравнение с референсом, редактирование сундуков и позиций магазина.
          </p>
        </div>
        <button type="button" className="btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? 'Развернуть' : 'Свернуть'}
        </button>
      </div>

      {!collapsed && (
        <>
          {balance.economy.referencePacks && (
            <div className="ui-subcard">
              <h4>Сравнение с референсом</h4>

              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>IAP золото</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, lineHeight: 1.35 }}>
                    Наши пакеты = реф. <strong>goldBase</strong> (обычная покупка). Бонус — акция в референсе. Match — к базе.
                  </div>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>USD</th>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Реф. база</th>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Реф. бонус</th>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Наш gold</th>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Match базе</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balance.economy.referencePacks.goldTiers.map((ref) => {
                        const our = balance.economy.shopItems.find(
                          (it) => it.type === 'iap_gold' && Math.abs((it.priceUsd ?? 0) - ref.usd) < 0.02
                        );
                        const ourQ = our?.quantity ?? 0;
                        const pct =
                          ref.goldBase > 0 ? ((ourQ / ref.goldBase) * 100).toFixed(0) : '—';
                        return (
                          <tr key={ref.usd}>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>${ref.usd}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{ref.goldBase}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>+{ref.goldBonus}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{ourQ}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{pct}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>IAP монеты</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, lineHeight: 1.35 }}>
                    Реф.: база / бонус (акция). Наши суммы в constants: база реф. × (~наша средняя награда за попытку / реф.), чтобы
                    при более «дорогом» софте в гринде за $ давали меньше монет, чем в референсе.
                  </div>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>USD</th>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Реф. база</th>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Реф. акция</th>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Наш soft</th>
                        <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Match базе</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balance.economy.referencePacks.cashTiers.map((ref) => {
                        const our = balance.economy.shopItems.find(
                          (it) => it.type === 'iap_soft' && Math.abs((it.priceUsd ?? 0) - ref.usd) < 0.02
                        );
                        const ourQ = our?.quantity ?? 0;
                        const pct =
                          ref.cashBase > 0 ? ((ourQ / ref.cashBase) * 100).toFixed(0) : '—';
                        return (
                          <tr key={ref.usd}>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>${ref.usd}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{ref.cashBase}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>+{ref.cashBonus}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{ourQ}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{pct}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Набор новичка (референс → магазин)</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.35 }}>
                    Реф.: цена в золоте и состав (сундуки бронза/серебро/золото как в{' '}
                    <code style={{ color: '#94a3b8' }}>referencePacks.chests</code>). В магазине — позиция{' '}
                    <code style={{ color: '#94a3b8' }}>shop_starter_pack</code>. Монеты: масштаб по отношению цен в золоте ×
                    паритет средней награды за попытку (реф. / наш). В прогнозе покупают только платники и киты, один раз,
                    когда после начислений дня хватает золота (до автотраты харда на сундуки).
                  </div>
                  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                    <label>
                      <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Реф. цена, золото</div>
                      <input
                        style={inputStyle}
                        type="number"
                        min={1}
                        value={starterRef?.priceGold ?? 300}
                        onChange={(e) =>
                          setStarterPackRefField(setBalance, { priceGold: Math.max(1, Number(e.target.value) || 300) })
                        }
                      />
                    </label>
                    <label>
                      <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Реф. монеты в наборе</div>
                      <input
                        style={inputStyle}
                        type="number"
                        min={0}
                        value={starterRef?.soft ?? 0}
                        onChange={(e) => setStarterPackRefField(setBalance, { soft: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </label>
                    <label>
                      <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Сундуки бронза</div>
                      <input
                        style={inputStyle}
                        type="number"
                        min={0}
                        value={starterRef?.chestBronze ?? 0}
                        onChange={(e) =>
                          setStarterPackRefField(setBalance, { chestBronze: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </label>
                    <label>
                      <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Сундуки серебро</div>
                      <input
                        style={inputStyle}
                        type="number"
                        min={0}
                        value={starterRef?.chestSilver ?? 0}
                        onChange={(e) =>
                          setStarterPackRefField(setBalance, { chestSilver: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </label>
                    <label>
                      <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Сундуки золото</div>
                      <input
                        style={inputStyle}
                        type="number"
                        min={0}
                        value={starterRef?.chestGold ?? 0}
                        onChange={(e) =>
                          setStarterPackRefField(setBalance, { chestGold: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </label>
                  </div>
                  {resolvedStarterPack ? (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>
                      <strong>Считается сейчас:</strong> {resolvedStarterPack.priceHard} зол. → +{resolvedStarterPack.soft.toLocaleString('ru-RU')} монет
                      {resolvedStarterPack.chestOpens.length > 0
                        ? ` · сундуки: ${resolvedStarterPack.chestOpens.map((o) => `${o.chestId}×${o.count}`).join(', ')}`
                        : ''}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
                      Задайте <code style={{ color: '#cbd5e1' }}>referencePacks.starterPack</code> и цену в золоте у{' '}
                      <code style={{ color: '#cbd5e1' }}>shop_starter_pack</code>.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="ui-subcard">
            <h4>Сундуки</h4>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
              Логика как в CSV/SimulatorChest: итоговый вес = вес карточки × вес редкости × коэффициент сундука.
            </div>
            <table style={{ ...tableStyle, marginBottom: 10 }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Вес редкости: common</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>uncommon</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>rare</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>epic</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>legendary</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((rarity) => (
                    <td key={rarity} style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                      <input
                        style={inputStyle}
                        type="number"
                        step="0.01"
                        value={balance.economy.cardRarityWeights?.[rarity] ?? 1}
                        onChange={(e) => setRarityWeight(setBalance, rarity, Number(e.target.value) || 0)}
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={{ ...inputStyle, maxWidth: 220 }}
                placeholder="ID сундука, например platinum"
                value={newChestId}
                onChange={(e) => setNewChestId(e.target.value)}
              />
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
                onClick={addChest}
              >
                Добавить сундук
              </button>
            </div>
            <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
              <div style={{ color: '#94a3b8', fontSize: 12 }}>
                Создание валютного пакета (soft/hard) с базовым весом
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(110px, 1fr))', gap: 8 }}>
                <input style={inputStyle} placeholder="id пакета" value={newPackId} onChange={(e) => setNewPackId(e.target.value)} />
                <input style={inputStyle} placeholder="Название" value={newPackName} onChange={(e) => setNewPackName(e.target.value)} />
                <select style={inputStyle} value={newPackCurrency} onChange={(e) => setNewPackCurrency(e.target.value as 'soft' | 'hard')}>
                  <option value="soft">soft</option>
                  <option value="hard">hard</option>
                </select>
                <input style={inputStyle} type="number" placeholder="Количество" value={newPackQuantity} onChange={(e) => setNewPackQuantity(Number(e.target.value) || 0)} />
                <input style={inputStyle} type="number" placeholder="Цена soft" value={newPackPriceSoft} onChange={(e) => setNewPackPriceSoft(Number(e.target.value) || 0)} />
                <input style={inputStyle} type="number" placeholder="Цена hard" value={newPackPriceHard} onChange={(e) => setNewPackPriceHard(Number(e.target.value) || 0)} />
                <input style={inputStyle} type="number" step="0.01" placeholder="Базовый вес" value={newPackBaseWeight} onChange={(e) => setNewPackBaseWeight(Number(e.target.value) || 0)} />
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
                  onClick={addCurrencyPack}
                >
                  Добавить пакет
                </button>
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Валютные паки (для бесплатных сундуков)</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>ID</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Название</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Валюта</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Amount</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Базовый вес</th>
                  </tr>
                </thead>
                <tbody>
                  {(balance.economy.currencyPacks ?? []).map((pack) => (
                    <tr key={pack.id}>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{pack.id}</td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input
                          style={inputStyle}
                          value={pack.name}
                          onChange={(e) => setBalance((prev) => ({
                            ...prev,
                            economy: {
                              ...prev.economy,
                              currencyPacks: (prev.economy.currencyPacks ?? []).map((x) => x.id === pack.id ? { ...x, name: e.target.value } : x),
                            },
                          }))}
                        />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <select
                          style={inputStyle}
                          value={pack.currency}
                          onChange={(e) => setBalance((prev) => ({
                            ...prev,
                            economy: {
                              ...prev.economy,
                              currencyPacks: (prev.economy.currencyPacks ?? []).map((x) => x.id === pack.id ? { ...x, currency: e.target.value as 'soft' | 'hard' } : x),
                            },
                          }))}
                        >
                          <option value="soft">soft</option>
                          <option value="hard">hard</option>
                        </select>
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input
                          style={inputStyle}
                          type="number"
                          value={pack.amount}
                          onChange={(e) => setBalance((prev) => ({
                            ...prev,
                            economy: {
                              ...prev.economy,
                              currencyPacks: (prev.economy.currencyPacks ?? []).map((x) => x.id === pack.id ? { ...x, amount: Math.max(0, Number(e.target.value) || 0) } : x),
                            },
                          }))}
                        />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input
                          style={inputStyle}
                          type="number"
                          step="0.01"
                          value={pack.baseWeight}
                          onChange={(e) => setBalance((prev) => ({
                            ...prev,
                            economy: {
                              ...prev.economy,
                              currencyPacks: (prev.economy.currencyPacks ?? []).map((x) => x.id === pack.id ? { ...x, baseWeight: Math.max(0, Number(e.target.value) || 0) } : x),
                            },
                          }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginBottom: 10, borderTop: '1px solid rgba(148, 163, 184, 0.24)', paddingTop: 8 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>
                Бесплатные сундуки (1 дроп за открытие)
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.45 }}>
                <strong style={{ color: '#94a3b8' }}>Только ключи, без таймера 5–15–30 мин.</strong> За попытку уровня: победа +{keyProg.keysPerWin}{' '}
                ключа, поражение +{keyProg.keysPerLoss}. После {keyProg.keysToOpenChest} ключей открывается следующий бесплатный сундук по
                порядку списка ниже (цикл). Ниже три сундука — это содержимое (дроп), а не три таймера; старая выдача по минутам в прогнозе
                не используется. При винрейте 50% в среднем ~{keysPerAttemptAt50.toFixed(2)} ключа за попытку (~
                {(keyProg.keysToOpenChest / keysPerAttemptAt50).toFixed(2)} попыток на один сундук).
              </div>
              {hasHiddenLegacyFreeChests && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#fde68a',
                    marginBottom: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(251, 191, 36, 0.35)',
                    background: 'rgba(120, 53, 15, 0.35)',
                    lineHeight: 1.45,
                  }}
                >
                  В файле баланса ещё лежат устаревшие <code style={{ color: '#fef9c3' }}>free_5m</code> /{' '}
                  <code style={{ color: '#fef9c3' }}>free_15m</code> / <code style={{ color: '#fef9c3' }}>free_30m</code> — ниже в списке
                  показывается только актуальный цикл по ключам. Нажмите жёлтую кнопку, чтобы удалить дубли из данных.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: 8, marginBottom: 8 }}>
                <label>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Ключей за победу</div>
                  <input
                    style={inputStyle}
                    type="number"
                    step="0.1"
                    min={0}
                    value={balance.economy.freeChestKeyProgression?.keysPerWin ?? 1}
                    onChange={(e) =>
                      setFreeChestKeyProgressionField(setBalance, {
                        keysPerWin: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </label>
                <label>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Ключей за поражение</div>
                  <input
                    style={inputStyle}
                    type="number"
                    step="0.1"
                    min={0}
                    value={balance.economy.freeChestKeyProgression?.keysPerLoss ?? 0.5}
                    onChange={(e) =>
                      setFreeChestKeyProgressionField(setBalance, {
                        keysPerLoss: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </label>
                <label>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>Ключей на 1 сундук</div>
                  <input
                    style={inputStyle}
                    type="number"
                    step="0.5"
                    min={0.5}
                    value={balance.economy.freeChestKeyProgression?.keysToOpenChest ?? 3}
                    onChange={(e) =>
                      setFreeChestKeyProgressionField(setBalance, {
                        keysToOpenChest: Math.max(0.5, Number(e.target.value) || 3),
                      })
                    }
                  />
                </label>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' }}>
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
                  onClick={applyReferenceFreeChestsPreset}
                >
                  Прессет: 3★ сундука + ключи (1 / 0,5 / 3)
                </button>
                {hasHiddenLegacyFreeChests && (
                  <button
                    type="button"
                    onClick={stripLegacyFreeChestsFromBalance}
                    style={{
                      border: '1px solid rgba(251, 191, 36, 0.5)',
                      borderRadius: 999,
                      background: 'rgba(120, 53, 15, 0.5)',
                      color: '#fef3c7',
                      padding: '6px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Убрать из списка дубли «5м / 15м / 30м» (оставить только цикл по ключам)
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(130px, 1fr))', gap: 8, marginBottom: 8 }}>
                <input style={inputStyle} placeholder="id" value={newFreeChestId} onChange={(e) => setNewFreeChestId(e.target.value)} />
                <input style={inputStyle} placeholder="Название" value={newFreeChestName} onChange={(e) => setNewFreeChestName(e.target.value)} />
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
                  onClick={addFreeChest}
                >
                  Добавить бесплатный сундук
                </button>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {freeChests.map((ch) => (
                  <div
                    key={ch.id}
                    style={{
                      border: '1px solid rgba(148, 163, 184, 0.24)',
                      borderRadius: 10,
                      padding: 10,
                      background: 'rgba(15, 23, 42, 0.45)',
                    }}
                  >
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{ch.name}</div>
                      <div style={{ color: '#94a3b8', fontSize: 12 }}>ID: {ch.id}</div>
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Паки валюты</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {(balance.economy.currencyPacks ?? []).map((pack) => (
                          <label key={`${ch.id}_${pack.id}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={ch.packIds.includes(pack.id)}
                              onChange={() => toggleFreeChestPack(ch.id, pack.id)}
                            />
                            {pack.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Редкости чертежей</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((rarity) => (
                          <label key={`${ch.id}_${rarity}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={ch.blueprintRarities.includes(rarity)}
                              onChange={() => toggleFreeChestRarity(ch.id, rarity)}
                            />
                            {rarity}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px', lineHeight: 1.45 }}>
              Таблица ниже — только <strong style={{ color: '#94a3b8' }}>платные</strong> сундуки (<code style={{ color: '#cbd5e1' }}>economy.chests</code>
              ): цена в монетах/золоте и веса редкостей карт. <strong style={{ color: '#94a3b8' }}>Бесплатные</strong> сундуки по ключам настраиваются{' '}
              <strong>в блоке выше</strong> (паки и чертежи), сюда они не попадают — у них другая модель дропа (ровно 1 награда за открытие).
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Тип</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Цена soft</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Цена gold</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Карт</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Common</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Uncommon</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Rare</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Epic</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Legendary</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {chestIds.map((chestId) => {
                  const chest = balance.economy.chests[chestId];
                  if (!chest) return null;
                  const drops = chest.dropChancesPercent ?? {
                    common: 0,
                    uncommon: 0,
                    rare: 0,
                    epic: 0,
                    legendary: 0,
                  };
                  return (
                    <tr key={chestId}>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        {chestId}
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} type="number" value={chest.priceSoft} onChange={(e) => setChestField(setBalance, chestId, { priceSoft: Number(e.target.value) || 0 })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} type="number" value={chest.priceHard ?? 0} onChange={(e) => setChestField(setBalance, chestId, { priceHard: Number(e.target.value) || 0 })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} type="number" value={chest.cards} onChange={(e) => setChestField(setBalance, chestId, { cards: Number(e.target.value) || 0 })} />
                      </td>
                      {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((key) => (
                        <td key={key} style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                          <input style={inputStyle} type="number" value={drops[key]} onChange={(e) => setChestChance(setBalance, chestId, key, Number(e.target.value) || 0)} />
                        </td>
                      ))}
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <button
                          type="button"
                          style={{
                            border: '1px solid rgba(239, 68, 68, 0.45)',
                            borderRadius: 999,
                            background: 'rgba(127, 29, 29, 0.85)',
                            color: '#fee2e2',
                            padding: '4px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                          onClick={() => removeChest(chestId)}
                          disabled={chestIds.length <= 1}
                        >
                          Удалить
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 12, borderTop: '1px solid rgba(148, 163, 184, 0.24)', paddingTop: 10 }}>
              <h5 style={{ marginTop: 0, marginBottom: 8 }}>Симулятор сундуков (как в скриптах)</h5>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                Выбери один или несколько сундуков и их количество. Для бесплатных сундуков учитывается 1 дроп на сундук.
              </div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Источник</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Тип</th>
                    <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Кол-во</th>
                  </tr>
                </thead>
                <tbody>
                  {chestIds.map((id) => (
                    <tr key={`sim_paid_${id}`}>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{id}</td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Платный</td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input
                          style={inputStyle}
                          type="number"
                          min={0}
                          value={simChestQtyById[id] ?? 0}
                          onChange={(e) => setSimChestQtyById((prev) => ({ ...prev, [id]: Math.max(0, Number(e.target.value) || 0) }))}
                        />
                      </td>
                    </tr>
                  ))}
                  {freeChests.map((c) => (
                    <tr key={`sim_free_${c.id}`}>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{c.name}</td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Бесплатный</td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input
                          style={inputStyle}
                          type="number"
                          min={0}
                          value={simChestQtyById[c.id] ?? 0}
                          onChange={(e) => setSimChestQtyById((prev) => ({ ...prev, [c.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))', gap: 8, marginTop: 8 }}>
                <select style={inputStyle} value={simCardId} onChange={(e) => setSimCardId(Number(e.target.value) || simCardId)}>
                  {balance.supportCards.map((c) => (
                    <option key={c.id} value={c.id}>{c.id}. {c.name}</option>
                  ))}
                </select>
                <input
                  style={inputStyle}
                  type="number"
                  min={1}
                  value={simNeedBlueprints}
                  onChange={(e) => setSimNeedBlueprints(Math.max(1, Number(e.target.value) || 1))}
                  placeholder="Нужно чертежей"
                />
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
                  onClick={runChestSimulation}
                >
                  Симулировать
                </button>
              </div>
              {simResult && (
                <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                  <div>Итог: дропов {simResult.totalDrops}, целевая карточка: {simResult.targetCardBlueprints} чертежей.</div>
                  <div>Затраты: soft {Math.round(simResult.softSpent)}, hard {Math.round(simResult.hardSpent)}.</div>
                  <div>Финальный шанс целевой карточки за 1 дроп: {simResult.chanceTargetCardPercent.toFixed(2)}%</div>
                  <div>
                    Финальные шансы редкостей за 1 дроп:&nbsp;
                    {Object.entries(simResult.chanceByRarityPercent)
                      .map(([r, p]) => `${r}: ${p.toFixed(1)}%`)
                      .join(' | ')}
                  </div>
                  <div>
                    Оценка на {simNeedBlueprints} чертежей: {simResult.cyclesForTarget == null ? 'недостижимо в текущей конфигурации' : `${simResult.cyclesForTarget.toFixed(2)} циклов симуляции`}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <strong style={{ color: '#e2e8f0' }}>Шансы всех предметов за 1 дроп:</strong>
                    <table style={{ ...tableStyle, marginTop: 6 }}>
                      <thead>
                        <tr>
                          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Предмет</th>
                          <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Шанс</th>
                        </tr>
                      </thead>
                      <tbody>
                        {simResult.chanceByItemPercent.map((row) => (
                          <tr key={row.name}>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{row.name}</td>
                            <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{row.chancePercent.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="ui-subcard">
            <h4>Магазин</h4>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 0, marginBottom: 10, lineHeight: 1.45 }}>
              <strong style={{ color: '#cbd5e1' }}>≈ USD (курс)</strong> — золото/монеты через{' '}
              <code style={{ color: '#e2e8f0' }}>referencePacks</code> / VIP (как раньше).{' '}
              <strong style={{ color: '#cbd5e1' }}>≈ $ гринд</strong> — сколько «референсных $ за попытку» эквивалентно цене:{' '}
              (монеты / наша средняя награда за попытку) × ref $/попытку; пересчитывается при изменении наград,{' '}
              <code style={{ color: '#e2e8f0' }}>referenceAvgRewardPerAttemptSoft</code> и IAP-монет. Нужны{' '}
              <code style={{ color: '#e2e8f0' }}>referencePacks</code> + пакет <code style={{ color: '#e2e8f0' }}>currency_soft</code> для цен в золоте.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Товар</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Тип</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Кол-во</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Soft</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Gold</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>Базовый вес</th>
                  <th style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>USD</th>
                  <th
                    style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}
                    title="Курс из referencePacks / обмен золото↔монета"
                  >
                    ≈ USD (курс)
                  </th>
                  <th
                    style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}
                    title="Цена в монетах / наша средняя награда × ref $ за попытку"
                  >
                    ≈ $ гринд
                  </th>
                </tr>
              </thead>
              <tbody>
                {balance.economy.shopItems.map((item) => {
                  const usd = getShopItemUsd(item, rates);
                  const grindUsd = getShopItemGrindReferenceUsd(balance, item, rewardComparison);
                  return (
                    <tr key={item.id}>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} value={item.name} onChange={(e) => setShopItemField(setBalance, item.id, { name: e.target.value })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} value={item.type} onChange={(e) => setShopItemField(setBalance, item.id, { type: e.target.value })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} type="number" value={item.quantity} onChange={(e) => setShopItemField(setBalance, item.id, { quantity: Number(e.target.value) || 0 })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} type="number" value={item.priceSoft} onChange={(e) => setShopItemField(setBalance, item.id, { priceSoft: Number(e.target.value) || 0 })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} type="number" value={item.priceHard} onChange={(e) => setShopItemField(setBalance, item.id, { priceHard: Number(e.target.value) || 0 })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} type="number" step="0.01" value={item.baseWeight ?? 1} onChange={(e) => setShopItemField(setBalance, item.id, { baseWeight: Number(e.target.value) || 0 })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        <input style={inputStyle} type="number" step="0.01" value={item.priceUsd ?? 0} onChange={(e) => setShopItemField(setBalance, item.id, { priceUsd: Number(e.target.value) || 0 })} />
                      </td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>{usd > 0 ? `$${usd.toFixed(2)}` : '—'}</td>
                      <td style={{ border: '1px solid rgba(148, 163, 184, 0.24)', padding: 4 }}>
                        {grindUsd != null && grindUsd > 0 ? `$${grindUsd.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
