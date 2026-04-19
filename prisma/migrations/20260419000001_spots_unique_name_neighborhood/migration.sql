-- AddUniqueConstraint
CREATE UNIQUE INDEX "spots_name_neighborhood_key" ON "spots"("name", "neighborhood");
