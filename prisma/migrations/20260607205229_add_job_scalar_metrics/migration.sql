-- AlterTable
ALTER TABLE `BacktestJob` ADD COLUMN `durationDays` INTEGER NULL,
    ADD COLUMN `finalCapital` DOUBLE NULL,
    ADD COLUMN `initialCapital` DOUBLE NULL,
    ADD COLUMN `maxDrawdown` DOUBLE NULL,
    ADD COLUMN `pnlAbsolute` DOUBLE NULL,
    ADD COLUMN `pnlPercent` DOUBLE NULL,
    ADD COLUMN `profitFactor` DOUBLE NULL,
    ADD COLUMN `sharpeRatio` DOUBLE NULL,
    ADD COLUMN `totalTrades` INTEGER NULL,
    ADD COLUMN `winRate` DOUBLE NULL;
