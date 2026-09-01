/*
  Warnings:

  - A unique constraint covering the columns `[normalizedEmail]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `User` ADD COLUMN `normalizedEmail` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_normalizedEmail_key` ON `User`(`normalizedEmail`);
