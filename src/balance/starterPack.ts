import { getAverageAttemptRewardSoft } from './economy';
import type { BalanceConstants } from './model';

export interface ResolvedStarterPackGrants {
  priceHard: number;
  soft: number;
  chestOpens: { chestId: string; count: number }[];
}

/** Реф. бронза/серебро/золото → наши id сундуков common / rare / epic. */
export function refStarterChestTierToOurChestId(tier: 'bronze' | 'silver' | 'gold'): string {
  if (tier === 'bronze') return 'common';
  if (tier === 'silver') return 'rare';
  return 'epic';
}

/**
 * Содержимое стартера для магазина и прогноза: масштаб по (наш priceHard / реф. priceGold)
 * и корректировка монет по паритету средней награды за попытку (реф. / наш), если оба заданы.
 */
export function resolveStarterPackGrants(
  constants: BalanceConstants,
  options?: { ourAvgRewardPerAttemptSoft?: number }
): ResolvedStarterPackGrants | null {
  const refPack = constants.economy.referencePacks?.starterPack;
  const shopItem = constants.economy.shopItems.find((i) => i.id === 'shop_starter_pack');
  if (!refPack || !shopItem || refPack.priceGold <= 0) return null;
  if (shopItem.type !== 'pack') return null;

  const priceHard = Math.max(0, shopItem.priceHard ?? 0);
  if (priceHard <= 0) return null;

  const goldScale = priceHard / refPack.priceGold;
  let soft = refPack.soft * goldScale;

  const refAvg = constants.economy.referenceAvgRewardPerAttemptSoft ?? 0;
  const override = constants.economy.ourAvgRewardPerAttemptSoftOverride ?? 0;
  const ourAvg =
    options?.ourAvgRewardPerAttemptSoft ??
    (override > 0 ? override : getAverageAttemptRewardSoft(constants));
  if (refAvg > 0 && ourAvg > 0) {
    soft *= refAvg / ourAvg;
  }

  const chestOpens: { chestId: string; count: number }[] = [];
  const pushChest = (tier: 'bronze' | 'silver' | 'gold', refCount?: number) => {
    if (refCount == null || refCount <= 0) return;
    const scaled = Math.max(0, Math.round(refCount * goldScale));
    if (scaled <= 0) return;
    const chestId = refStarterChestTierToOurChestId(tier);
    if (constants.economy.chests[chestId]) {
      chestOpens.push({ chestId, count: scaled });
    }
  };
  pushChest('bronze', refPack.chestBronze);
  pushChest('silver', refPack.chestSilver);
  pushChest('gold', refPack.chestGold);

  return {
    priceHard,
    soft: Math.max(0, Math.round(soft)),
    chestOpens,
  };
}
