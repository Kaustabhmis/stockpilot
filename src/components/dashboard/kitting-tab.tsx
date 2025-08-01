'use client';
import type { ProcessedData } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { InteractiveKitting } from '../interactive-kitting';

interface KittingTabProps {
  data: ProcessedData['kitting'];
}

export function KittingTab({ data }: KittingTabProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {data.kitAnalysis.map(kit => (
        <Card key={kit.kitId}>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle>{kit.kitCode} - {kit.kitName}</CardTitle>
                        <CardDescription>Analysis based on current component stock.</CardDescription>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-bold text-primary">{kit.maxPossibleKits}</div>
                        <div className="text-sm text-muted-foreground">Max Possible Kits</div>
                    </div>
                </div>
            </CardHeader>
          <CardContent>
            <InteractiveKitting kit={kit} materialsWithStock={data.materialsWithStock} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
