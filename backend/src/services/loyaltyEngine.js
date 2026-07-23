import { repo } from '../repositories/index.js';

/**
 * Automated loyalty engine — evaluates three triggers after an order is completed:
 *  1. Order value threshold  → earn points proportional to spend
 *  2. Visit count milestone  → bonus points when visitCount reaches a threshold
 *  3. Random selection       → probabilistic surprise reward
 *
 * Returns the total points earned and an array of reason strings.
 */
export async function evaluateLoyaltyReward(order, settings, user) {
  const { clientId } = order;
  if (!clientId) return { points: 0, reasons: [] };

  const client = await repo('clients').getById(clientId);
  if (!client) return { points: 0, reasons: [] };
  if (user?.restaurantId && client.restaurantId !== user.restaurantId) return { points: 0, reasons: [] };

  let totalPoints = 0;
  const reasons = [];

  // Trigger 1: Order value threshold
  const orderValue = order.totalPrice || 0;
  if (orderValue >= (settings.loyaltyMinOrderValue || 0) && settings.loyaltyRate > 0) {
    const earned = Math.floor(orderValue * settings.loyaltyRate);
    totalPoints += earned;
    reasons.push(`Earned ${earned} points (order value)`);
  }

  // Trigger 2: Visit count milestone
  const currentVisits = (client.visitCount || 0) + 1; // this order counts as a visit
  if (settings.loyaltyVisitThreshold > 0 && settings.loyaltyBonusPoints > 0) {
    const prevMilestone = Math.floor((currentVisits - 1) / settings.loyaltyVisitThreshold);
    const newMilestone = Math.floor(currentVisits / settings.loyaltyVisitThreshold);
    if (newMilestone > prevMilestone) {
      totalPoints += settings.loyaltyBonusPoints;
      reasons.push(`Milestone bonus: ${settings.loyaltyBonusPoints} points (visit #${currentVisits})`);
    }
  }

  // Trigger 3: Random selection
  if (settings.loyaltyRandomChance > 0 && Math.random() < settings.loyaltyRandomChance) {
    totalPoints += settings.loyaltyRandomPoints;
    reasons.push(`Surprise reward: ${settings.loyaltyRandomPoints} points (random)`);
  }

  // Apply rewards to client
  if (totalPoints > 0) {
    await repo('clients').update(clientId, {
      loyaltyPoints: (client.loyaltyPoints || 0) + totalPoints,
      visitCount: currentVisits,
    });
    await repo('loyaltyTx').create({
      clientId,
      points: totalPoints,
      type: 'earn',
      reasons,
      orderId: order.id,
      date: new Date().toISOString().slice(0, 10),
      restaurantId: client.restaurantId,
    });
  }

  return { points: totalPoints, reasons };
}

export default evaluateLoyaltyReward;
