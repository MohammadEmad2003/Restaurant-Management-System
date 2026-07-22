import { config } from '../config/index.js';
import { sessionService } from '../services/sessionService.js';
import { logger } from '../utils/logger.js';

/**
 * Releases abandoned cashier/user session slots (crashed app, lost power,
 * closed tab that never hit /auth/logout) on a timer, per restaurant's
 * configurable session_timeout_minutes. Mirrors the existing syncEngine
 * setInterval pattern rather than adding a cron dependency.
 */
class SessionSweep {
  constructor() {
    this.timer = null;
  }

  start() {
    const tick = async () => {
      try {
        await sessionService.sweepExpiredSessions();
      } catch (err) {
        logger.error(`Session sweep failed: ${err.message}`);
      }
    };
    tick();
    this.timer = setInterval(tick, config.sessionSweepIntervalMs);
    logger.info(`Session sweep started (every ${config.sessionSweepIntervalMs}ms).`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

export const sessionSweep = new SessionSweep();
export default sessionSweep;
