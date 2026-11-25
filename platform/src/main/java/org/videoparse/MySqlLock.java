package org.videoparse;

import java.sql.Connection;
import java.sql.SQLException;

/** A named lock belongs to its connection and must be released before it returns to the pool. */
final class MySqlLock implements AutoCloseable {
    private final Connection connection;
    private final String name;

    private MySqlLock(Connection connection, String name) {
        this.connection = connection;
        this.name = name;
    }

    static MySqlLock tryAcquire(Connection connection, String name) throws SQLException {
        var lock = new MySqlLock(connection, name);
        return lock.execute("SELECT GET_LOCK(?,0)") ? lock : null;
    }

    private boolean execute(String sql) throws SQLException {
        try (var statement = connection.prepareStatement(sql)) {
            statement.setString(1, name);
            try (var row = statement.executeQuery()) { return row.next() && row.getInt(1) == 1; }
        }
    }

    @Override public void close() throws SQLException {
        execute("SELECT RELEASE_LOCK(?)");
    }
}
