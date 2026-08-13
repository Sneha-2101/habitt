import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "admin@habitt.in" },
    update: { passwordHash: adminPasswordHash },
    create: {
      email: "admin@habitt.in",
      name: "Habitt Admin",
      passwordHash: adminPasswordHash,
      role: "OWNER",
    },
  });

  const sample = [
    { name: "Oxford Weave Shirt", category: "SHIRTS", price: 249000, description: "Heavyweight cotton oxford, garment-washed." },
    { name: "Brushed Twill Overshirt", category: "OVERSHIRTS", price: 429000, description: "Brushed cotton twill, relaxed fit." },
    { name: "Piqué Knit Polo", category: "POLOS", price: 189000, description: "Textured piqué knit polo." },
  ] as const;

  for (const p of sample) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await prisma.product.upsert({
      where: { slug },
      update: {},
      create: {
        name: p.name,
        slug,
        description: p.description,
        category: p.category,
        price: p.price,
        status: "ACTIVE",
        variants: {
          create: ["S", "M", "L", "XL", "XXL"].map((size) => ({ size: size as never, stock: 10 })),
        },
      },
    });
  }

  console.log("Seed complete. Admin login: admin@habitt.in / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
