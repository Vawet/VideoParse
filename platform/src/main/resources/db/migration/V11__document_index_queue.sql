CREATE INDEX ix_document_index_queue ON vp_document(vector_space, index_state, due_at, id);
