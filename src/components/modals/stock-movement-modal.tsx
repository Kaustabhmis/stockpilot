'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { MaterialWithStock } from '@/lib/types';

const formSchema = z.object({
  type: z.enum(['in', 'out']),
  quantity: z.coerce.number().positive('Quantity must be a positive number'),
  notes: z.string().optional(),
});

type MovementFormValues = z.infer<typeof formSchema>;

interface StockMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: MovementFormValues & { materialId: string, materialCode: string }) => void;
  material: MaterialWithStock | null;
}

export function StockMovementModal({ isOpen, onClose, onSave, material }: StockMovementModalProps) {
  const form = useForm<MovementFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { type: 'in', quantity: undefined, notes: '' },
  });

  if (!material) return null;

  const onSubmit = (data: MovementFormValues) => {
    onSave({ ...data, materialId: material.id, materialCode: material.materialCode });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Stock Movement</DialogTitle>
          <DialogDescription>
            Material: <span className="font-semibold">{material.materialCode} - {material.materialName}</span>
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Movement Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="in">Stock In (Receive)</SelectItem>
                      <SelectItem value="out">Stock Out (Consume/Adjust)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Enter quantity" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="e.g., PO #12345, consumed for Job #678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit">Save Movement</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
