'use client';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Material } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { PlusCircle } from 'lucide-react';

interface MaterialsTabProps {
  materials: Material[];
  onAddMaterial: () => void;
  onEditMaterial: (material: Material) => void;
}

export function MaterialsTab({ materials, onAddMaterial, onEditMaterial }: MaterialsTabProps) {
  return (
    <Card>
      <CardHeader className="flex-row justify-between items-start">
        <div>
          <CardTitle>Materials Master</CardTitle>
          <CardDescription>Manage all raw materials, components, and other items in the system.</CardDescription>
        </div>
        <Button onClick={onAddMaterial}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add New Material
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead>Safety Stock</TableHead>
                <TableHead>Reorder Point</TableHead>
                <TableHead>Lead Time</TableHead>
                <TableHead>Cost/Unit</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.materialCode}</div>
                    <div className="text-sm text-muted-foreground">{item.materialName}</div>
                  </TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell>{item.unitOfMeasure}</TableCell>
                  <TableCell>{item.safetyStock}</TableCell>
                  <TableCell>{item.reorderPoint}</TableCell>
                  <TableCell>{item.leadTimeDays} days</TableCell>
                  <TableCell>{formatCurrency(item.costPerUnit)}</TableCell>
                  <TableCell>
                    <Button variant="link" className="p-0 h-auto" onClick={() => onEditMaterial(item)}>Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
