'use client';

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { AIPurchaseRecommendation } from '@/lib/types';

interface AiRecommendationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendations: AIPurchaseRecommendation[];
}

export function AiRecommendationsModal({ isOpen, onClose, recommendations }: AiRecommendationsModalProps) {
  const getPriorityVariant = (priority: string): 'destructive' | 'secondary' | 'default' | 'outline' => {
      switch (priority) {
          case 'critical': return 'destructive';
          case 'high': return 'secondary';
          case 'medium': return 'default';
          default: return 'outline';
      }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>AI-Powered Purchase Recommendations</DialogTitle>
          <DialogDescription>
            The AI has analyzed your inventory and generated the following purchase suggestions.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Suggested Qty</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Reasoning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recommendations.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={4} className="text-center">
                        No AI recommendations generated. Your stock levels might be healthy.
                    </TableCell>
                </TableRow>
              ) : (
                recommendations.map((item) => (
                    <TableRow key={item.materialCode}>
                    <TableCell>
                        <div className="font-medium">{item.materialCode}</div>
                        <div className="text-sm text-muted-foreground">{item.materialName}</div>
                    </TableCell>
                    <TableCell className="font-medium">{item.suggestedQuantity}</TableCell>
                    <TableCell>
                        <Badge variant={getPriorityVariant(item.priority)}>{item.priority.toUpperCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{item.reasoning}</TableCell>
                    </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
