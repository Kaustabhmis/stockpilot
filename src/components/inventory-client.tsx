'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

import { StockLevelsTab } from './dashboard/stock-levels-tab';
import { PurchasePlanningTab } from './dashboard/purchase-planning-tab';
import { ForecastTab } from './dashboard/forecast-tab';
import { KittingTab } from './dashboard/kitting-tab';
import { SalesTab } from './dashboard/sales-tab';
import { KitsTab } from './dashboard/kits-tab';
import { MaterialsTab } from './dashboard/materials-tab';
import { MaterialModal } from './modals/material-modal';
import { KitModal } from './modals/kit-modal';
import { StockMovementModal } from './modals/stock-movement-modal';
import { AiRecommendationsModal } from './modals/ai-recommendations-modal';

import { processAllData } from '@/lib/data-processing';
import { MOCK_MATERIALS, MOCK_KITS } from '@/lib/mock-data';
import useLocalStorage from '@/hooks/use-local-storage';
import { useToast } from '@/hooks/use-toast';
import { generatePurchaseRecommendations } from '@/lib/actions';
import type { Material, Kit, StockMovement, Sale, ProcessedData, MaterialWithStatus, AIPurchaseRecommendation } from '@/lib/types';
import { BarChartBig, ShoppingCart, TrendingUp, Package, DollarSign, ClipboardList, Settings, DatabaseZap } from 'lucide-react';

const TABS = [
    { id: "stock", label: "Stock Levels", icon: <BarChartBig className="h-4 w-4" /> },
    { id: "purchase", label: "Purchase Planning", icon: <ShoppingCart className="h-4 w-4" /> },
    { id: "forecast", label: "Forecast", icon: <TrendingUp className="h-4 w-4" /> },
    { id: "kitting", label: "Kitting Analysis", icon: <Package className="h-4 w-4" /> },
    { id: "sales", label: "Sales", icon: <DollarSign className="h-4 w-4" /> },
    { id: "kits", label: "Kits / BOM", icon: <ClipboardList className="h-4 w-4" /> },
    { id: "materials", label: "Materials", icon: <Settings className="h-4 w-4" /> },
];

export default function InventoryClient() {
    const { toast } = useToast();
    
    // State Management
    const [materials, setMaterials] = useLocalStorage<Material[]>('materials', []);
    const [kits, setKits] = useLocalStorage<Kit[]>('kits', []);
    const [stockMovements, setStockMovements] = useLocalStorage<StockMovement[]>('stockMovements', []);
    const [sales, setSales] = useLocalStorage<Sale[]>('sales', []);
    
    const [processedData, setProcessedData] = useState<ProcessedData | null>(null);
    const [loading, setLoading] = useState(true);
    const [isAiLoading, setIsAiLoading] = useState(false);

    // Modal State
    const [modal, setModal] = useState<'material' | 'kit' | 'movement' | 'ai' | null>(null);
    const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
    const [editingKit, setEditingKit] = useState<Kit | null>(null);
    const [selectedMaterialForMovement, setSelectedMaterialForMovement] = useState<MaterialWithStatus | null>(null);
    const [aiRecommendations, setAiRecommendations] = useState<AIPurchaseRecommendation[]>([]);

    useEffect(() => {
        setLoading(true);
        const data = processAllData(materials, kits, stockMovements, sales);
        setProcessedData(data);
        setLoading(false);
    }, [materials, kits, stockMovements, sales]);

    const handlePopulateData = () => {
        setMaterials(MOCK_MATERIALS.map(m => ({ ...m, id: crypto.randomUUID() })));
        setKits(MOCK_KITS.map(k => ({ ...k, id: crypto.randomUUID() })));
        setStockMovements([]);
        setSales([]);
        toast({ title: "Sample Data Populated!", description: "Add 'Stock In' movements to see the system work." });
    };

    // Handlers
    const handleSaveMaterial = (data: Omit<Material, 'id'>) => {
        if (editingMaterial) {
            setMaterials(prev => prev.map(m => m.id === editingMaterial.id ? { ...data, id: m.id } : m));
            toast({ title: 'Material Updated', description: `${data.materialName} has been updated.` });
        } else {
            setMaterials(prev => [...prev, { ...data, id: crypto.randomUUID() }]);
            toast({ title: 'Material Added', description: `${data.materialName} has been added.` });
        }
        setEditingMaterial(null);
    };

    const handleSaveKit = (data: Omit<Kit, 'id'>) => {
        if (editingKit) {
            setKits(prev => prev.map(k => k.id === editingKit.id ? { ...data, id: k.id } : k));
            toast({ title: 'Kit Updated', description: `${data.kitName} has been updated.` });
        } else {
            setKits(prev => [...prev, { ...data, id: crypto.randomUUID() }]);
            toast({ title: 'Kit Added', description: `${data.kitName} has been added.` });
        }
        setEditingKit(null);
    };

    const handleSaveMovement = (data: Omit<StockMovement, 'id' | 'timestamp'>) => {
        setStockMovements(prev => [...prev, { ...data, id: crypto.randomUUID(), timestamp: { seconds: Date.now() / 1000 } }]);
        toast({ title: 'Stock Movement Saved', description: `Recorded ${data.type} of ${data.quantity} for ${data.materialCode}.` });
    };

    const handleSaveSale = (data: Omit<Sale, 'id' | 'timestamp'>) => {
        const kit = kits.find(k => k.kitCode === data.kitCode);
        if (!kit) return;
        
        const newMovements: StockMovement[] = kit.bom.map(comp => {
            const material = materials.find(m => m.materialCode === comp.materialCode);
            if (!material) throw new Error(`Component not found: ${comp.materialCode}`);
            return {
                id: crypto.randomUUID(),
                materialId: material.id,
                materialCode: comp.materialCode,
                type: 'out',
                quantity: comp.quantityPerKit * data.quantity,
                notes: `Consumed for sale of ${data.quantity} x ${kit.kitCode}`,
                timestamp: { seconds: Date.now() / 1000 },
            };
        });

        setStockMovements(prev => [...prev, ...newMovements]);
        setSales(prev => [...prev, { ...data, id: crypto.randomUUID(), timestamp: { seconds: Date.now() / 1000 } }]);
    };

    const handleGenerateAiRecommendations = async () => {
        if (!processedData?.stock.stockLevels) return;
        setIsAiLoading(true);
        try {
            const input = {
                materials: processedData.stock.stockLevels.map(m => ({
                    materialCode: m.materialCode,
                    materialName: m.materialName,
                    currentQuantity: m.currentQuantity,
                    safetyStock: m.safetyStock,
                    reorderPoint: m.reorderPoint,
                    leadTimeDays: m.leadTimeDays,
                    costPerUnit: m.costPerUnit,
                    dailyDemand: kits.reduce((acc, kit) => {
                        const bomItem = kit.bom.find(item => item.materialCode === m.materialCode);
                        return acc + (bomItem ? (kit.dailyDemand * bomItem.quantityPerKit) : 0);
                    }, 0) || 1,
                }))
            };
            const recommendations = await generatePurchaseRecommendations(input);
            setAiRecommendations(recommendations);
            setModal('ai');
        } catch (error) {
            toast({ variant: 'destructive', title: "AI Error", description: (error as Error).message });
        } finally {
            setIsAiLoading(false);
        }
    };

    if (loading) {
        return <Skeleton className="w-full h-96" />;
    }

    if (materials.length === 0) {
        return (
             <Card className="text-center">
                <CardHeader>
                    <CardTitle>Welcome to StockPilot!</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground mb-4">Your inventory is empty. Populate it with sample data to get started.</p>
                    <Button onClick={handlePopulateData}><DatabaseZap className="mr-2 h-4 w-4" /> Populate with Sample Data</Button>
                </CardContent>
            </Card>
        );
    }
    
    return (
        <>
            <Tabs defaultValue="stock" className="w-full">
                <TabsList className="grid w-full grid-cols-3 md:grid-cols-4 lg:grid-cols-7 mb-4">
                    {TABS.map(tab => (
                        <TabsTrigger key={tab.id} value={tab.id} className="text-xs md:text-sm">
                            {tab.icon}<span className="hidden md:inline ml-2">{tab.label}</span>
                        </TabsTrigger>
                    ))}
                </TabsList>
                {processedData && (
                    <>
                        <TabsContent value="stock"><StockLevelsTab data={processedData.stock} onAddMovement={(m) => { setSelectedMaterialForMovement(m); setModal('movement'); }} /></TabsContent>
                        <TabsContent value="purchase"><PurchasePlanningTab data={processedData.purchase} onGenerateAiRecommendations={handleGenerateAiRecommendations} isAiLoading={isAiLoading} /></TabsContent>
                        <TabsContent value="forecast"><ForecastTab data={processedData.forecast} /></TabsContent>
                        <TabsContent value="kitting"><KittingTab data={processedData.kitting} /></TabsContent>
                        <TabsContent value="sales"><SalesTab kits={kits} sales={sales} onSave={handleSaveSale} /></TabsContent>
                        <TabsContent value="kits"><KitsTab kits={kits} onAddKit={() => { setEditingKit(null); setModal('kit'); }} onEditKit={(k) => { setEditingKit(k); setModal('kit'); }} /></TabsContent>
                        <TabsContent value="materials"><MaterialsTab materials={materials} onAddMaterial={() => { setEditingMaterial(null); setModal('material'); }} onEditMaterial={(m) => { setEditingMaterial(m); setModal('material'); }} /></TabsContent>
                    </>
                )}
            </Tabs>

            {modal === 'material' && <MaterialModal isOpen={modal === 'material'} onClose={() => setModal(null)} onSave={handleSaveMaterial} material={editingMaterial} />}
            {modal === 'kit' && <KitModal isOpen={modal === 'kit'} onClose={() => setModal(null)} onSave={handleSaveKit} kit={editingKit} materials={materials} />}
            {modal === 'movement' && <StockMovementModal isOpen={modal === 'movement'} onClose={() => setModal(null)} onSave={handleSaveMovement} material={selectedMaterialForMovement} />}
            {modal === 'ai' && <AiRecommendationsModal isOpen={modal === 'ai'} onClose={() => setModal(null)} recommendations={aiRecommendations} />}
        </>
    );
}
