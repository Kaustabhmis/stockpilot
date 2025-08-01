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
import type { Material } from '@/lib/types';

const formSchema = z.object({
  materialCode: z.string().min(1, 'Material Code is required'),
  materialName: z.string().min(1, 'Material Name is required'),
  category: z.string().min(1, 'Category is required'),
  unitOfMeasure: z.string().min(1, 'Unit of Measure is required'),
  safetyStock: z.coerce.number().min(0, 'Safety Stock must be non-negative'),
  reorderPoint: z.coerce.number().min(0, 'Reorder Point must be non-negative'),
  leadTimeDays: z.coerce.number().min(0, 'Lead Time must be non-negative'),
  costPerUnit: z.coerce.number().min(0, 'Cost must be non-negative'),
});

type MaterialFormValues = z.infer<typeof formSchema>;

interface MaterialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<Material, 'id'>) => void;
  material: Omit<Material, 'id' | 'currentQuantity'> | null;
}

export function MaterialModal({ isOpen, onClose, onSave, material }: MaterialModalProps) {
  const form = useForm<MaterialFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: material || {
      materialCode: '',
      materialName: '',
      category: '',
      unitOfMeasure: '',
      safetyStock: 0,
      reorderPoint: 0,
      leadTimeDays: 0,
      costPerUnit: 0,
    },
  });

  const onSubmit = (data: MaterialFormValues) => {
    onSave(data);
    onClose();
  };

  const formFields = [
    { name: 'materialCode', label: 'Material Code', type: 'text' },
    { name: 'materialName', label: 'Material Name', type: 'text' },
    { name: 'category', label: 'Category', type: 'text' },
    { name: 'unitOfMeasure', label: 'Unit of Measure', type: 'text' },
    { name: 'safetyStock', label: 'Safety Stock', type: 'number' },
    { name: 'reorderPoint', label: 'Reorder Point', type: 'number' },
    { name: 'leadTimeDays', label: 'Lead Time (Days)', type: 'number' },
    { name: 'costPerUnit', label: 'Cost Per Unit (INR)', type: 'number' },
  ] as const;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{material ? 'Edit Material' : 'Create New Material'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {formFields.map((fieldInfo) => (
                <FormField
                  key={fieldInfo.name}
                  control={form.control}
                  name={fieldInfo.name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{fieldInfo.label}</FormLabel>
                      <FormControl>
                        <Input type={fieldInfo.type} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit">Save Material</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
