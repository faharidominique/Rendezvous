// prisma/seed-bulk-dc.js — Seeds the bulk DC venue list
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const venues = require('./dc-venues-bulk.json');

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${venues.length} venues...`);
  let created = 0, updated = 0, failed = 0;

  for (const v of venues) {
    try {
      const result = await prisma.spot.upsert({
        where: { name_neighborhood: { name: v.name, neighborhood: v.neighborhood } },
        update: {
          vibeTags:      v.vibeTags,
          energyScore:   v.energyScore,
          socialScore:   v.socialScore,
          priceTier:     v.priceTier,
          isActive:      true,
          lastVerifiedAt: new Date(),
        },
        create: {
          name:            v.name,
          category:        v.category,
          neighborhood:    v.neighborhood,
          city:            v.city,
          lat:             v.lat,
          lng:             v.lng,
          vibeTags:        v.vibeTags,
          priceTier:       v.priceTier,
          energyScore:     v.energyScore,
          socialScore:     v.socialScore,
          hours:           v.hours,
          visitDuration:   v.visitDuration,
          groupSizeMin:    v.groupSizeMin,
          groupSizeMax:    v.groupSizeMax,
          bookingRequired: v.bookingRequired,
          source:          v.source,
          isActive:        v.isActive,
        },
      });
      console.log(`  ✓ ${v.name} (${v.neighborhood})`);
      created++;
    } catch (err) {
      console.warn(`  ✗ ${v.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${created} upserted, ${failed} failed.`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
