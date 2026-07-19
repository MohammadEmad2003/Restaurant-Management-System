import { createCrudService } from './baseService.js';

const base = createCrudService('suppliers', { entityName: 'supplier' });

export const supplierService = { ...base };
