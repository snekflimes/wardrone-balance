import type { BalanceConstants } from '../balance/model';
import {
  getExpectedCopiesOfSingleCardPerChest,
  pickBestChestByRarityHardEfficiency,
} from './iapAndChestsModel';
import { pickBestSupportCardFeedCandidate } from './supportCardFeedCandidates';

/** Покупаем по 1 сундуку за шаг, чтобы хард распределялся между картами, а не вливался в одну «лучшую». */
const MAX_HARD_SPEND_STEPS = 25000;

/**
 * Весь накопленный хард тратим на платные сундуки (EV чертежей на выбранную карту), пока хватает priceHard.
 * Используется в прогнозе для бесплатников (логин/бесплатные сундуки) и для доли доната в золото у платящих.
 */
export function spendAllHardOnSupportChestsExpected(
  constants: BalanceConstants,
  hardBudget: number,
  supportCardLevels: Record<number, number>,
  supportCardBlueprints: Record<number, number>,
  gameLevelIndex: number,
  recordPaidChestOpens?: (chestId: string, count: number) => void
): { hardRemaining: number; supportCardBlueprints: Record<number, number> } {
  let h = Math.max(0, hardBudget);
  const bp = { ...supportCardBlueprints };

  for (let step = 0; step < MAX_HARD_SPEND_STEPS && h > 1e-9; step += 1) {
    const candidate = pickBestSupportCardFeedCandidate(
      constants,
      { supportCardLevels, supportCardBlueprints: bp },
      gameLevelIndex
    );
    if (!candidate) break;

    const chestId = pickBestChestByRarityHardEfficiency(constants, candidate.card.rarity);
    const chest = constants.economy.chests[chestId];
    const priceHard = chest?.priceHard ?? 0;
    if (!chest || priceHard <= 0) break;

    const perChest = getExpectedCopiesOfSingleCardPerChest(constants, chestId, candidate.card.rarity);
    if (perChest <= 0) break;

    const affordable = Math.floor(h / priceHard);
    if (affordable <= 0) break;

    const buy = Math.min(1, affordable);
    h -= buy * priceHard;
    bp[candidate.card.id] = (bp[candidate.card.id] ?? 0) + perChest * buy;
    recordPaidChestOpens?.(chestId, buy);
  }

  return { hardRemaining: h, supportCardBlueprints: bp };
}
