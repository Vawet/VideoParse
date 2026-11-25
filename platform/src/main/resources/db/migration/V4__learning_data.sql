-- Learning data shared with existing media and teaching tools.

CREATE TABLE IF NOT EXISTS courses (
	id VARCHAR(32) NOT NULL,
	name VARCHAR(200) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS study_profiles (
	id INTEGER NOT NULL AUTO_INCREMENT,
	client_id VARCHAR(64) NOT NULL,
	course_id VARCHAR(32) NOT NULL,
	exam_date DATE,
	daily_minutes INTEGER NOT NULL,
	done_items JSON NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(course_id) REFERENCES courses (id),
    INDEX ix_study_profiles_client_id (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS teach_plans (
	id VARCHAR(32) NOT NULL,
	course_id VARCHAR(32) NOT NULL,
	parent_id VARCHAR(32),
	version INTEGER NOT NULL,
	topic VARCHAR(200) NOT NULL,
	minutes INTEGER NOT NULL,
	instruction TEXT NOT NULL,
	data JSON NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(course_id) REFERENCES courses (id),
    INDEX ix_teach_plans_course_id (course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS videos (
	id VARCHAR(64) NOT NULL,
	course_id VARCHAR(32),
	title VARCHAR(300) NOT NULL,
	duration FLOAT NOT NULL,
	status VARCHAR(20) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(course_id) REFERENCES courses (id),
    INDEX ix_videos_course_id (course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quizzes (
	id VARCHAR(32) NOT NULL,
	video_id VARCHAR(64),
	course_id VARCHAR(32),
	topic VARCHAR(200) NOT NULL,
	difficulty VARCHAR(20) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(video_id) REFERENCES videos (id),
	FOREIGN KEY(course_id) REFERENCES courses (id),
    INDEX ix_quizzes_course_id (course_id),
    INDEX ix_quizzes_video_id (video_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transcript_chunks (
	id INTEGER NOT NULL AUTO_INCREMENT,
	video_id VARCHAR(64) NOT NULL,
	idx INTEGER NOT NULL,
	start_sec FLOAT NOT NULL,
	end_sec FLOAT NOT NULL,
	text TEXT NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(video_id) REFERENCES videos (id),
    INDEX ix_transcript_chunks_video_id (video_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS questions (
	id VARCHAR(32) NOT NULL,
	quiz_id VARCHAR(32) NOT NULL,
	qtype VARCHAR(20) NOT NULL,
	stem TEXT NOT NULL,
	options JSON,
	answer TEXT NOT NULL,
	explanation TEXT NOT NULL,
	difficulty VARCHAR(20) NOT NULL,
	topic VARCHAR(200) NOT NULL,
	evidence JSON NOT NULL,
	verified BOOL NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(quiz_id) REFERENCES quizzes (id),
    INDEX ix_questions_quiz_id (quiz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attempts (
	id INTEGER NOT NULL AUTO_INCREMENT,
	client_id VARCHAR(64) NOT NULL,
	question_id VARCHAR(32) NOT NULL,
	given_answer TEXT NOT NULL,
	correct BOOL NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(question_id) REFERENCES questions (id),
    INDEX ix_attempts_client_id (client_id),
    INDEX ix_attempts_question_id (question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
