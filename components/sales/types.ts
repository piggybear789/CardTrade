// components/sales/types.ts
// Client-safe delivery detail passed only after the server's RLS query authorizes it.

/** A selected residential address. Coordinates support provider integrity only. */
export interface CashSaleDeliveryAddress {
  label: string;
  placeId: string;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
}
