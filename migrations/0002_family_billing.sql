-- Family billing - links child accounts to parent's subscription
-- Child accounts inherit parent's plan benefits without extra cost

-- Family members linked to a subscription
CREATE TABLE IF NOT EXISTS family_members (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subscription_id TEXT NOT NULL,
  parent_user_id TEXT NOT NULL,
  member_user_id TEXT NOT NULL UNIQUE, -- Each member can only be in one family
  member_type TEXT NOT NULL DEFAULT 'child' CHECK(member_type IN ('child', 'adult')),
  added_at INTEGER NOT NULL,
  removed_at INTEGER,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

-- Family plan settings
CREATE TABLE IF NOT EXISTS family_plans (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  subscription_id TEXT NOT NULL UNIQUE,
  parent_user_id TEXT NOT NULL,
  max_family_members INTEGER DEFAULT 5,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

-- Usage tracking per family member (for shared quotas)
CREATE TABLE IF NOT EXISTS family_usage (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  family_plan_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  usage_type TEXT NOT NULL CHECK(usage_type IN ('storage', 'api_calls', 'projects')),
  usage_amount INTEGER NOT NULL DEFAULT 0,
  period_start INTEGER NOT NULL, -- Start of billing period
  period_end INTEGER NOT NULL,   -- End of billing period
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (family_plan_id) REFERENCES family_plans(id) ON DELETE CASCADE,
  UNIQUE(family_plan_id, user_id, usage_type, period_start)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_family_members_subscription ON family_members(subscription_id);
CREATE INDEX IF NOT EXISTS idx_family_members_parent ON family_members(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_family_members_member ON family_members(member_user_id);
CREATE INDEX IF NOT EXISTS idx_family_plans_parent ON family_plans(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_family_usage_plan ON family_usage(family_plan_id, period_start);
