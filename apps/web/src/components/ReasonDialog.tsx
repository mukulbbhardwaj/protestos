import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** Confirms an audited, hard-to-undo action (void, write off, delete), with a reason when asked. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  pending,
  onConfirm,
  withReason = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  action: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
  withReason?: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(reason);
          }}
          className="grid gap-4"
        >
          {withReason && (
            <Field label="Reason" htmlFor="reason" hint="Kept in the audit log.">
              <Input
                id="reason"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || (withReason && reason.trim().length < 3)}
            >
              {pending && <Loader2 className="animate-spin" />} {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
