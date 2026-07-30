-- AlterTable
ALTER TABLE `BacktestJob` ADD COLUMN `resultHash` VARCHAR(64) NULL,
    ADD COLUMN `reusedFromJobId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `BacktestJob_strategyId_resultHash_idx` ON `BacktestJob`(`strategyId`, `resultHash`);
