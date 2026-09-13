import * as React from "react";

import { Input } from "@/components/ui/input";
import { CURRENCY_SYMBOL } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A money field: the currency symbol sits inside the field, so the label does not
 * have to name the currency.
 *
 * WHY THIS EXISTS. Every money field used to be hand-rolled, and they had drifted
 * apart in ways a user could feel. Nine of them: two were plain text inputs with
 * only `inputMode="decimal"` (no `type="number"`, so no numeric validation and no
 * spinner), several were missing `min` or `step="0.01"`, and only four rendered the
 * `$` prefix. The other five compensated by appending `(AUD)` to their label —
 * which is how thirteen labels ended up hardcoding the currency while the fields
 * themselves said nothing.
 *
 * The value is a DOLLAR STRING, deliberately. Money is integer cents everywhere
 * else, but a controlled numeric input has to hold a half-typed value: parsing to
 * cents on every keystroke destroys "1." and "0.0" as the user types them. Each
 * caller converts at submit.
 */
export interface MoneyInputProps
  extends Omit<React.ComponentProps<"input">, "type" | "inputMode" | "size"> {
  /**
   * Smallest accepted amount, in dollars. Defaults to `'0'` because most amounts
   * here may legitimately be free (postage included in the price, a $0 throw-in
   * line). Pass `'0.01'` where zero is not a real answer, e.g. an asking price.
   */
  min?: string;
  /**
   * `lg` when the amount is the POINT of the surface rather than one field among
   * several — the price on a private-deal invite, where every other control exists
   * to describe what the money is for.
   *
   * A PROP RATHER THAN A CALLER CLASS, because the currency symbol is positioned
   * absolutely and set in `text-body`: passing `className="text-head"` scales the
   * number and leaves the `$` small and vertically off, which is exactly the kind
   * of near-miss that had nine hand-rolled money fields drifting apart before this
   * component existed. Size is decided here so the symbol moves with it.
   */
  size?: "default" | "lg";
}

const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ className, min = "0", placeholder = "0.00", size = "default", ...props }, ref) => {
    const large = size === "lg";
    return (
      <div className="relative">
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
            large ? "left-4 text-head" : "left-3 text-body",
          )}
          aria-hidden
        >
          {CURRENCY_SYMBOL}
        </span>
        <Input
          ref={ref}
          type="number"
          inputMode="decimal"
          autoComplete="off"
          min={min}
          step="0.01"
          placeholder={placeholder}
          // `pl-7` clears the symbol. Merged rather than overridden so a caller can
          // still add its own classes without losing the offset.
          //
          // `tabular-nums` on the large variant only: at display size the digits are
          // wide enough that proportional figures make the number jump sideways as it
          // is typed.
          className={cn(
            large
              ? "h-14 pl-11 text-head font-semibold tabular-nums md:h-14"
              : "pl-7",
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";

export { MoneyInput };
