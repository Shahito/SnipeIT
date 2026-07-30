-- Strategy.pair (String) -> Strategy.pairs (Json string[])
ALTER TABLE `Strategy` ADD COLUMN `pairs` JSON NULL;
UPDATE `Strategy` SET `pairs` = JSON_ARRAY(`pair`) WHERE `pairs` IS NULL;
ALTER TABLE `Strategy` MODIFY COLUMN `pairs` JSON NOT NULL;
ALTER TABLE `Strategy` DROP COLUMN `pair`;

-- Strategy: timeframe String -> Json
ALTER TABLE `Strategy` ADD COLUMN `timeframe_new` JSON NULL;
UPDATE `Strategy` SET `timeframe_new` = JSON_QUOTE(`timeframe`);
ALTER TABLE `Strategy` DROP COLUMN `timeframe`;
ALTER TABLE `Strategy` CHANGE COLUMN `timeframe_new` `timeframe` JSON NOT NULL;

-- Strategy: positionSize Float -> Json
ALTER TABLE `Strategy` ADD COLUMN `positionSize_new` JSON NULL;
UPDATE `Strategy` SET `positionSize_new` = CAST(`positionSize` AS JSON);
ALTER TABLE `Strategy` DROP COLUMN `positionSize`;
ALTER TABLE `Strategy` CHANGE COLUMN `positionSize_new` `positionSize` JSON NOT NULL;

-- Strategy: stopLoss Float? -> Json?
ALTER TABLE `Strategy` ADD COLUMN `stopLoss_new` JSON NULL;
UPDATE `Strategy` SET `stopLoss_new` = CAST(`stopLoss` AS JSON) WHERE `stopLoss` IS NOT NULL;
ALTER TABLE `Strategy` DROP COLUMN `stopLoss`;
ALTER TABLE `Strategy` CHANGE COLUMN `stopLoss_new` `stopLoss` JSON NULL;

-- Strategy: takeProfit Float? -> Json?
ALTER TABLE `Strategy` ADD COLUMN `takeProfit_new` JSON NULL;
UPDATE `Strategy` SET `takeProfit_new` = CAST(`takeProfit` AS JSON) WHERE `takeProfit` IS NOT NULL;
ALTER TABLE `Strategy` DROP COLUMN `takeProfit`;
ALTER TABLE `Strategy` CHANGE COLUMN `takeProfit_new` `takeProfit` JSON NULL;

-- Strategy: trailingStopLoss Float? -> Json?
ALTER TABLE `Strategy` ADD COLUMN `trailingStopLoss_new` JSON NULL;
UPDATE `Strategy` SET `trailingStopLoss_new` = CAST(`trailingStopLoss` AS JSON) WHERE `trailingStopLoss` IS NOT NULL;
ALTER TABLE `Strategy` DROP COLUMN `trailingStopLoss`;
ALTER TABLE `Strategy` CHANGE COLUMN `trailingStopLoss_new` `trailingStopLoss` JSON NULL;

-- Strategy: slType String? -> Json?
ALTER TABLE `Strategy` ADD COLUMN `slType_new` JSON NULL;
UPDATE `Strategy` SET `slType_new` = JSON_QUOTE(`slType`) WHERE `slType` IS NOT NULL;
ALTER TABLE `Strategy` DROP COLUMN `slType`;
ALTER TABLE `Strategy` CHANGE COLUMN `slType_new` `slType` JSON NULL;

-- Strategy: tpType String? -> Json?
ALTER TABLE `Strategy` ADD COLUMN `tpType_new` JSON NULL;
UPDATE `Strategy` SET `tpType_new` = JSON_QUOTE(`tpType`) WHERE `tpType` IS NOT NULL;
ALTER TABLE `Strategy` DROP COLUMN `tpType`;
ALTER TABLE `Strategy` CHANGE COLUMN `tpType_new` `tpType` JSON NULL;

-- Strategy: atrPeriod Int? -> Json?
ALTER TABLE `Strategy` ADD COLUMN `atrPeriod_new` JSON NULL;
UPDATE `Strategy` SET `atrPeriod_new` = CAST(`atrPeriod` AS JSON) WHERE `atrPeriod` IS NOT NULL;
ALTER TABLE `Strategy` DROP COLUMN `atrPeriod`;
ALTER TABLE `Strategy` CHANGE COLUMN `atrPeriod_new` `atrPeriod` JSON NULL;

-- CreateTable
CREATE TABLE `SweepGroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `strategyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(191) NULL,
    `definitionSnapshot` JSON NOT NULL,
    `totalRuns` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PairCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `color` VARCHAR(191) NOT NULL DEFAULT '#6c8eff',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PairCategory_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PairCategoryItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `categoryId` INTEGER NOT NULL,
    `pair` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `PairCategoryItem_categoryId_pair_key`(`categoryId`, `pair`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `BacktestJob` ADD COLUMN `sweepGroupId` INTEGER NULL,
    ADD COLUMN `pair` VARCHAR(191) NULL,
    ADD COLUMN `paramValues` JSON NULL;

-- CreateIndex
CREATE INDEX `BacktestJob_sweepGroupId_idx` ON `BacktestJob`(`sweepGroupId`);

-- CreateIndex
CREATE INDEX `BacktestJob_pair_idx` ON `BacktestJob`(`pair`);

-- AddForeignKey
ALTER TABLE `SweepGroup` ADD CONSTRAINT `SweepGroup_strategyId_fkey` FOREIGN KEY (`strategyId`) REFERENCES `Strategy`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SweepGroup` ADD CONSTRAINT `SweepGroup_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PairCategory` ADD CONSTRAINT `PairCategory_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PairCategoryItem` ADD CONSTRAINT `PairCategoryItem_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `PairCategory`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BacktestJob` ADD CONSTRAINT `BacktestJob_sweepGroupId_fkey` FOREIGN KEY (`sweepGroupId`) REFERENCES `SweepGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
