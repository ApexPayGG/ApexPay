ALTER TABLE "OutboxEvent" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "OutboxEvent" SET "updated_at" = "created_at";
