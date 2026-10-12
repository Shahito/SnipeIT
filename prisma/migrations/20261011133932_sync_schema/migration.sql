/*
  Warnings:

  - You are about to drop the column `atrPeriod` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `slType` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `stopLoss` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `takeProfit` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `tpType` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `trailingStopLoss` on the `Strategy` table. All the data in the column will be lost.
  - Added the required column `execution` to the `Strategy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `exits` to the `Strategy` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Strategy` DROP COLUMN `atrPeriod`,
    DROP COLUMN `slType`,
    DROP COLUMN `stopLoss`,
    DROP COLUMN `takeProfit`,
    DROP COLUMN `tpType`,
    DROP COLUMN `trailingStopLoss`,
    ADD COLUMN `execution` JSON NOT NULL,
    ADD COLUMN `exits` JSON NOT NULL;
