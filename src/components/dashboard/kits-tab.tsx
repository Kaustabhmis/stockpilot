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
import type { Kit } from '@/lib/types';
import { PlusCircle } from 'lucide-react';

interface KitsTabProps {
  kits: Kit[];
  onAddKit: () => void;
  onEditKit: (kit: Kit) => void;
}

export function KitsTab({ kits, onAddKit, onEditKit }: KitsTabProps) {
  return (
    <Card>
      <CardHeader className="flex-row justify-between items-start">
        <div>
          <CardTitle>Kits / BOM Master</CardTitle>
          <CardDescription>Manage all finished goods and their Bill of Materials.</CardDescription>
        </div>
        <Button onClick={onAddKit}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add New Kit
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kit Code</TableHead>
                <TableHead>Kit Name</TableHead>
                <TableHead>Daily Demand</TableHead>
                <TableHead>Components</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kits.map((kit) => (
                <TableRow key={kit.id}>
                  <TableCell className="font-medium">{kit.kitCode}</TableCell>
                  <TableCell>{kit.kitName}</TableCell>
                  <TableCell>{kit.dailyDemand}</TableCell>
                  <TableCell>{kit.bom.length}</TableCell>
                  <TableCell>
                    <Button variant="link" className="p-0 h-auto" onClick={() => onEditKit(kit)}>Edit</Button>
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
