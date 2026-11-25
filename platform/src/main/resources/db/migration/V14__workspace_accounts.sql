CREATE TABLE vp_account (
    owner_id CHAR(32) PRIMARY KEY,
    username VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    salt BINARY(16) NOT NULL,
    password_hash BINARY(32) NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES vp_visitor(id)
) ENGINE=InnoDB;

CREATE TABLE vp_account_session (
    token_hash BINARY(32) PRIMARY KEY,
    owner_id CHAR(32) NOT NULL,
    expires_at DATETIME NOT NULL,
    INDEX (expires_at),
    FOREIGN KEY (owner_id) REFERENCES vp_account(owner_id) ON DELETE CASCADE
) ENGINE=InnoDB;
