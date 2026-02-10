-- EnsureExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop old scaffold tables
DROP TABLE "User";
DROP TABLE "Server";

-- CreateEnum
CREATE TYPE "ServerStatus" AS ENUM ('NEW', 'INSTALLING', 'READY', 'ERROR');

-- CreateEnum
CREATE TYPE "SecretType" AS ENUM ('SSH_KEY', 'SSH_PASSWORD');

-- CreateTable
CREATE TABLE "Secret" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "SecretType" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Secret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Server" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "host" TEXT NOT NULL,
    "sshUser" TEXT NOT NULL,
    "sshSecretId" UUID NOT NULL,
    "status" "ServerStatus" NOT NULL DEFAULT 'NEW',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XrayInstance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serverId" UUID NOT NULL,
    "listenPort" INTEGER NOT NULL,
    "realityPrivateKey" TEXT NOT NULL,
    "realityPublicKey" TEXT NOT NULL,
    "serverName" TEXT NOT NULL,
    "dest" TEXT NOT NULL,
    "shortIds" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XrayInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serverId" UUID NOT NULL,
    "name" TEXT,
    "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Server_host_idx" ON "Server"("host");

-- CreateIndex
CREATE INDEX "User_serverId_idx" ON "User"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareToken_tokenHash_key" ON "ShareToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ShareToken_expiresAt_idx" ON "ShareToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_sshSecretId_fkey" FOREIGN KEY ("sshSecretId") REFERENCES "Secret"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XrayInstance" ADD CONSTRAINT "XrayInstance_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareToken" ADD CONSTRAINT "ShareToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

