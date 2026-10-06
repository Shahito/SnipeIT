-- AlterTable
ALTER TABLE `ApiKey` ADD COLUMN `disconnectedNotified` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `SweepGroup` ADD COLUMN `halfwayNotified` BOOLEAN NOT NULL DEFAULT false;
