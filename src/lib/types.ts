export interface Material {
  id: string;
  materialCode: string;
  materialName: string;
  category: string;
  unitOfMeasure: string;
  safetyStock: number;
  reorderPoint: number;
  leadTimeDays: number;
  costPerUnit: number;
}

export interface MaterialWithStock extends Material {
  currentQuantity: number;
}

export interface MaterialWithStatus extends MaterialWithStock {
  status: 'red' | 'yellow' | 'green';
  statusText: string;
  utilizationRate: number;
  isConstraint: boolean;
}

export interface BomItem {
  materialCode: string;
  quantityPerKit: number;
}

export interface BomItemWithDetails extends BomItem {
    available: number;
    materialName?: string;
}

export interface Kit {
  id: string;
  kitCode: string;
  kitName: string;
  dailyDemand: number;
  bom: BomItem[];
}

export interface KitWithAnalysis extends Kit {
    bom: BomItemWithDetails[];
    maxPossibleKits: number;
    isComplete: boolean;
    bottleneck: MaterialWithStatus | null;
    daysLeft: number;
}

export interface StockMovement {
  id: string;
  materialId: string;
  materialCode: string;
  type: 'in' | 'out';
  quantity: number;
  notes: string;
  timestamp: { seconds: number; };
}

export interface Sale {
  id: string;
  kitCode: string;
  quantity: number;
  timestamp: { seconds: number; };
}

export interface PurchaseRecommendation {
  materialId: string;
  materialCode: string;
  materialName: string;
  currentQuantity: number;
  suggestedQuantity: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  urgency: string;
  suggestedOrderDate: string;
  estimatedCost: number;
  daysUntilStockout: number;
  reasoning: string;
  constraintLevel: 'high' | 'low';
}

export type AIPurchaseRecommendation = {
    materialCode: string;
    materialName: string;
    suggestedQuantity: number;
    priority: "critical" | "high" | "medium" | "low";
    reasoning: string;
}


export interface ProcessedData {
  stock: {
    summary: {
      totalMaterials: number;
      criticalItems: number;
      warningItems: number;
      normalItems: number;
      constraints: number;
    };
    stockLevels: MaterialWithStatus[];
  };
  purchase: {
    summary: {
      totalRecommendations: number;
      criticalItems: number;
      highPriorityItems: number;
      mediumPriorityItems: number;
      totalEstimatedCost: number;
      immediateActions: number;
    };
    recommendations: PurchaseRecommendation[];
  };
  kitting: {
    kitAnalysis: KitWithAnalysis[];
    materialsWithStock: MaterialWithStatus[];
  };
  forecast: {
    kitAnalysis: KitWithAnalysis[];
  };
  materials: Material[];
  sales: Sale[];
  kits: Kit[];
}
