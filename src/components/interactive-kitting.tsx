'use client';
import { useState } from 'react';
import type { KitWithAnalysis, MaterialWithStatus } from '@/lib/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface InteractiveKittingProps {
  kit: KitWithAnalysis;
  materialsWithStock: MaterialWithStatus[];
}

interface CheckResult {
  required: (typeof kit.bom[0] & { requiredQty: number; availableQty: number; hasEnough: boolean })[];
  canProduce: boolean;
}

export function InteractiveKitting({ kit, materialsWithStock }: InteractiveKittingProps) {
  const [quantity, setQuantity] = useState(1);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);

  const handleCheck = () => {
    const required = kit.bom.map(comp => {
      const material = materialsWithStock.find(m => m.materialCode === comp.materialCode);
      const requiredQty = comp.quantityPerKit * quantity;
      const availableQty = material ? material.currentQuantity : 0;
      return { ...comp, requiredQty, availableQty, hasEnough: availableQty >= requiredQty };
    });
    const canProduce = required.every(r => r.hasEnough);
    setCheckResult({ required, canProduce });
  };

  return (
    <div className="mt-4 p-4 bg-secondary/50 rounded-lg">
      <h4 className="text-md font-semibold text-foreground mb-3">Check Production Run</h4>
      <div className="flex items-center space-x-3">
        <Input
          type="number"
          value={quantity}
          onChange={e => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="w-24"
        />
        <Button onClick={handleCheck}>Check Availability</Button>
      </div>
      {checkResult && (
        <div className="mt-4">
          <div className={`flex items-center text-md font-bold ${checkResult.canProduce ? 'text-green-600' : 'text-red-600'}`}>
            {checkResult.canProduce ? <CheckCircle2 className="mr-2 h-5 w-5"/> : <AlertCircle className="mr-2 h-5 w-5"/>}
            {checkResult.canProduce ? `Yes, you can produce ${quantity} kit(s).` : `No, you cannot produce ${quantity} kit(s).`}
          </div>
          <ul className="text-sm text-foreground space-y-1 mt-3">
            {checkResult.required.map(r => (
              <li key={r.materialCode} className={`flex justify-between items-center p-2 rounded-md ${r.hasEnough ? 'bg-green-100 dark:bg-green-900/20' : 'bg-red-100 dark:bg-red-900/20'}`}>
                <span>{r.materialCode} - {r.materialName}</span>
                <span className="font-mono text-xs">Required: {r.requiredQty} | Available: {r.availableQty}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
