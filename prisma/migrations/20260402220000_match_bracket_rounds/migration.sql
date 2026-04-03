-- AlterTable: istniejące mecze zachowują zachowanie finansowe (wypłata przy rozstrzygnięciu).
ALTER TABLE "Match" ADD COLUMN "roundNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Match" ADD COLUMN "awardsTournamentPrize" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Match_tournamentId_roundNumber_idx" ON "Match"("tournamentId", "roundNumber");
