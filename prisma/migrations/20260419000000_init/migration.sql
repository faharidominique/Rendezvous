-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('ACTIVE', 'GENERATING', 'VOTING', 'CONFIRMED', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ReactionType" AS ENUM ('HEART', 'REPEAT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hashedPassword" TEXT,
    "displayName" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "locationCity" TEXT,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "parentConsent" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taste_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activities" TEXT[],
    "vibeTags" TEXT[],
    "budgetMin" INTEGER NOT NULL DEFAULT 0,
    "budgetMax" INTEGER NOT NULL DEFAULT 50,
    "mbtiType" TEXT,
    "mbtiSource" TEXT,
    "energyLevel" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "socialOpenness" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "spontaneity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "culturalAppetite" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "foodPriority" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "outdoorPreference" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "budgetSensitivity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "nightOwlScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "activityDiversity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "signalConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "spotifySignals" JSONB,
    "appleMusicSignals" JSONB,
    "instagramSignals" JSONB,
    "tiktokSignals" JSONB,
    "pinterestSignals" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "taste_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "generatedPlans" JSONB,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "locationCity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_members" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "energyLevel" TEXT,
    "budget" INTEGER,
    "availableFrom" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "party_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_votes" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planIndex" INTEGER NOT NULL,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "party_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spots" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "vibeTags" TEXT[],
    "priceTier" INTEGER NOT NULL,
    "energyScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "socialScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "hours" JSONB NOT NULL,
    "visitDuration" INTEGER NOT NULL DEFAULT 90,
    "groupSizeMin" INTEGER NOT NULL DEFAULT 2,
    "groupSizeMax" INTEGER NOT NULL DEFAULT 20,
    "bookingRequired" BOOLEAN NOT NULL DEFAULT false,
    "bookingUrl" TEXT,
    "websiteUrl" TEXT,
    "phoneNumber" TEXT,
    "photoUrl" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "spots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelf_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spotId" TEXT NOT NULL,
    "addedFromPartyId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shelf_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "partyId" TEXT,
    "creatorId" TEXT NOT NULL,
    "spotId" TEXT,
    "photoUrl" TEXT,
    "caption" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_reactions" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reactionType" "ReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memory_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "clientTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notif_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partyInvite" BOOLEAN NOT NULL DEFAULT true,
    "checkinNudge" BOOLEAN NOT NULL DEFAULT true,
    "plansReady" BOOLEAN NOT NULL DEFAULT true,
    "voteReminder" BOOLEAN NOT NULL DEFAULT true,
    "planConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "prosocialNudge" BOOLEAN NOT NULL DEFAULT true,
    "nudgeDays" INTEGER NOT NULL DEFAULT 7,
    "memoryReaction" BOOLEAN NOT NULL DEFAULT true,
    "friendRequest" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 23,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 9,
    CONSTRAINT "notif_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_handle_key" ON "users"("handle");
CREATE UNIQUE INDEX "taste_profiles_userId_key" ON "taste_profiles"("userId");
CREATE UNIQUE INDEX "parties_code_key" ON "parties"("code");
CREATE UNIQUE INDEX "party_members_partyId_userId_key" ON "party_members"("partyId", "userId");
CREATE UNIQUE INDEX "party_votes_partyId_userId_key" ON "party_votes"("partyId", "userId");
CREATE UNIQUE INDEX "shelf_items_userId_spotId_key" ON "shelf_items"("userId", "spotId");
CREATE UNIQUE INDEX "memory_reactions_memoryId_userId_key" ON "memory_reactions"("memoryId", "userId");
CREATE UNIQUE INDEX "friendships_requesterId_addresseeId_key" ON "friendships"("requesterId", "addresseeId");
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");
CREATE UNIQUE INDEX "push_tokens_userId_deviceId_key" ON "push_tokens"("userId", "deviceId");
CREATE UNIQUE INDEX "app_connections_userId_provider_key" ON "app_connections"("userId", "provider");
CREATE UNIQUE INDEX "notif_preferences_userId_key" ON "notif_preferences"("userId");
CREATE INDEX "analytics_events_userId_eventType_idx" ON "analytics_events"("userId", "eventType");
CREATE INDEX "analytics_events_eventType_serverTs_idx" ON "analytics_events"("eventType", "serverTs");

-- AddForeignKey
ALTER TABLE "taste_profiles" ADD CONSTRAINT "taste_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parties" ADD CONSTRAINT "parties_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_votes" ADD CONSTRAINT "party_votes_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "party_votes" ADD CONSTRAINT "party_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shelf_items" ADD CONSTRAINT "shelf_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shelf_items" ADD CONSTRAINT "shelf_items_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memories" ADD CONSTRAINT "memories_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memories" ADD CONSTRAINT "memories_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "spots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "memory_reactions" ADD CONSTRAINT "memory_reactions_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_reactions" ADD CONSTRAINT "memory_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_connections" ADD CONSTRAINT "app_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notif_preferences" ADD CONSTRAINT "notif_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
