import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();

  if (!ownerEmail) {
    throw new Error("OWNER_EMAIL environment variable is required to seed owner account.");
  }

  const existingOwner = await prisma.user.findUnique({
    where: { email: ownerEmail },
  });

  if (!existingOwner) {
    await prisma.user.create({
      data: {
        email: ownerEmail,
        name: "Habitt Owner",
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    console.log(`Created owner account for ${ownerEmail}`);
  } else {
    console.log(`Owner account ${ownerEmail} already exists. Leaving account untouched.`);
  }

  const existingAllowlist = await prisma.staffAllowlist.findUnique({
    where: { email: ownerEmail },
  });

  if (!existingAllowlist) {
    await prisma.staffAllowlist.create({
      data: {
        email: ownerEmail,
        role: "OWNER",
        active: true,
      },
    });
    console.log(`Created staff allowlist entry for ${ownerEmail}`);
  }

  const seedCategories = [
    { id: "cat_shirts", slug: "shirts", name: "Shirts", position: 0, sizes: ["S", "M", "L", "XL", "XXL"] },
    { id: "cat_overshirts", slug: "overshirts", name: "Overshirts", position: 1, sizes: ["S", "M", "L", "XL", "XXL"] },
    { id: "cat_polos", slug: "polos", name: "Polos", position: 2, sizes: ["S", "M", "L", "XL", "XXL"] },
    { id: "cat_trousers", slug: "trousers", name: "Trousers", position: 3, sizes: ["S", "M", "L", "XL", "XXL"] },
  ];

  for (const cat of seedCategories) {
    await prisma.category.upsert({
      where: { id: cat.id },
      update: { name: cat.name, position: cat.position, sizes: cat.sizes },
      create: { ...cat, active: true },
    });
  }

  const sample = [
    { name: "Oxford Weave Shirt", categoryId: "cat_shirts", price: 249000, description: "Heavyweight cotton oxford, garment-washed." },
    { name: "Brushed Twill Overshirt", categoryId: "cat_overshirts", price: 429000, description: "Brushed cotton twill, relaxed fit." },
    { name: "Piqué Knit Polo", categoryId: "cat_polos", price: 189000, description: "Textured piqué knit polo." },
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
        categoryId: p.categoryId,
        price: p.price,
        status: "ACTIVE",
        variants: {
          create: ["S", "M", "L", "XL", "XXL"].map((size) => ({ size, stock: 10 })),
        },
      },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
