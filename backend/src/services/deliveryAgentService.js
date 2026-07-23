import { createCrudService } from './baseService.js';

export const deliveryAgentService = createCrudService('deliveryAgents', { entityName: 'deliveryAgent' });

export default deliveryAgentService;
