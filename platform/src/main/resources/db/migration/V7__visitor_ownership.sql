CREATE TABLE vp_visitor (
    id CHAR(32) PRIMARY KEY,
    token_hash BINARY(32) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL
);

-- A null owner marks pre-isolation data that requires an explicit administrative assignment.
ALTER TABLE vp_upload ADD COLUMN owner_id CHAR(32), ADD FOREIGN KEY (owner_id) REFERENCES vp_visitor(id);
ALTER TABLE videos ADD COLUMN owner_id CHAR(32), ADD FOREIGN KEY (owner_id) REFERENCES vp_visitor(id);
ALTER TABLE courses ADD COLUMN owner_id CHAR(32), ADD FOREIGN KEY (owner_id) REFERENCES vp_visitor(id);

CREATE TABLE vp_conversation (
    id CHAR(32) PRIMARY KEY,
    owner_id CHAR(32) NOT NULL,
    scope_type VARCHAR(8) NOT NULL,
    scope_id VARCHAR(64) NOT NULL,
    revision INT NOT NULL,
    history JSON NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES vp_visitor(id)
);
