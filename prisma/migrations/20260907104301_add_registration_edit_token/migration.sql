/*
  Warnings:

  - A unique constraint covering the columns `[registrationEditToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `User` ADD COLUMN `registrationEditToken` VARCHAR(191) NULL,
    ADD COLUMN `registrationEditTokenExpires` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_registrationEditToken_key` ON `User`(`registrationEditToken`);
