'use client';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { ProcessedData, MaterialWithStatus, KitWithAnalysis } from '@/lib/types';
import { Printer } from 'lucide-react';

type ReportType = 'stock' | 'sales' | 'kitting' | 'forecast' | 'cost-stock' | 'inventory';

interface ReportTabProps {
  data: ProcessedData;
}

export function ReportTab({ data }: ReportTabProps) {
  const [reportType, setReportType] = useState<ReportType>('stock');
  const reportContentRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    window.print();
  };

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

  const renderReport = () => {
    switch (reportType) {
      case 'stock':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cost/Unit</TableHead>
                <TableHead>Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.stock.stockLevels.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.materialCode} - {item.materialName}</TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell>{item.currentQuantity} {item.unitOfMeasure}</TableCell>
                  <TableCell><Badge variant={getStatusVariant(item.status)}>{item.statusText}</Badge></TableCell>
                  <TableCell>{formatCurrency(item.costPerUnit)}</TableCell>
                  <TableCell>{formatCurrency(item.currentQuantity * item.costPerUnit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      case 'sales':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Finished Good</TableHead>
                <TableHead>Quantity Sold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sales.map(s => (
                <TableRow key={s.id}>
                  <TableCell>{formatDate(s.timestamp)}</TableCell>
                  <TableCell>{s.kitCode}</TableCell>
                  <TableCell>{s.quantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      case 'kitting':
        return (
            <div className="space-y-4">
            {data.kitting.kitAnalysis.map(kit => (
              <Card key={kit.id}>
                <CardHeader>
                  <CardTitle>{kit.kitCode} - {kit.kitName}</CardTitle>
                  <CardDescription>Max Possible Kits: <span className="font-bold text-primary">{kit.maxPossibleKits}</span></CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Component</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Available</TableHead>
                        <TableHead>Has Enough?</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kit.bom.map(c => (
                        <TableRow key={c.materialCode}>
                          <TableCell>{c.materialCode} - {c.materialName}</TableCell>
                          <TableCell>{c.quantityPerKit}</TableCell>
                          <TableCell>{c.available}</TableCell>
                          <TableCell>{c.available >= c.quantityPerKit ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        );
       case 'forecast':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kit</TableHead>
                <TableHead>Daily Demand</TableHead>
                <TableHead>Max Kits Possible</TableHead>
                <TableHead>Days of Production Left</TableHead>
                <TableHead>Bottleneck Component</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.forecast.kitAnalysis.map((kit) => (
                <TableRow key={kit.id}>
                  <TableCell>{kit.kitCode} - {kit.kitName}</TableCell>
                  <TableCell>{kit.dailyDemand}</TableCell>
                  <TableCell>{kit.maxPossibleKits}</TableCell>
                  <TableCell>{kit.daysLeft < 0 ? 0 : kit.daysLeft}</TableCell>
                  <TableCell>{kit.bottleneck ? `${kit.bottleneck.materialCode} - ${kit.bottleneck.materialName}` : 'None'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      case 'cost-stock':
         const costSortedStock = [...data.stock.stockLevels].sort((a,b) => (b.currentQuantity * b.costPerUnit) - (a.currentQuantity * a.costPerUnit));
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Cost/Unit</TableHead>
                <TableHead>Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costSortedStock.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.materialCode} - {item.materialName}</TableCell>
                  <TableCell>{item.currentQuantity} {item.unitOfMeasure}</TableCell>
                  <TableCell>{formatCurrency(item.costPerUnit)}</TableCell>
                  <TableCell>{formatCurrency(item.currentQuantity * item.costPerUnit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      case 'inventory':
         return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Safety Stock</TableHead>
                <TableHead>Reorder Point</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.stock.stockLevels.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.materialCode} - {item.materialName}</TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell>{item.currentQuantity} {item.unitOfMeasure}</TableCell>
                  <TableCell>{item.safetyStock}</TableCell>
                  <TableCell>{item.reorderPoint}</TableCell>
                  <TableCell><Badge variant={getStatusVariant(item.status)}>{item.statusText}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      default:
        return <p>Select a report type.</p>;
    }
  };
  
  const reportTitles = {
    stock: "Stock Report",
    sales: "Sales Report",
    kitting: "Kitting Analysis Report",
    forecast: "Forecast Report",
    'cost-stock': "Cost-wise Stock Report",
    inventory: "Current Inventory Report"
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle>Generate Reports</CardTitle>
                <CardDescription>Select a report type to generate and print.</CardDescription>
            </div>
            <div className="flex gap-2">
                <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
                    <SelectTrigger className="w-[250px]">
                        <SelectValue placeholder="Select report type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="stock">Stock Report</SelectItem>
                        <SelectItem value="inventory">Current Inventory Report</SelectItem>
                        <SelectItem value="cost-stock">Cost-wise Stock Report</SelectItem>
                        <SelectItem value="sales">Sales Report</SelectItem>
                        <SelectItem value="kitting">Kitting Analysis Report</SelectItem>
                        <SelectItem value="forecast">Forecast Report</SelectItem>
                    </SelectContent>
                </Select>
                <Button onClick={handlePrint} variant="outline">
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                </Button>
            </div>
        </div>
      </CardHeader>
      <CardContent>
        <div id="print-area" ref={reportContentRef}>
            <div className="report-header hidden print:block mb-4">
                <h1 className="text-2xl font-bold">StockPilot</h1>
                <h2 className="text-xl font-semibold text-muted-foreground">{reportTitles[reportType]}</h2>
                <p className="text-sm text-muted-foreground">Generated on: {new Date().toLocaleDateString()}</p>
            </div>
            {renderReport()}
        </div>
      </CardContent>
    </Card>
  );
}
