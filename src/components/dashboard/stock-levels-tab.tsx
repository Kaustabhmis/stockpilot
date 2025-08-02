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
import { Progress } from '@/components/ui/progress';
import { SummaryCard } from '../summary-card';
import type { MaterialWithStatus, ProcessedData } from '@/lib/types';
import { BarChartBig, AlertTriangle, BellRing, CheckCircle, PackageSearch, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { formatCurrency } from '@/lib/utils';

interface StockLevelsTabProps {
  data: ProcessedData['stock'];
  onAddMovement: (material: MaterialWithStatus) => void;
}

export function StockLevelsTab({ data, onAddMovement }: StockLevelsTabProps) {
  const getStatusVariant = (status: string): 'destructive' | 'secondary' | 'default' => {
    if (status === 'red') return 'destructive';
    if (status === 'yellow') return 'secondary';
    return 'default';
  };
  
  const getProgressColor = (status: string) => {
    if (status === 'red') return "bg-red-500";
    if (status === 'yellow') return "bg-yellow-500";
    return "bg-green-500";
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
        <SummaryCard title="Today's Inventory Cost" value={formatCurrency(data.summary.totalInventoryValue)} icon={<DollarSign className="h-4 w-4 text-green-500"/>} colorClass="text-green-500" />
        <SummaryCard title="Total Materials" value={data.summary.totalMaterials} icon={<PackageSearch className="h-4 w-4" />} />
        <SummaryCard title="Critical Items" value={data.summary.criticalItems} icon={<AlertTriangle className="h-4 w-4 text-red-500"/>} colorClass="text-red-500" />
        <SummaryCard title="Warning Items" value={data.summary.warningItems} icon={<BellRing className="h-4 w-4 text-yellow-500"/>} colorClass="text-yellow-500" />
        <SummaryCard title="Normal Items" value={data.summary.normalItems} icon={<CheckCircle className="h-4 w-4 text-green-500"/>} colorClass="text-green-500" />
        <SummaryCard title="Constraints" value={data.summary.constraints} icon={<BarChartBig className="h-4 w-4 text-purple-500"/>} colorClass="text-purple-500" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Stock Levels</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Current Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Utilization</TableHead>
                  <TableHead>Lead Time</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.stockLevels.map(item => (
                  <TableRow key={item.id} className={item.isConstraint ? 'bg-purple-50 dark:bg-purple-900/20' : ''}>
                    <TableCell>
                      <div className="font-medium">{item.materialCode}</div>
                      <div className="text-sm text-muted-foreground">{item.materialName}</div>
                    </TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>
                      <div className="font-medium">{item.currentQuantity} {item.unitOfMeasure}</div>
                      <div className="text-xs text-muted-foreground">Safety: {item.safetyStock} | Reorder: {item.reorderPoint}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(item.status)}>{item.statusText}</Badge>
                      {item.isConstraint && <div className="text-xs text-purple-600 mt-1 font-semibold">⚠️ Constraint</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={item.utilizationRate} indicatorClassName={getProgressColor(item.status)} className="w-24 h-1.5" />
                        <span className="text-sm text-muted-foreground">{item.utilizationRate}%</span>
                      </div>
                    </TableCell>
                    <TableCell>{item.leadTimeDays} days</TableCell>
                    <TableCell>
                      <Button variant="link" className="p-0 h-auto" onClick={() => onAddMovement(item)}>Add Movement</Button>
                    </TableCell>
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
