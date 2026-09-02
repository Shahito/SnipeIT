/*
  Warnings:

  - A unique constraint covering the columns `[pendingEmail]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `User` ADD COLUMN `pendingEmail` VARCHAR(191) NULL,
    ADD COLUMN `pendingEmailDeliveryFailed` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pendingEmailDeliveryFailedAt` DATETIME(3) NULL,
    ADD COLUMN `pendingEmailDeliveryFailedReason` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_pendingEmail_key` ON `User`(`pendingEmail`);
