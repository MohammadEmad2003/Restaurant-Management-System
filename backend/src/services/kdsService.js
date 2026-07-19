import { repo } from '../repositories/index.js';
import { HttpError } from '../middleware/errorHandler.js';

export const kdsService = {
  /** Active tickets (not yet served), with elapsed prep timer. */
  async tickets() {
    const rows = (await repo('kdsTickets').getAll()).filter((t) => t.status !== 'served');
    return rows
      .map((t) => ({ ...t, elapsedSeconds: Math.floor((Date.now() - (t.startedAt || t.createdAt)) / 1000) }))
      .sort((a, b) => {
        const w = { high: 0, normal: 1, low: 2 };
        return (w[a.priority] - w[b.priority]) || (a.startedAt - b.startedAt);
      });
  },

  async setStatus(id, status, user) {
    const ticket = await repo('kdsTickets').getById(id);
    if (!ticket) throw new HttpError(404, 'ticket not found');
    const patch = { status };
    if (status === 'ready') patch.readyAt = Date.now();
    return repo('kdsTickets').update(id, patch);
  },
};

export default kdsService;
