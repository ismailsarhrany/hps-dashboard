-- Create sample table
CREATE TABLE test_table (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR2(50) NOT NULL,
    created_date TIMESTAMP DEFAULT SYSTIMESTAMP
);

-- Insert sample data
INSERT INTO test_table (name) VALUES ('Test Item 1');
INSERT INTO test_table (name) VALUES ('Test Item 2');
COMMIT;