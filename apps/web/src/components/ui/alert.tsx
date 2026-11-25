import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative flex gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-card',
        info: 'border-primary/25 bg-primary/5 [&>svg]:text-primary',
        warning: 'border-warning/30 bg-warning/8 [&>svg]:text-warning',
        destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
        success: 'border-success/30 bg-success/8 [&>svg]:text-success',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role="status" className={cn(alertVariants({ variant }), className)} {...props} />;
}
