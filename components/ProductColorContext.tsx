"use client";

import React, { createContext, useContext, useState } from "react";

interface ProductColorContextValue {
  selectedColor: string;
  setSelectedColor: (color: string) => void;
}

const ProductColorContext = createContext<ProductColorContextValue | null>(null);

export function ProductColorProvider({
  initialColor = "",
  children,
}: {
  initialColor?: string;
  children: React.ReactNode;
}) {
  const [selectedColor, setSelectedColor] = useState(initialColor);

  return (
    <ProductColorContext.Provider value={{ selectedColor, setSelectedColor }}>
      {children}
    </ProductColorContext.Provider>
  );
}

export function useProductColor(): ProductColorContextValue | null {
  return useContext(ProductColorContext);
}
