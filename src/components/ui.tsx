import { cva, type VariantProps } from "class-variance-authority";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium transition-opacity disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:opacity-90",
        coal: "bg-coal text-coal-fg hover:opacity-90",
        outline: "border border-border bg-card text-fg hover:bg-surface",
      },
      size: {
        md: "h-11 px-4 text-[0.9375rem]",
        lg: "h-12 px-5 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-muted", className)} {...props} />;
}

const fieldClass =
  "h-11 w-full rounded-[var(--radius-sm)] border border-border bg-card px-3 text-base text-fg outline-none placeholder:text-subtle focus:border-primary";

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClass, "h-auto min-h-24 py-2", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClass, className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-[var(--radius-lg)] border border-border bg-card p-4", className)} {...props} />
  );
}
