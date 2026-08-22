import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { generateDisplayId } from "@/lib/money";
import { auth } from "@/lib/auth";

interface CartItemInput {
  productId: string;
  variantId: string;
  size: string;
  qty: number;
}

interface CreateOrderBody {
  orderId?: string;
  items: CartItemInput[];
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  shippingAddress: { line1: string; line2?: string; city: string; state: string; pincode: string };
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Sign in required to check out" }, { status: 401 });
    }
    const userId = (session.user as { id: string }).id;

    const body = (await req.json()) as CreateOrderBody;

    if (!body.items?.length) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // Re-price every item from the database. Never trust amounts sent by the client.
    const products = await prisma.product.findMany({
      where: { id: { in: body.items.map((i) => i.productId) } },
      include: { variants: true },
    });

    let subtotal = 0;
    const orderItemsData = body.items.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      const variant = product?.variants.find((v) => v.id === item.variantId);
      if (!product || !variant) throw new Error(`Product or variant not found: ${item.productId}`);
      if (variant.stock < item.qty) throw new Error(`Insufficient stock for ${product.name} (${item.size})`);

      subtotal += product.price * item.qty;
      return {
        productId: product.id,
        variantId: variant.id,
        name: product.name,
        size: variant.size,
        unitPrice: product.price,
        qty: item.qty,
      };
    });

    const shippingFee = subtotal >= 299900 ? 0 : 9900; // free above ₹2,999, else ₹99 — adjust as needed
    const total = subtotal + shippingFee;

    let order;
    if (body.orderId) {
      const existingOrder = await prisma.order.findUnique({
        where: { id: body.orderId },
      });

      if (existingOrder && existingOrder.userId === userId && existingOrder.status === "PENDING") {
        order = await prisma.$transaction(async (tx) => {
          await tx.orderItem.deleteMany({ where: { orderId: existingOrder.id } });
          return tx.order.update({
            where: { id: existingOrder.id },
            data: {
              customerName: body.customerName,
              customerPhone: body.customerPhone,
              customerEmail: body.customerEmail,
              shippingAddress: body.shippingAddress,
              subtotal,
              shippingFee,
              total,
              items: { create: orderItemsData },
            },
          });
        });
      } else if (existingOrder && existingOrder.status === "PAID") {
        return NextResponse.json({
          orderId: existingOrder.id,
          alreadyPaid: true,
        });
      }
    }

    if (!order) {
      order = await prisma.order.create({
        data: {
          displayId: generateDisplayId(),
          userId,
          customerName: body.customerName,
          customerPhone: body.customerPhone,
          customerEmail: body.customerEmail,
          shippingAddress: body.shippingAddress,
          subtotal,
          shippingFee,
          total,
          status: "PENDING",
          items: { create: orderItemsData },
        },
      });
    }

    const razorpay = getRazorpay();
    const rzpOrder = await razorpay.orders.create({
      amount: total,
      currency: "INR",
      receipt: order.displayId,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: { razorpayOrderId: rzpOrder.id },
    });

    return NextResponse.json({
      orderId: order.id,
      razorpayOrderId: rzpOrder.id,
      amount: total,
      currency: "INR",
    });
  } catch (err) {
    console.error("[create-order Error]:", err);
    const rawMessage = err instanceof Error ? err.message : "";
    const isUserSafeError =
      rawMessage.startsWith("Product or variant not found") ||
      rawMessage.startsWith("Insufficient stock") ||
      rawMessage.startsWith("Cart is empty") ||
      rawMessage.startsWith("Sign in required");

    const clientMessage = isUserSafeError
      ? rawMessage
      : "Something went wrong creating your order. Please try again.";

    return NextResponse.json({ error: clientMessage }, { status: 400 });
  }
}
