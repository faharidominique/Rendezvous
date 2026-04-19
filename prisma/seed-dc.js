// prisma/seed-dc.js — Seeds DC venues into the database
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const venues = require('./dc-venues-seed.json');

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${venues.length} DC venues...`);
  let created = 0, skipped = 0;

  for (const venue of venues) {
    try {
      await prisma.spot.upsert({
        where: { name_neighborhood: { name: venue.name, neighborhood: venue.neighborhood } },
        update: {
          energyScore: venue.energyScore,
          socialScore: venue.socialScore,
          vibeTags: venue.vibeTags,
          isActive: true,
          lastVerifiedAt: new Date(),
        },
        create: {
          name: venue.name,
          category: venue.category,
          neighborhood: venue.neighborhood,
          city: venue.city,
          address: venue.address || null,
          lat: venue.lat,
          lng: venue.lng,
          vibeTags: venue.vibeTags,
          priceTier: venue.priceTier,
          energyScore: venue.energyScore,
          socialScore: venue.socialScore,
          hours: venue.hours,
          visitDuration: venue.visitDuration,
          groupSizeMin: venue.groupSizeMin,
          groupSizeMax: venue.groupSizeMax,
          bookingRequired: venue.bookingRequired,
          bookingUrl: venue.bookingUrl || null,
          websiteUrl: venue.websiteUrl || null,
          description: venue.description || null,
          source: venue.source,
          isActive: venue.isActive,
        },
      });
      console.log(`  ✓ ${venue.name}`);
      created++;
    } catch (err) {
      console.warn(`  ✗ ${venue.name}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone: ${created} created/updated, ${skipped} skipped.`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
