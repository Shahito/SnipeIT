/*
  Warnings:

  - You are about to alter the column `name` on the `Strategy` table. The data in that column could be lost. The data in that column will be cast from `VarChar(191)` to `VarChar(70)`.

*/
-- AlterTable
ALTER TABLE `Strategy` MODIFY `name` VARCHAR(70) NOT NULL,
    MODIFY `description` VARCHAR(2000) NULL;
