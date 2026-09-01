-- AlterTable
ALTER TABLE `User` ADD COLUMN `emailDeliveryFailed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `emailDeliveryFailedAt` DATETIME(3) NULL,
    ADD COLUMN `emailDeliveryFailedReason` VARCHAR(191) NULL;
