// prisma/seed.js
// Seeds the spot database with Washington DC locations for beta launch
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DC_SPOTS = [
  {
    name: 'Vinyl District', category: 'Record Store', neighborhood: 'U Street', city: 'Washington DC',
    address: '2010 U St NW, Washington, DC 20009', lat: 38.9169, lng: -77.0391,
    vibeTags: ['cozy', 'hidden gem', 'browsable', 'creative'],
    priceTier: 2, energyScore: 0.35, socialScore: 0.4,
    hours: { mon:'12:00-21:00', tue:'12:00-21:00', wed:'12:00-21:00', thu:'12:00-21:00', fri:'12:00-22:00', sat:'11:00-22:00', sun:'12:00-20:00' },
    visitDuration: 90, groupSizeMin: 2, groupSizeMax: 8,
    description: 'A legendary crate-digging spot tucked beneath U Street. Jazz, soul, and rare imports.',
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Compass Coffee', category: 'Café', neighborhood: 'Shaw', city: 'Washington DC',
    address: '1535 7th St NW, Washington, DC 20001', lat: 38.9122, lng: -77.0218,
    vibeTags: ['chill', 'local fave', 'cozy', 'daytime'],
    priceTier: 1, energyScore: 0.3, socialScore: 0.45,
    hours: { mon:'07:00-19:00', tue:'07:00-19:00', wed:'07:00-19:00', thu:'07:00-19:00', fri:'07:00-19:00', sat:'08:00-19:00', sun:'08:00-18:00' },
    visitDuration: 60, groupSizeMin: 2, groupSizeMax: 10,
    description: 'A Shaw staple. Single-origin pour-overs, natural light, and the perfect playlist.',
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Rhizome DC', category: 'Art Space', neighborhood: 'Takoma Park', city: 'Washington DC',
    address: '6950 Laurel Ave, Takoma Park, MD 20912', lat: 38.9795, lng: -77.0036,
    vibeTags: ['avant-garde', 'late night', 'underground', 'creative'],
    priceTier: 2, energyScore: 0.65, socialScore: 0.6,
    hours: { thu:'18:00-23:00', fri:'18:00-23:00', sat:'18:00-23:00', sun:'18:00-22:00' },
    visitDuration: 120, groupSizeMin: 2, groupSizeMax: 20,
    description: 'New media art and experimental performance in a converted house.',
    bookingRequired: false, photoUrl: null, source: 'manual',
  },
  {
    name: 'Wunder Garten', category: 'Beer Garden', neighborhood: 'NoMa', city: 'Washington DC',
    address: '1101 First St NE, Washington, DC 20002', lat: 38.9039, lng: -77.0023,
    vibeTags: ['outdoor', 'social', 'lively', 'group-friendly'],
    priceTier: 2, energyScore: 0.7, socialScore: 0.85,
    hours: { mon:'16:00-23:00', tue:'16:00-23:00', wed:'16:00-23:00', thu:'16:00-23:00', fri:'16:00-02:00', sat:'12:00-02:00', sun:'12:00-22:00' },
    visitDuration: 120, groupSizeMin: 2, groupSizeMax: 30,
    description: "DC's largest beer garden. Shipping container bars, food trucks, and a sprawling patio.",
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Idle Time Books', category: 'Bookstore', neighborhood: 'Adams Morgan', city: 'Washington DC',
    address: '2467 18th St NW, Washington, DC 20009', lat: 38.9219, lng: -77.0435,
    vibeTags: ['cozy', 'browsable', 'quiet', 'hidden gem'],
    priceTier: 1, energyScore: 0.25, socialScore: 0.35,
    hours: { mon:'11:00-22:00', tue:'11:00-22:00', wed:'11:00-22:00', thu:'11:00-22:00', fri:'11:00-22:00', sat:'11:00-22:00', sun:'11:00-22:00' },
    visitDuration: 75, groupSizeMin: 2, groupSizeMax: 6,
    description: 'Four floors of used books in a creaking Adams Morgan townhouse.',
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Pho 14', category: 'Restaurant', neighborhood: 'Columbia Heights', city: 'Washington DC',
    address: '1436 Park Rd NW, Washington, DC 20010', lat: 38.9285, lng: -77.0355,
    vibeTags: ['late night', 'filling', 'local fave', 'quick'],
    priceTier: 1, energyScore: 0.45, socialScore: 0.55,
    hours: { mon:'10:00-02:00', tue:'10:00-02:00', wed:'10:00-02:00', thu:'10:00-02:00', fri:'10:00-02:00', sat:'10:00-02:00', sun:'10:00-02:00' },
    visitDuration: 60, groupSizeMin: 2, groupSizeMax: 15,
    description: 'The no-frills bowl everyone ends up at after a long night.',
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Torpedo Factory Art Center', category: 'Art Studios', neighborhood: 'Old Town Alexandria', city: 'Washington DC',
    address: '105 N Union St, Alexandria, VA 22314', lat: 38.8048, lng: -77.0469,
    vibeTags: ['creative', 'daytime', 'cultural', 'inspiring'],
    priceTier: 1, energyScore: 0.45, socialScore: 0.5,
    hours: { mon:'10:00-18:00', tue:'10:00-18:00', wed:'10:00-18:00', thu:'10:00-18:00', fri:'10:00-18:00', sat:'10:00-18:00', sun:'11:00-17:00' },
    visitDuration: 90, groupSizeMin: 2, groupSizeMax: 20,
    description: '82 working artist studios in a former munitions factory.',
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Boxcar DC', category: 'Arcade Bar', neighborhood: 'U Street', city: 'Washington DC',
    address: '2030 U St NW, Washington, DC 20009', lat: 38.9172, lng: -77.0397,
    vibeTags: ['competitive', 'fun', 'late night', 'social'],
    priceTier: 2, energyScore: 0.75, socialScore: 0.8,
    hours: { mon:'17:00-02:00', tue:'17:00-02:00', wed:'17:00-02:00', thu:'17:00-02:00', fri:'17:00-02:00', sat:'14:00-02:00', sun:'14:00-24:00' },
    visitDuration: 120, groupSizeMin: 2, groupSizeMax: 20,
    description: 'Classic arcade machines, pinball, and cold drinks. Free play after 10pm.',
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Dukem Ethiopian Restaurant', category: 'Restaurant', neighborhood: 'U Street', city: 'Washington DC',
    address: '1114 U St NW, Washington, DC 20009', lat: 38.9168, lng: -77.0294,
    vibeTags: ['communal', 'cultural', 'filling', 'local fave'],
    priceTier: 2, energyScore: 0.5, socialScore: 0.75,
    hours: { mon:'11:00-23:00', tue:'11:00-23:00', wed:'11:00-23:00', thu:'11:00-23:00', fri:'11:00-24:00', sat:'11:00-24:00', sun:'11:00-23:00' },
    visitDuration: 90, groupSizeMin: 2, groupSizeMax: 20,
    description: 'Authentic Ethiopian cuisine served communal-style on injera. A U Street institution.',
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Miracle Theatre', category: 'Music Venue', neighborhood: 'Barracks Row', city: 'Washington DC',
    address: '535 8th St SE, Washington, DC 20003', lat: 38.8826, lng: -76.9975,
    vibeTags: ['cultural', 'lively', 'evening', 'social'],
    priceTier: 2, energyScore: 0.65, socialScore: 0.7,
    hours: { thu:'19:00-23:00', fri:'19:00-23:00', sat:'19:00-23:00' },
    visitDuration: 150, groupSizeMin: 2, groupSizeMax: 50,
    description: "DC's premier Latino arts venue. Live music, theatre, and cultural events.",
    bookingRequired: true, photoUrl: null, source: 'manual',
  },
  {
    name: 'Kramerbooks & Afterwords Café', category: 'Bookstore', neighborhood: 'Dupont Circle', city: 'Washington DC',
    address: '1517 Connecticut Ave NW, Washington, DC 20036', lat: 38.9098, lng: -77.0430,
    vibeTags: ['cozy', 'social', 'browsable', 'late night'],
    priceTier: 2, energyScore: 0.4, socialScore: 0.55,
    hours: { mon:'08:00-01:00', tue:'08:00-01:00', wed:'08:00-01:00', thu:'08:00-01:00', fri:'08:00-03:00', sat:'08:00-03:00', sun:'08:00-01:00' },
    visitDuration: 90, groupSizeMin: 2, groupSizeMax: 12,
    description: 'A legendary bookstore-café hybrid. Browseable shelves and a full menu until late.',
    photoUrl: null, source: 'manual',
  },
  {
    name: 'Eastern Market', category: 'Market', neighborhood: 'Capitol Hill', city: 'Washington DC',
    address: '225 7th St SE, Washington, DC 20003', lat: 38.8836, lng: -76.9979,
    vibeTags: ['outdoor', 'daytime', 'local fave', 'social'],
    priceTier: 1, energyScore: 0.55, socialScore: 0.65,
    hours: { tue:'07:00-19:00', wed:'07:00-19:00', thu:'07:00-19:00', fri:'07:00-19:00', sat:'07:00-18:00', sun:'09:00-17:00' },
    visitDuration: 90, groupSizeMin: 2, groupSizeMax: 30,
    description: 'DC\'s oldest continuously operating market. Fresh produce, art vendors, and weekend flea market.',
    photoUrl: null, source: 'manual',
  },
];

async function main() {
  console.log('Seeding spots database...');

  for (const spot of DC_SPOTS) {
    await prisma.spot.upsert({
      where: { id: spot.name.toLowerCase().replace(/[^a-z0-9]/g, '-') },
      update: spot,
      create: {
        id: spot.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        ...spot,
      }
    }).catch(async () => {
      // If upsert fails on ID, just create
      await prisma.spot.create({ data: spot }).catch(e => {
        if (!e.message.includes('Unique constraint')) throw e;
      });
    });
  }

  console.log(`✓ Seeded ${DC_SPOTS.length} DC spots`);

  // Create a demo admin user for testing
  const bcrypt = require('bcryptjs');
  await prisma.user.upsert({
    where: { email: 'demo@rendezvous.app' },
    update: {},
    create: {
      email: 'demo@rendezvous.app',
      hashedPassword: await bcrypt.hash('demo-password-change-me', 12),
      displayName: 'Demo User',
      handle: 'demo',
      locationCity: 'Washington DC',
      tasteProfile: {
        create: {
          activities: ['food', 'music', 'art', 'outdoor'],
          vibeTags: ['chill', 'spontaneous'],
          budgetMin: 0, budgetMax: 50,
          energyLevel: 0.5, socialOpenness: 0.6,
          spontaneity: 0.65, culturalAppetite: 0.7,
          foodPriority: 0.6, outdoorPreference: 0.5,
          budgetSensitivity: 0.5, nightOwlScore: 0.5,
          activityDiversity: 0.7, signalConfidence: 0.2,
        }
      },
      notifPreferences: { create: {} }
    }
  });

  console.log('✓ Demo user created: demo@rendezvous.app / demo-password-change-me');
  console.log('\nDone! Database seeded successfully.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
