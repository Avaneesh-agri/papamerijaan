-- Asscher AI — full database schema (PostgreSQL).
-- Normally you run `npx prisma db push` which creates all of this automatically.
-- This file is a fallback for environments where the Prisma CLI cannot reach
-- its engine downloads: `psql "$DATABASE_URL" -f prisma/schema.sql`

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isPrimaryAdmin" BOOLEAN NOT NULL DEFAULT FALSE,
  "managerId" TEXT,
  "department" TEXT,
  "roleNotes" TEXT,
  "photoFileId" TEXT,
  "dateOfJoining" TEXT,
  "stipendAmount" INTEGER,
  "payCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
  "payDay" INTEGER NOT NULL DEFAULT 5,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "exitDate" TEXT,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT FALSE,
  "notifPrefs" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_managerId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "tokenHash" TEXT NOT NULL,
  "deviceInfo" TEXT,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

CREATE TABLE IF NOT EXISTS "UserDocument" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "fileId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "FileObject" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "uploadedById" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'GENERAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Task" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "protocol" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "createdById" TEXT NOT NULL,
  "parentTaskId" TEXT REFERENCES "Task"("id"),
  "startDate" TEXT,
  "dueAt" TIMESTAMP(3),
  "expectedEffort" TEXT,
  "submissionMethod" TEXT NOT NULL DEFAULT 'TEXT',
  "checklistItems" JSONB,
  "isRecurringTemplate" BOOLEAN NOT NULL DEFAULT FALSE,
  "recurrenceRule" JSONB,
  "recurrenceParentId" TEXT,
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Task_parentTaskId_idx" ON "Task"("parentTaskId");
CREATE INDEX IF NOT EXISTS "Task_createdById_idx" ON "Task"("createdById");
CREATE INDEX IF NOT EXISTS "Task_dueAt_idx" ON "Task"("dueAt");

CREATE TABLE IF NOT EXISTS "TaskAssignee" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "Task"("id"),
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "assignedById" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
  "firstOpenedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");
CREATE INDEX IF NOT EXISTS "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

CREATE TABLE IF NOT EXISTS "TaskResource" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "Task"("id"),
  "type" TEXT NOT NULL,
  "fileId" TEXT,
  "url" TEXT,
  "videoId" TEXT,
  "label" TEXT
);

CREATE TABLE IF NOT EXISTS "TaskComment" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "Task"("id"),
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "mentions" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "TaskHistory" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "Task"("id"),
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "detail" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Submission" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "Task"("id"),
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "content" TEXT,
  "linkUrl" TEXT,
  "checklistState" JSONB,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "Submission_taskId_idx" ON "Submission"("taskId");

CREATE TABLE IF NOT EXISTS "SubmissionFile" (
  "id" TEXT PRIMARY KEY,
  "submissionId" TEXT NOT NULL REFERENCES "Submission"("id"),
  "fileId" TEXT NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "ProtocolTemplate" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DailyReport" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "dateKey" TEXT NOT NULL,
  "summary" TEXT,
  "blockers" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "late" BOOLEAN NOT NULL DEFAULT FALSE,
  "reviewedById" TEXT,
  "managerComment" TEXT,
  "forwardedAt" TIMESTAMP(3),
  "taskSnapshot" JSONB,
  "compiledTeam" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DailyReport_userId_dateKey_key" ON "DailyReport"("userId", "dateKey");
CREATE INDEX IF NOT EXISTS "DailyReport_dateKey_idx" ON "DailyReport"("dateKey");

CREATE TABLE IF NOT EXISTS "ReportAttachment" (
  "id" TEXT PRIMARY KEY,
  "reportId" TEXT NOT NULL REFERENCES "DailyReport"("id"),
  "fileId" TEXT NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "DayReportArchive" (
  "id" TEXT PRIMARY KEY,
  "dateKey" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "generatedById" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DayReportArchive_dateKey_key" ON "DayReportArchive"("dateKey");

CREATE TABLE IF NOT EXISTS "Query" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "raisedById" TEXT NOT NULL,
  "taskId" TEXT,
  "assignedToId" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'NORMAL',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "escalations" INTEGER NOT NULL DEFAULT 0,
  "resolutionNote" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Query_assignedToId_idx" ON "Query"("assignedToId");
CREATE INDEX IF NOT EXISTS "Query_raisedById_idx" ON "Query"("raisedById");

CREATE TABLE IF NOT EXISTS "QueryMessage" (
  "id" TEXT PRIMARY KEY,
  "queryId" TEXT NOT NULL REFERENCES "Query"("id"),
  "authorId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'MESSAGE',
  "body" TEXT NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Requirement" (
  "id" TEXT PRIMARY KEY,
  "raisedById" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "decisionNote" TEXT,
  "convertedTaskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Leave" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "type" TEXT NOT NULL DEFAULT 'CASUAL',
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "reason" TEXT,
  "attachmentFileId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decidedById" TEXT,
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Leave_userId_idx" ON "Leave"("userId");

CREATE TABLE IF NOT EXISTS "Holiday" (
  "id" TEXT PRIMARY KEY,
  "dateKey" TEXT NOT NULL,
  "name" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "Holiday_dateKey_key" ON "Holiday"("dateKey");

CREATE TABLE IF NOT EXISTS "StipendRecord" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "periodKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'STIPEND',
  "amount" INTEGER NOT NULL,
  "dueDate" TEXT NOT NULL,
  "paidAt" TIMESTAMP(3),
  "paidNote" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "StipendRecord_userId_periodKey_kind_key" ON "StipendRecord"("userId", "periodKey", "kind");
CREATE INDEX IF NOT EXISTS "StipendRecord_userId_idx" ON "StipendRecord"("userId");

CREATE TABLE IF NOT EXISTS "Streak" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id"),
  "current" INTEGER NOT NULL DEFAULT 0,
  "best" INTEGER NOT NULL DEFAULT 0,
  "lastCountedDate" TEXT
);

CREATE TABLE IF NOT EXISTS "StreakDay" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "dateKey" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "reason" TEXT,
  "detail" JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS "StreakDay_userId_dateKey_key" ON "StreakDay"("userId", "dateKey");
CREATE INDEX IF NOT EXISTS "StreakDay_dateKey_idx" ON "StreakDay"("dateKey");

CREATE TABLE IF NOT EXISTS "StreakAdjustment" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "byId" TEXT NOT NULL,
  "setTo" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "MilestoneEvent" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "days" INTEGER NOT NULL,
  "dateKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Video" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "driveFileId" TEXT NOT NULL,
  "addedById" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "VideoView" (
  "id" TEXT PRIMARY KEY,
  "videoId" TEXT NOT NULL REFERENCES "Video"("id"),
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "durationSec" INTEGER NOT NULL DEFAULT 0,
  "lastPingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "VideoView_videoId_idx" ON "VideoView"("videoId");
CREATE INDEX IF NOT EXISTS "VideoView_userId_idx" ON "VideoView"("userId");

CREATE TABLE IF NOT EXISTS "PlaybackToken" (
  "id" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL,
  "videoId" TEXT NOT NULL REFERENCES "Video"("id"),
  "userId" TEXT NOT NULL,
  "viewId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlaybackToken_token_key" ON "PlaybackToken"("token");

CREATE TABLE IF NOT EXISTS "VaultItem" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "plan" TEXT,
  "monthlyCost" INTEGER,
  "renewalDate" TEXT,
  "loginEmail" TEXT,
  "loginUsername" TEXT,
  "passwordEnc" TEXT,
  "otpPhone" TEXT,
  "otpHolder" TEXT,
  "recoveryEmail" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "VaultAccess" (
  "id" TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL REFERENCES "VaultItem"("id"),
  "userId" TEXT NOT NULL REFERENCES "User"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "VaultAccess_itemId_userId_key" ON "VaultAccess"("itemId", "userId");

CREATE TABLE IF NOT EXISTS "VaultViewLog" (
  "id" TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL REFERENCES "VaultItem"("id"),
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "action" TEXT NOT NULL DEFAULT 'REVEAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "VaultViewLog_userId_idx" ON "VaultViewLog"("userId");

CREATE TABLE IF NOT EXISTS "ExternalContact" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "link" TEXT,
  "level" TEXT NOT NULL DEFAULT 'NORMAL',
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AnnouncementRead" (
  "id" TEXT PRIMARY KEY,
  "announcementId" TEXT NOT NULL REFERENCES "Announcement"("id"),
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementRead_announcementId_userId_key" ON "AnnouncementRead"("announcementId", "userId");

CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id" TEXT PRIMARY KEY,
  "actorId" TEXT,
  "type" TEXT NOT NULL,
  "targetUserId" TEXT,
  "detail" TEXT NOT NULL,
  "meta" JSONB,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ActivityLog_actorId_idx" ON "ActivityLog"("actorId");
CREATE INDEX IF NOT EXISTS "ActivityLog_type_idx" ON "ActivityLog"("type");
CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

CREATE TABLE IF NOT EXISTS "AppSetting" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS "AppState" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
