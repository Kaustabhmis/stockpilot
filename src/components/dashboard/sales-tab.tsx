'use client';
import { useState, useEffect } from 'react';
import type { Kit, Sale } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface SalesTabProps {
  kits: Kit[];
  sales: Sale[];
  onSave: (data: { kitCode: string; quantity: number; }) => void;
}

export function SalesTab({ kits, sales, onSave }: SalesTabProps) {
  const [kitCode, setKitCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (kits.length > 0 && !kitCode) {
      setKitCode(kits[0].kitCode);
    }
  }, [kits, kitCode]);

  const handleSave = () => {
    const qty = parseInt(quantity, 10);
    if (!kitCode || !qty || qty <= 0) {
      toast({
        variant: 'destructive',
        title: 'Invalid Input',
        description: 'Please select a finished good and enter a valid quantity.',
      });
      return;
    }
    onSave({ kitCode, quantity: qty });
    setQuantity('');
    toast({
        title: 'Sale Recorded',
        description: `Sale of ${qty} x ${kitCode} has been recorded successfully.`,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Record Finished Good Sale</CardTitle>
          <CardDescription>This will automatically deduct components from stock based on the BOM.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="kit-select">Finished Good</Label>
            <Select value={kitCode} onValueChange={setKitCode}>
                <SelectTrigger id="kit-select">
                    <SelectValue placeholder="Select a kit" />
                </SelectTrigger>
                <SelectContent>
                    {kits.map(k => <SelectItem key={k.id} value={k.kitCode}>{k.kitCode} - {k.kitName}</SelectItem>)}
                </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="quantity-input">Quantity Sold</Label>
            <Input
              id="quantity-input"
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="Enter quantity"
            />
          </div>
          <Button onClick={handleSave} className="w-full">Record Sale</Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Recent Sales</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Finished Good</TableHead>
                <TableHead>Quantity Sold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map(s => (
                <TableRow key={s.id}>
                  <TableCell>{formatDate(s.timestamp)}</TableCell>
                  <TableCell className="font-medium">{s.kitCode}</TableCell>
                  <TableCell>{s.quantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
