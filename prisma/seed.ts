import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;

  if (!ownerEmail) {
    throw new Error("OWNER_EMAIL environment variable is required to seed owner account.");
  }

  if (!ownerPassword || ownerPassword.length < 12) {
    throw new Error("SEED_OWNER_PASSWORD environment variable is required (min 12 characters).");
  }

  const existingOwner = await prisma.user.findUnique({
    where: { email: ownerEmail },
  });

  if (!existingOwner) {
    const adminPasswordHash = await hash(ownerPassword, 10);
    await prisma.user.create({
      data: {
        email: ownerEmail,
        name: "Habitt Owner",
        passwordHash: adminPasswordHash,
        role: "OWNER",
      },
    });
    console.log(`Created owner account for ${ownerEmail}`);
  } else {
    console.log(`Owner account ${ownerEmail} already exists. Leaving password untouched.`);
  }

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

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
