-- AlterTable
ALTER TABLE `User`
  ADD COLUMN `email` VARCHAR(191) NULL,
  ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `emailVerificationToken` VARCHAR(191) NULL,
  ADD COLUMN `emailVerificationExpires` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_email_key` ON `User`(`email`);

-- CreateIndex
CREATE UNIQUE INDEX `User_emailVerificationToken_key` ON `User`(`emailVerificationToken`);
