-- Add algorithm version byte to all ciphertext-bearing tables for crypto-agility.
-- Existing rows default to alg=1 (AES-256-GCM V1).

ALTER TABLE "secrets" ADD COLUMN "alg" smallint NOT NULL DEFAULT 1;
ALTER TABLE "webhooks" ADD COLUMN "secret_alg" smallint NOT NULL DEFAULT 1;
ALTER TABLE "repos" ADD COLUMN "slack_webhook_url_alg" smallint NOT NULL DEFAULT 1;
