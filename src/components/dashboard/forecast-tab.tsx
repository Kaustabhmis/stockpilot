'use client';
import type { ProcessedData } from '@/lib/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { AlertTriangle } from 'lucide-react';

interface ForecastTabProps {
  data: ProcessedData['forecast'];
}

export function ForecastTab({ data }: ForecastTabProps) {
    
    const getBorderColor = (daysLeft: number) => {
        if (daysLeft <= 3) return 'border-l-red-500';
        if (daysLeft <= 7) return 'border-l-yellow-500';
        return 'border-l-green-500';
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Manufacturing Forecast</CardTitle>
                    <CardDescription>
                    This forecast shows how many days you can continue manufacturing each finished good based on current component stock and estimated daily demand.
                    </CardDescription>
                </CardHeader>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {data.kitAnalysis.map(kit => (
                <Card key={kit.kitId} className={`border-l-4 ${getBorderColor(kit.daysLeft)}`}>
                    <CardHeader>
                        <div className="flex justify-between items-start">
                            <div>
                                <CardTitle>{kit.kitCode} - {kit.kitName}</CardTitle>
                                <CardDescription>Est. Daily Demand: {kit.dailyDemand}</CardDescription>
                            </div>
                            <div className="text-right">
                                <div className="text-4xl font-bold text-foreground">{kit.daysLeft < 0 ? 0 : kit.daysLeft}</div>
                                <p className="text-sm text-muted-foreground">Days Left</p>
                            </div>
                        </div>
                    </CardHeader>
                    {kit.bottleneck && (
                    <CardFooter className="text-sm bg-secondary/50 p-4 rounded-b-lg">
                        <div className="flex items-start text-destructive">
                            <AlertTriangle className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
                            <div>
                                <p className="font-semibold">Bottleneck Component:</p>
                                <p className="text-destructive/80">{kit.bottleneck.materialCode} - {kit.bottleneck.materialName} (Can only make {kit.maxPossibleKits} more kits)</p>
                            </div>
                        </div>
                    </CardFooter>
                    )}
                </Card>
            ))}
            </div>
        </div>
    );
}
