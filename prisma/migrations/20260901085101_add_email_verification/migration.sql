/*
  Warnings:

  - You are about to drop the `PairCategory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PairCategoryItem` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[email]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[emailVerificationToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `PairCategory` DROP FOREIGN KEY `PairCategory_userId_fkey`;

-- DropForeignKey
ALTER TABLE `PairCategoryItem` DROP FOREIGN KEY `PairCategoryItem_categoryId_fkey`;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `email` VARCHAR(191) NULL,
    ADD COLUMN `emailVerificationExpires` DATETIME(3) NULL,
    ADD COLUMN `emailVerificationToken` VARCHAR(191) NULL,
    ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE `PairCategory`;

-- DropTable
DROP TABLE `PairCategoryItem`;

-- CreateIndex
CREATE UNIQUE INDEX `User_email_key` ON `User`(`email`);

-- CreateIndex
CREATE UNIQUE INDEX `User_emailVerificationToken_key` ON `User`(`emailVerificationToken`);
