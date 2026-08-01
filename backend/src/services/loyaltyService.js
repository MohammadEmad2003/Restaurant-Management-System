import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';

export const loyaltyService = {
  async get(clientId, user) {
    const client = await repo('clients').getById(clientId);
    if (!client) throw new HttpError(404, 'client not found');
    if (user?.restaurantId && client.restaurantId && client.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'client not found');
    }
    const tx = (await repo('loyaltyTx').getAll({ clientId, restaurantId: user?.restaurantId })).sort((a, b) => b.createdAt - a.createdAt);
    return {
      clientId, name: client.name,
      points: client.loyaltyPoints || 0,
      visits: client.visitCount || 0,
      preferences: client.preferences || [],
      history: tx,
    };
  },

  async redeem(clientId, points, user) {
    // A non-positive or non-finite value would pass the balance check below
    // (or even increase the balance, since subtracting a negative number
    // adds it) — points redeemed must be a real positive amount.
    if (!Number.isFinite(points) || points <= 0) throw new HttpError(400, 'points must be a positive number');
    const client = await repo('clients').getById(clientId);
    if (!client) throw new HttpError(404, 'client not found');
    if (user?.restaurantId && client.restaurantId && client.restaurantId !== user.restaurantId) {
      throw new HttpError(404, 'client not found');
    }
    if ((client.loyaltyPoints || 0) < points) throw new HttpError(400, 'Insufficient points');
    const updated = await repo('clients').update(clientId, {
      loyaltyPoints: (client.loyaltyPoints || 0) - points,
    });
    await repo('loyaltyTx').create({ clientId, points: -points, type: 'redeem', date: new Date().toISOString().slice(0, 10), restaurantId: user?.restaurantId });
    return { points: updated.loyaltyPoints };
  },
};

export default loyaltyService;
