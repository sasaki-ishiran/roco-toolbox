-- Additive only: legacy demand/history rows are retained as migration evidence.
CREATE TABLE IF NOT EXISTS egg_matching_groups (
  group_id TEXT PRIMARY KEY REFERENCES mother_groups(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  mutation_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS egg_matching_locks (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  group_id TEXT NOT NULL REFERENCES mother_groups(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved', 'transferred')),
  PRIMARY KEY (account_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_egg_matching_locks_group ON egg_matching_locks(group_id);

CREATE TABLE IF NOT EXISTS egg_matching_parent_reservations (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  game_account_key TEXT NOT NULL,
  mother_id TEXT NOT NULL,
  father_id TEXT NOT NULL,
  green_parent_id TEXT,
  group_id TEXT NOT NULL REFERENCES mother_groups(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL,
  PRIMARY KEY(account_id,game_account_key,mother_id,father_id)
);
CREATE INDEX IF NOT EXISTS idx_egg_matching_parents_group ON egg_matching_parent_reservations(group_id);
CREATE TRIGGER IF NOT EXISTS egg_matching_parent_capacity
BEFORE INSERT ON egg_matching_parent_reservations
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM egg_matching_parent_reservations p
    WHERE p.account_id=NEW.account_id AND p.game_account_key=NEW.game_account_key AND (
      (NEW.green_parent_id IS NOT NULL AND p.green_parent_id IS NOT NULL AND NEW.green_parent_id<>p.green_parent_id)
      OR ((NEW.mother_id IN(p.mother_id,p.father_id) OR NEW.father_id IN(p.mother_id,p.father_id)) AND (
        (NEW.green_parent_id IS NULL)<>(p.green_parent_id IS NULL)
        OR (NEW.green_parent_id IS NOT NULL AND (
          (NEW.mother_id IN(p.mother_id,p.father_id) AND NEW.mother_id<>NEW.green_parent_id)
          OR (NEW.father_id IN(p.mother_id,p.father_id) AND NEW.father_id<>NEW.green_parent_id)
        ))
      ))
    )
  ) THEN RAISE(ABORT,'parent academy constraint') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM egg_matching_parent_reservations p
    WHERE p.account_id=NEW.account_id AND p.game_account_key=NEW.game_account_key
      AND NEW.mother_id IN(p.mother_id,p.father_id)
  )>=2 OR (
    SELECT COUNT(*) FROM egg_matching_parent_reservations p
    WHERE p.account_id=NEW.account_id AND p.game_account_key=NEW.game_account_key
      AND NEW.father_id IN(p.mother_id,p.father_id)
  )>=2 THEN RAISE(ABORT,'parent capacity constraint') END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM (
      SELECT mother_id FROM egg_matching_parent_reservations WHERE account_id=NEW.account_id AND game_account_key=NEW.game_account_key
      UNION SELECT father_id FROM egg_matching_parent_reservations WHERE account_id=NEW.account_id AND game_account_key=NEW.game_account_key
      UNION SELECT NEW.mother_id UNION SELECT NEW.father_id
    )
  )>11 THEN RAISE(ABORT,'parent nest capacity constraint') END;
END;

-- Monotonic legacy revision closes the read/initialize race. New groups are fenced
-- at statement execution, including requests that passed the old HTTP gate earlier.
CREATE TABLE IF NOT EXISTS egg_matching_legacy_revisions (
  group_id TEXT PRIMARY KEY REFERENCES mother_groups(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_group_demands_insert
BEFORE INSERT ON collection_group_demands
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_group_demands_insert
AFTER INSERT ON collection_group_demands
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT NEW.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_group_demands_update
BEFORE UPDATE ON collection_group_demands
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_group_demands_update
AFTER UPDATE ON collection_group_demands
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT NEW.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_group_demands_delete
BEFORE DELETE ON collection_group_demands
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=OLD.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=OLD.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=OLD.group_id AND account_id=OLD.demander_account_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_group_demands_delete
AFTER DELETE ON collection_group_demands
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT OLD.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=OLD.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_group_demand_completions_insert
BEFORE INSERT ON collection_group_demand_completions
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_group_demand_completions_insert
AFTER INSERT ON collection_group_demand_completions
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT NEW.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_group_demand_completions_update
BEFORE UPDATE ON collection_group_demand_completions
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_group_demand_completions_update
AFTER UPDATE ON collection_group_demand_completions
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT NEW.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_group_demand_completions_delete
BEFORE DELETE ON collection_group_demand_completions
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=OLD.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=OLD.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=OLD.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_group_demand_completions_delete
AFTER DELETE ON collection_group_demand_completions
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT OLD.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=OLD.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_plans_insert
BEFORE INSERT ON collection_plans
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_plans_insert
AFTER INSERT ON collection_plans
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT NEW.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_plans_update
BEFORE UPDATE ON collection_plans
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_plans_update
AFTER UPDATE ON collection_plans
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT NEW.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_collection_plans_delete
BEFORE DELETE ON collection_plans
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=OLD.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=OLD.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=OLD.group_id AND account_id=OLD.member_account_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_collection_plans_delete
AFTER DELETE ON collection_plans
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT OLD.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=OLD.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_plan_offers_insert
BEFORE INSERT ON plan_offers
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_plan_offers_insert
AFTER INSERT ON plan_offers
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT NEW.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_plan_offers_update
BEFORE UPDATE ON plan_offers
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_plan_offers_update
AFTER UPDATE ON plan_offers
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT NEW.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=NEW.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
CREATE TRIGGER IF NOT EXISTS egg_fence_plan_offers_delete
BEFORE DELETE ON plan_offers
WHEN EXISTS(SELECT 1 FROM egg_matching_groups WHERE group_id=OLD.group_id)
AND EXISTS(SELECT 1 FROM mother_groups WHERE id=OLD.group_id)
AND EXISTS(SELECT 1 FROM mother_group_members WHERE group_id=OLD.group_id AND account_id=OLD.offer_account_id)
AND EXISTS(SELECT 1 FROM collection_plans WHERE id=OLD.plan_id)
BEGIN SELECT RAISE(ABORT,'WORKFLOW_UPGRADED'); END;
CREATE TRIGGER IF NOT EXISTS egg_revision_plan_offers_delete
AFTER DELETE ON plan_offers
BEGIN
  INSERT INTO egg_matching_legacy_revisions(group_id,revision)
    SELECT OLD.group_id,1 WHERE EXISTS(SELECT 1 FROM mother_groups WHERE id=OLD.group_id)
    ON CONFLICT(group_id) DO UPDATE SET revision=revision+1;
END;
