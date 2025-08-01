import type { Material, Kit } from './types';

export const MOCK_MATERIALS: Omit<Material, 'id'>[] = [
    { materialCode: 'RM-001', materialName: 'Steel Plate 5mm', category: 'Raw Material', unitOfMeasure: 'kg', safetyStock: 50, reorderPoint: 100, leadTimeDays: 15, costPerUnit: 80 },
    { materialCode: 'RM-002', materialName: 'Aluminum Rod 10mm', category: 'Raw Material', unitOfMeasure: 'm', safetyStock: 200, reorderPoint: 400, leadTimeDays: 10, costPerUnit: 150 },
    { materialCode: 'FP-001', materialName: 'M8x25 Bolt', category: 'Fastener', unitOfMeasure: 'pcs', safetyStock: 1000, reorderPoint: 2000, leadTimeDays: 7, costPerUnit: 5 },
    { materialCode: 'FP-002', materialName: 'M8 Nut', category: 'Fastener', unitOfMeasure: 'pcs', safetyStock: 1000, reorderPoint: 2000, leadTimeDays: 7, costPerUnit: 2 },
    { materialCode: 'EL-001', materialName: 'PCB Assembly A1', category: 'Electronics', unitOfMeasure: 'pcs', safetyStock: 20, reorderPoint: 40, leadTimeDays: 30, costPerUnit: 1200 },
    { materialCode: 'EL-002', materialName: 'Power Supply 12V', category: 'Electronics', unitOfMeasure: 'pcs', safetyStock: 10, reorderPoint: 25, leadTimeDays: 25, costPerUnit: 800 }
];

export const MOCK_KITS: Omit<Kit, 'id'>[] = [
    { kitCode: 'KIT-A', kitName: 'Main Assembly Frame', dailyDemand: 5, bom: [{ materialCode: 'RM-001', quantityPerKit: 5 }, { materialCode: 'RM-002', quantityPerKit: 2 }, { materialCode: 'FP-001', quantityPerKit: 16 }, { materialCode: 'FP-002', quantityPerKit: 16 }] }, 
    { kitCode: 'KIT-B', kitName: 'Control Box Assembly', dailyDemand: 10, bom: [{ materialCode: 'EL-001', quantityPerKit: 1 }, { materialCode: 'EL-002', quantityPerKit: 1 }, { materialCode: 'FP-001', quantityPerKit: 4 }] }
];
