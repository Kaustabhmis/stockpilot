'use client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SummaryCard } from '../summary-card';
import type { ProcessedData } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { AlertTriangle, BellRing, ClipboardCheck, DollarSign, ListTodo, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';

interface PurchasePlanningTabProps {
  data: ProcessedData['purchase'];
  onGenerateAiRecommendations: () => void;
  isAiLoading: boolean;
}

export function PurchasePlanningTab({ data, onGenerateAiRecommendations, isAiLoading }: PurchasePlanningTabProps) {
  const getPriorityVariant = (priority: string): 'destructive' | 'secondary' | 'default' => {
      switch (priority) {
          case 'critical': return 'destructive';
          case 'high': return 'secondary';
          case 'medium': return 'default';
          default: return 'default';
      }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <SummaryCard title="Total Recommendations" value={data.summary.totalRecommendations} icon={<ListTodo className="h-4 w-4"/>} />
        <SummaryCard title="Critical Items" value={data.summary.criticalItems} icon={<AlertTriangle className="h-4 w-4 text-red-500"/>} colorClass="text-red-500" />
        <SummaryCard title="High Priority" value={data.summary.highPriorityItems} icon={<BellRing className="h-4 w-4 text-orange-500"/>} colorClass="text-orange-500" />
        <SummaryCard title="Medium Priority" value={data.summary.mediumPriorityItems} icon={<BellRing className="h-4 w-4 text-yellow-500"/>} colorClass="text-yellow-500" />
        <SummaryCard title="Total Est. Cost" value={formatCurrency(data.summary.totalEstimatedCost)} icon={<DollarSign className="h-4 w-4 text-green-500"/>} colorClass="text-green-500" />
        <SummaryCard title="Immediate Actions" value={data.summary.immediateActions} icon={<ClipboardCheck className="h-4 w-4 text-purple-500"/>} colorClass="text-purple-500" />
      </div>

      <Card>
        <CardHeader className="flex-row justify-between items-start">
            <div>
                <CardTitle>Purchase Recommendations</CardTitle>
                <CardDescription>Based on reorder points, safety stock, and lead times.</CardDescription>
            </div>
            <Button onClick={onGenerateAiRecommendations} disabled={isAiLoading}>
                <Zap className="mr-2 h-4 w-4" />
                {isAiLoading ? 'Analyzing...' : 'Generate AI Recommendations'}
            </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>Suggested Qty</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Est. Cost</TableHead>
                  <TableHead>Reasoning</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recommendations.map(item => (
                  <TableRow key={item.materialId}>
                    <TableCell>
                      <div className="font-medium">{item.materialCode}</div>
                      <div className="text-sm text-muted-foreground">{item.materialName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{item.currentQuantity}</div>
                      <div className="text-xs text-muted-foreground">Stockout in ~{item.daysUntilStockout} days</div>
                    </TableCell>
                    <TableCell className="font-medium">{item.suggestedQuantity}</TableCell>
                    <TableCell>
                        <Badge variant={getPriorityVariant(item.priority)}>{item.priority.toUpperCase()}</Badge>
                        <div className="text-xs text-muted-foreground mt-1">{item.urgency}</div>
                    </TableCell>
                    <TableCell>{item.suggestedOrderDate}</TableCell>
                    <TableCell>{formatCurrency(item.estimatedCost)}</TableCell>
                    <TableCell className="max-w-xs">{item.reasoning}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
