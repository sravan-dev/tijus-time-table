-- ---------------------------------------------------------------------------
-- update-09-07.sql — Tutor role + approval workflow
--
-- Adds the approval columns behind:
--   * tutor-submitted leave requests   (faculty_leave)
--   * tutor-proposed sessions          (allocations)
--
-- Safe to run more than once: every ALTER is guarded by an information_schema
-- check, so re-running is a no-op rather than an error. Portable across MySQL
-- and MariaDB (it does not rely on "ADD COLUMN IF NOT EXISTS", which is
-- MariaDB-only).
--
-- Existing rows are preserved: both `status` columns default to 'approved', so
-- every allocation and leave row that predates this script stays live in the
-- timetable and in the conflict checks. Only new tutor requests start 'pending'.
--
-- Apply with:
--     mysql -u <user> -p <database> < update-09-07.sql
--
-- Equivalent to: node server/db/migrate-approvals.js
-- ---------------------------------------------------------------------------

-- Run everything against the database named on the command line.
-- (No USE statement, so the target DB stays the caller's choice.)

DELIMITER $$

-- Adds a column only when it is missing.
DROP PROCEDURE IF EXISTS __add_col $$
CREATE PROCEDURE __add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN ', ddl);
    PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
    SELECT CONCAT('added ', tbl, '.', col) AS `  ✓`;
  ELSE
    SELECT CONCAT(tbl, '.', col, ' already present') AS `  •`;
  END IF;
END $$

-- Adds an index only when it is missing.
DROP PROCEDURE IF EXISTS __add_idx $$
CREATE PROCEDURE __add_idx(IN tbl VARCHAR(64), IN idx VARCHAR(64), IN cols VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = tbl AND index_name = idx
  ) THEN
    SET @sql = CONCAT('CREATE INDEX `', idx, '` ON `', tbl, '` ', cols);
    PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
    SELECT CONCAT('created index ', tbl, '.', idx) AS `  ✓`;
  ELSE
    SELECT CONCAT(tbl, '.', idx, ' already present') AS `  •`;
  END IF;
END $$

DELIMITER ;

-- ---- faculty_leave: a tutor's leave now needs admin approval ---------------
CALL __add_col('faculty_leave', 'status',
  "`status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'");
CALL __add_col('faculty_leave', 'requested_by',  '`requested_by` INT NULL');
CALL __add_col('faculty_leave', 'decided_by',    '`decided_by` INT NULL');
CALL __add_col('faculty_leave', 'decided_at',    '`decided_at` DATETIME NULL');
CALL __add_col('faculty_leave', 'decision_note', '`decision_note` VARCHAR(255) NULL');

-- ---- allocations: a tutor's proposed session now needs admin approval ------
CALL __add_col('allocations', 'status',
  "`status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'approved'");
CALL __add_col('allocations', 'requested_by',  '`requested_by` INT NULL');
CALL __add_col('allocations', 'decided_by',    '`decided_by` INT NULL');
CALL __add_col('allocations', 'decided_at',    '`decided_at` DATETIME NULL');
CALL __add_col('allocations', 'decision_note', '`decision_note` VARCHAR(255) NULL');

-- ---- the approval queues and the grid filter on status ---------------------
CALL __add_idx('faculty_leave', 'idx_leave_status', '(`status`)');
CALL __add_idx('allocations',   'idx_alloc_status', '(`status`)');

-- ---- the tutor role already exists in the users enum, but older databases ---
-- ---- predate it, so make sure 'faculty' and 'manager' are both allowed. -----
-- (The UI labels the 'faculty' role "tutor"; the stored value is unchanged.)
ALTER TABLE users
  MODIFY role ENUM('admin','manager','viewer','faculty') NOT NULL DEFAULT 'viewer';

-- ---- Backfill --------------------------------------------------------------
-- Columns added above already defaulted existing rows to 'approved'. This is a
-- belt-and-braces pass for any row that somehow carries a NULL/empty status.
UPDATE faculty_leave SET status = 'approved' WHERE status IS NULL;
UPDATE allocations   SET status = 'approved' WHERE status IS NULL;

DROP PROCEDURE IF EXISTS __add_col;
DROP PROCEDURE IF EXISTS __add_idx;

-- ---- Result ----------------------------------------------------------------
SELECT status, COUNT(*) AS allocations FROM allocations   GROUP BY status;
SELECT status, COUNT(*) AS leave_rows  FROM faculty_leave GROUP BY status;
SELECT '✅ Tutor role + approval workflow migration complete.' AS done;
