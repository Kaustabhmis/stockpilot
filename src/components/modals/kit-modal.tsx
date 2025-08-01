'use client';

import { useForm, useFieldArray } from 'react-hook-form';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Material, Kit } from '@/lib/types';
import { Trash2, PlusCircle } from 'lucide-react';

const bomItemSchema = z.object({
  materialCode: z.string().min(1, 'Material must be selected'),
  quantityPerKit: z.coerce.number().min(0.001, 'Qty must be positive'),
});

const formSchema = z.object({
  kitCode: z.string().min(1, 'Kit Code is required'),
  kitName: z.string().min(1, 'Kit Name is required'),
  dailyDemand: z.coerce.number().min(0, 'Daily Demand must be non-negative'),
  bom: z.array(bomItemSchema).min(1, 'At least one BOM component is required'),
});

type KitFormValues = z.infer<typeof formSchema>;

interface KitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<Kit, 'id'>) => void;
  kit: Omit<Kit, 'id'> | null;
  materials: Material[];
}

export function KitModal({ isOpen, onClose, onSave, kit, materials }: KitModalProps) {
  const form = useForm<KitFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: kit || {
      kitCode: '',
      kitName: '',
      dailyDemand: 0,
      bom: [{ materialCode: '', quantityPerKit: 1 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'bom',
  });

  const onSubmit = (data: KitFormValues) => {
    onSave(data);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{kit ? 'Edit Kit / BOM' : 'Create New Kit / BOM'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField control={form.control} name="kitCode" render={({ field }) => (<FormItem><FormLabel>Kit Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="kitName" render={({ field }) => (<FormItem><FormLabel>Kit Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="dailyDemand" render={({ field }) => (<FormItem><FormLabel>Daily Demand</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>)} />
            </div>

            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-2">Bill of Materials (BOM)</h3>
              <div className="space-y-3">
                {fields.map((item, index) => (
                  <div key={item.id} className="flex items-start space-x-2">
                    <FormField
                      control={form.control}
                      name={`bom.${index}.materialCode`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger><SelectValue placeholder="Select a material" /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {materials.map(m => <SelectItem key={m.id} value={m.materialCode}>{m.materialCode} - {m.materialName}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                     <FormField
                        control={form.control}
                        name={`bom.${index}.quantityPerKit`}
                        render={({ field }) => (
                            <FormItem className="w-28">
                                <FormControl>
                                    <Input type="number" placeholder="Qty" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Button type="button" variant="destructive" size="icon" onClick={() => remove(index)} className="mt-1"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
               <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => append({ materialCode: '', quantityPerKit: 1 })}>
                 <PlusCircle className="mr-2 h-4 w-4" /> Add Component
               </Button>
               <FormField control={form.control} name="bom" render={() => <FormMessage />} />
            </div>

            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit">Save Kit</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
