-- Tijus Academy Timetable & Allocation schema
-- Run against the `tijus_timetable` database.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS ticket_messages;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS allocations;
DROP TABLE IF EXISTS faculty_capabilities;
DROP TABLE IF EXISTS faculty_leave;
DROP TABLE IF EXISTS room_blocks;
DROP TABLE IF EXISTS time_slots;
DROP TABLE IF EXISTS batches;
DROP TABLE IF EXISTS faculty;
DROP TABLE IF EXISTS classrooms;
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS programs;
DROP TABLE IF EXISTS app_settings;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- App users (admin can edit, viewer is read-only)
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(60)  NOT NULL UNIQUE,
  password_hash VARCHAR(120) NOT NULL,
  full_name     VARCHAR(120),
  role          ENUM('admin','manager','viewer','faculty') NOT NULL DEFAULT 'viewer',
  faculty_id    INT NULL,                 -- set for role='faculty': which tutor this login is
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Programs / courses (OET, IELTS, PTE, German, Fluency)
CREATE TABLE programs (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  code  VARCHAR(20)  NOT NULL UNIQUE,
  name  VARCHAR(80)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Classrooms with seating capacity
CREATE TABLE classrooms (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  code      VARCHAR(20) NOT NULL UNIQUE,
  capacity  INT NOT NULL DEFAULT 0,
  notes     VARCHAR(160)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Faculty / tutors
CREATE TABLE faculty (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  name    VARCHAR(120) NOT NULL,
  email   VARCHAR(160) NULL,
  active  TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_faculty_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- App settings (key-value): branding, timezone, SMTP config
CREATE TABLE app_settings (
  skey   VARCHAR(60) PRIMARY KEY,
  svalue MEDIUMTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Batches (a cohort of students within a program)
CREATE TABLE batches (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  program_id    INT NOT NULL,
  student_count INT NOT NULL DEFAULT 0,
  home_room_id  INT,
  exam_month    VARCHAR(40),
  active        TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (program_id)   REFERENCES programs(id),
  FOREIGN KEY (home_room_id) REFERENCES classrooms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Time slots are defined per program (OET and German use different grids)
CREATE TABLE time_slots (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  program_id  INT NOT NULL,
  label       VARCHAR(40) NOT NULL,
  start_time  TIME,
  end_time    TIME,
  sort_order  INT NOT NULL DEFAULT 0,
  FOREIGN KEY (program_id) REFERENCES programs(id),
  UNIQUE KEY uq_slot (program_id, label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Activity / session types (R=Reading, W=Writing, L=Listening, S=Speaking, etc.)
CREATE TABLE activities (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  code      VARCHAR(20) NOT NULL UNIQUE,
  name      VARCHAR(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which programs + modules (Listening/Reading/Speaking/Writing) a tutor can
-- teach. GENERAL is used for programs with no module split (e.g. Fluency).
-- Sourced from the "TUTORS & MODULE" sheet; editable in Manage → Modules.
CREATE TABLE faculty_capabilities (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  faculty_id  INT NOT NULL,
  program_id  INT NOT NULL,
  module      ENUM('LISTENING','READING','SPEAKING','WRITING','GENERAL') NOT NULL,
  FOREIGN KEY (faculty_id) REFERENCES faculty(id)  ON DELETE CASCADE,
  FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_capability (faculty_id, program_id, module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Faculty leave (drives the "is faculty on leave" allocation rule)
CREATE TABLE faculty_leave (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  faculty_id  INT NOT NULL,
  leave_date  DATE NOT NULL,
  reason      VARCHAR(160),
  FOREIGN KEY (faculty_id) REFERENCES faculty(id) ON DELETE CASCADE,
  UNIQUE KEY uq_leave (faculty_id, leave_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Room blocks (maintenance / events make a room unavailable)
CREATE TABLE room_blocks (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  classroom_id INT NOT NULL,
  block_date   DATE NOT NULL,
  reason       VARCHAR(160),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  UNIQUE KEY uq_block (classroom_id, block_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The central allocation table: one row = one session in the daily grid
CREATE TABLE allocations (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  alloc_date    DATE NOT NULL,
  program_id    INT NOT NULL,
  batch_id      INT,
  activity_id   INT,
  time_slot_id  INT NOT NULL,
  classroom_id  INT,
  faculty_id    INT,
  student_count INT,
  raw_text      VARCHAR(255),               -- original cell text, for reference/debugging
  note          VARCHAR(255),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (program_id)   REFERENCES programs(id),
  FOREIGN KEY (batch_id)     REFERENCES batches(id)     ON DELETE SET NULL,
  FOREIGN KEY (activity_id)  REFERENCES activities(id)  ON DELETE SET NULL,
  FOREIGN KEY (time_slot_id) REFERENCES time_slots(id),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id)  ON DELETE SET NULL,
  FOREIGN KEY (faculty_id)   REFERENCES faculty(id)     ON DELETE SET NULL,
  INDEX idx_alloc_date (alloc_date),
  INDEX idx_alloc_room (alloc_date, classroom_id, time_slot_id),
  INDEX idx_alloc_fac  (alloc_date, faculty_id, time_slot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Link faculty logins to their tutor record (added here as faculty is defined above).
ALTER TABLE users
  ADD CONSTRAINT fk_users_faculty FOREIGN KEY (faculty_id) REFERENCES faculty(id) ON DELETE SET NULL;

-- Support tickets: tutors raise them, admins reply and manage status.
CREATE TABLE tickets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,                 -- the user (usually a tutor) who raised it
  subject    VARCHAR(160) NOT NULL,
  status     ENUM('open','answered','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tickets_user (user_id),
  INDEX idx_tickets_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per message in a ticket's conversation thread (first row is the body).
CREATE TABLE ticket_messages (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id  INT NOT NULL,
  user_id    INT NOT NULL,                 -- author of this message
  body       TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  INDEX idx_tmsg_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
