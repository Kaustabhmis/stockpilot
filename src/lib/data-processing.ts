import type { Material, Kit, StockMovement, Sale, ProcessedData, MaterialWithStock, PurchaseRecommendation } from './types';

export const processAllData = (
    materials: Material[], 
    kits: Kit[], 
    stockMovements: StockMovement[], 
    sales: Sale[]
): ProcessedData | null => {
    
    if (!materials.length) return null;

    const materialsWithStock: MaterialWithStock[] = materials.map(m => {
        const stockIn = stockMovements.filter(sm => sm.materialId === m.id && sm.type === 'in').reduce((sum, sm) => sum + sm.quantity, 0);
        const stockOut = stockMovements.filter(sm => sm.materialId === m.id && sm.type === 'out').reduce((sum, sm) => sum + sm.quantity, 0);
        const currentQuantity = stockIn - stockOut;
        return { ...m, currentQuantity };
    });

    const totalInventoryValue = materialsWithStock.reduce((sum, m) => sum + (m.currentQuantity * m.costPerUnit), 0);

    const materialsWithStatus = materialsWithStock.map(m => {
        const safetyStock = Number(m.safetyStock); 
        const reorderPoint = Number(m.reorderPoint);
        let status: 'red' | 'yellow' | 'green';
        let statusText: string;

        if (m.currentQuantity <= safetyStock) { 
            status = 'red'; statusText = 'Critical'; 
        } else if (m.currentQuantity <= reorderPoint) { 
            status = 'yellow'; statusText = 'Warning'; 
        } else { 
            status = 'green'; statusText = 'Normal'; 
        }
        const utilizationRate = reorderPoint > 0 ? Math.round(((reorderPoint - m.currentQuantity) / (reorderPoint - safetyStock)) * 100) : 0;
        return { ...m, status, statusText, utilizationRate: Math.max(0, Math.min(100, utilizationRate)), isConstraint: false };
    });

    const kitAnalysis = kits.map(kit => {
        let maxPossibleKits = Infinity;
        let bottleneck = null;
        const bomWithDetails = kit.bom.map(component => {
            const materialInfo = materialsWithStatus.find(m => m.materialCode === component.materialCode);
            if (!materialInfo) return { ...component, available: 0, materialName: 'N/A' };
            const possible = Math.floor(materialInfo.currentQuantity / component.quantityPerKit);
            if (possible < maxPossibleKits) {
                maxPossibleKits = possible;
                bottleneck = materialInfo;
            }
            return { ...component, available: materialInfo.currentQuantity, materialName: materialInfo.materialName };
        });

        if (maxPossibleKits === Infinity) maxPossibleKits = 0;
        const dailyDemand = Number(kit.dailyDemand) || 1;
        const daysLeft = dailyDemand > 0 ? Math.floor(maxPossibleKits / dailyDemand) : Infinity;

        return { ...kit, maxPossibleKits, isComplete: maxPossibleKits > 0, bom: bomWithDetails, bottleneck, daysLeft, dailyDemand };
    });
    
    const constrainedMaterials = new Set(kitAnalysis.filter(k => !k.isComplete && k.bottleneck).map(k => k.bottleneck!.materialCode));
    const finalMaterialsWithStatus = materialsWithStatus.map(m => ({ ...m, isConstraint: constrainedMaterials.has(m.materialCode) }))
        .sort((a, b) => {
            const statusValue = { red: 3, yellow: 2, green: 1 };
            return statusValue[b.status] - statusValue[a.status];
        });

    const materialsInShortage = materialsWithStatus.filter(m => m.status === 'red' || m.status === 'yellow');
    const recommendations: PurchaseRecommendation[] = materialsInShortage.map(m => {
        const leadTime = Number(m.leadTimeDays);
        const dailyConsumption = kits.reduce((acc, kit) => {
            const bomItem = kit.bom.find(item => item.materialCode === m.materialCode);
            return acc + (bomItem ? (kit.dailyDemand * bomItem.quantityPerKit) : 0);
        }, 0) || ((m.reorderPoint - m.safetyStock) / 30) || 1; // Fallback logic

        const daysUntilStockout = dailyConsumption > 0 ? Math.round((m.currentQuantity - m.safetyStock) / dailyConsumption) : 999;
        const orderDate = new Date();
        orderDate.setDate(orderDate.getDate() + Math.max(0, daysUntilStockout - leadTime));
        
        let priority: 'critical' | 'high' | 'medium' | 'low' = 'low';
        let urgency: string, reasoning: string;

        if (m.status === 'red') {
            priority = 'critical';
            urgency = 'Order Immediately';
            reasoning = `Stock is at or below safety level. Potential production stoppage.`;
        } else { // yellow status
            priority = daysUntilStockout < leadTime ? 'high' : 'medium';
            urgency = daysUntilStockout < leadTime ? 'Urgent' : 'Order Soon';
            reasoning = `Stock is below reorder point. Order to prevent falling to safety stock levels.`;
        }
        
        const suggestedQuantity = Number(m.reorderPoint) * 2 - m.currentQuantity;
        return {
            materialId: m.id,
            materialCode: m.materialCode,
            materialName: m.materialName,
            currentQuantity: m.currentQuantity,
            suggestedQuantity: Math.max(0, Math.ceil(suggestedQuantity)),
            priority,
            urgency,
            suggestedOrderDate: orderDate.toLocaleDateString('en-CA'),
            estimatedCost: Math.max(0, Math.ceil(suggestedQuantity)) * Number(m.costPerUnit),
            daysUntilStockout: Math.max(0, daysUntilStockout),
            reasoning,
            constraintLevel: m.status === 'red' ? 'high' : 'low'
        };
    }).sort((a, b) => {
        const priorityValue = { critical: 3, high: 2, medium: 1, low: 0 };
        return priorityValue[b.priority] - priorityValue[a.priority];
    });

    return {
        stock: {
            summary: {
                totalInventoryValue,
                totalMaterials: materials.length,
                criticalItems: materialsWithStatus.filter(m => m.status === 'red').length,
                warningItems: materialsWithStatus.filter(m => m.status === 'yellow').length,
                normalItems: materialsWithStatus.filter(m => m.status === 'green').length,
                constraints: constrainedMaterials.size,
            },
            stockLevels: finalMaterialsWithStatus,
        },
        purchase: {
            summary: {
                totalRecommendations: recommendations.length,
                criticalItems: recommendations.filter(r => r.priority === 'critical').length,
                highPriorityItems: recommendations.filter(r => r.priority === 'high').length,
                mediumPriorityItems: recommendations.filter(r => r.priority === 'medium').length,
                totalEstimatedCost: recommendations.reduce((sum, r) => sum + r.estimatedCost, 0),
                immediateActions: recommendations.filter(r => r.urgency === 'Order Immediately').length
            },
            recommendations
        },
        kitting: {
            kitAnalysis,
            materialsWithStock: finalMaterialsWithStatus
        },
        forecast: {
            kitAnalysis: kitAnalysis.sort((a,b) => a.daysLeft - b.daysLeft)
        },
        materials,
        sales: sales.sort((a,b) => b.timestamp.seconds - a.timestamp.seconds),
        kits,
    };
};
