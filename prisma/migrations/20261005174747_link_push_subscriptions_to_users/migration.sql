-- AlterTable
ALTER TABLE `PushSubscription` ADD COLUMN `userId` INTEGER NULL,
    MODIFY `endpoint` VARCHAR(500) NOT NULL;

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
