/*
  Warnings:

  - You are about to alter the column `name` on the `Strategy` table. The data in that column could be lost. The data in that column will be cast from `VarChar(70)` to `VarChar(60)`.
  - You are about to alter the column `description` on the `Strategy` table. The data in that column could be lost. The data in that column will be cast from `VarChar(2000)` to `VarChar(500)`.

*/
-- AlterTable
ALTER TABLE `Strategy` MODIFY `name` VARCHAR(60) NOT NULL,
    MODIFY `description` VARCHAR(500) NULL;
