import { repo } from '../repositories/index.js';
import { recordAudit } from '../middleware/audit.js';
import { HttpError } from '../middleware/errorHandler.js';

export const loyaltyService = {
  async get(clientId) {
    const client = await repo('clients').getById(clientId);
    if (!client) throw new HttpError(404, 'client not found');
    const tx = (await repo('loyaltyTx').getAll({ clientId })).sort((a, b) => b.createdAt - a.createdAt);
    return {
      clientId, name: client.name,
      points: client.loyaltyPoints || 0,
      visits: client.visitCount || 0,
      preferences: client.preferences || [],
      history: tx,
    };
  },

  async redeem(clientId, points, user) {
    const client = await repo('clients').getById(clientId);
    if (!client) throw new HttpError(404, 'client not found');
    if ((client.loyaltyPoints || 0) < points) throw new HttpError(400, 'Insufficient points');
    const updated = await repo('clients').update(clientId, {
      loyaltyPoints: (client.loyaltyPoints || 0) - points,
    });
    await repo('loyaltyTx').create({ clientId, points: -points, type: 'redeem', date: new Date().toISOString().slice(0, 10) });
    await recordAudit(user, 'LOYALTY_REDEEMED', 'clients', clientId, { after: updated });
    return { points: updated.loyaltyPoints };
  },
};

export default loyaltyService;
