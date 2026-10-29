import { PaymentMethod } from "@prisma/client";

export type ShippingNote = "FREE_PREPAID" | "FREE_THRESHOLD" | "CHARGED" | "NONE";

export interface ShippingSettingsInput {
  shippingFee: number;
  freeShippingThreshold: number;
  freeShippingOnPrepaid: boolean;
  codFeeEnabled: boolean;
  codFee: number;
}

export interface CalcShippingParams {
  paymentMethod: PaymentMethod | string;
  subtotal: number;
  settings: ShippingSettingsInput;
}

export interface ShippingCalculationResult {
  shippingFee: number;
  codFee: number;
  shippingNote: ShippingNote;
}

export function calcShippingAndFees({
  paymentMethod,
  subtotal,
  settings,
}: CalcShippingParams): ShippingCalculationResult {
  const isPrepaid = paymentMethod === "RAZORPAY" || paymentMethod === "STORE_CREDIT";
  const isCod = paymentMethod === "COD";

  let shippingFee: number;
  let shippingNote: ShippingNote;

  if (isPrepaid && settings.freeShippingOnPrepaid) {
    shippingFee = 0;
    shippingNote = "FREE_PREPAID";
  } else if (subtotal >= settings.freeShippingThreshold) {
    shippingFee = 0;
    shippingNote = "FREE_THRESHOLD";
  } else {
    shippingFee = settings.shippingFee;
    shippingNote = shippingFee === 0 ? "NONE" : "CHARGED";
  }

  const codFee = isCod && settings.codFeeEnabled ? settings.codFee : 0;

  return {
    shippingFee,
    codFee,
    shippingNote,
  };
}

