import oracledb
import time
import random
from datetime import datetime

# Database connection parameters
DB_USER = "testuser"
DB_PASSWORD = "testpass"
DB_HOST = "localhost"
DB_PORT = 1521
DB_SID = "XE"

# Table creation SQL
CREATE_TABLE_SQL = """
CREATE TABLE transaction_auth (
    id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transaction_id VARCHAR2(36) NOT NULL,
    status VARCHAR2(20) NOT NULL,
    amount NUMBER(10,2) NOT NULL,
    merchant_name VARCHAR2(100),
    card_last4 CHAR(4),
    transaction_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
"""

def create_table(conn):
    """Create table if it doesn't exist"""
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT table_name 
            FROM user_tables 
            WHERE table_name = 'TRANSACTION_AUTH'
        """)
        if not cursor.fetchone():
            cursor.execute(CREATE_TABLE_SQL)
            print("✅ Table TRANSACTION_AUTH created")
    except oracledb.DatabaseError as e:
        print(f"Table check failed: {e}")
    finally:
        cursor.close()

def generate_transaction():
    """Generate simulated transaction data"""
    return {
        "transaction_id": str(random.randint(10**15, 10**16 - 1)),  # 16-digit number
        "status": random.choice(["APPROVED", "DECLINED", "PENDING"]),
        "amount": round(random.uniform(1.0, 1000.0), 2),
        "merchant_name": random.choice(["Amazon", "Walmart", "Netflix", "Spotify", "Apple"]),
        "card_last4": str(random.randint(1000, 9999))
    }

def insert_transaction(conn, transaction):
    """Insert transaction into database"""
    sql = """
    INSERT INTO transaction_auth (
        transaction_id, status, amount, merchant_name, card_last4
    ) VALUES (:1, :2, :3, :4, :5)
    """
    cursor = conn.cursor()
    try:
        cursor.execute(sql, (
            transaction["transaction_id"],
            transaction["status"],
            transaction["amount"],
            transaction["merchant_name"],
            transaction["card_last4"]
        ))
        conn.commit()
        print(f"✅ Inserted transaction: {transaction['transaction_id']} ({transaction['status']})")
    except oracledb.DatabaseError as e:
        print(f"Insert failed: {e}")
    finally:
        cursor.close()

def main():
    try:
        # Establish database connection
        dsn = oracledb.makedsn(DB_HOST, DB_PORT, sid=DB_SID)
        conn = oracledb.connect(user=DB_USER, password=DB_PASSWORD, dsn=dsn)
        print("✅ Connected to Oracle database")
        
        # Ensure table exists
        create_table(conn)
        
        # Continuous insertion loop
        print("Starting transaction simulation (Ctrl+C to stop)...")
        while True:
            # Generate and insert transaction
            transaction = generate_transaction()
            insert_transaction(conn, transaction)
            
            # Wait random interval (30-45 seconds)
            sleep_time = random.randint(30, 45)
            print(f"Next insertion in {sleep_time} seconds at {datetime.now().strftime('%H:%M:%S')}")
            time.sleep(sleep_time)
            
    except oracledb.Error as e:
        print(f"Database connection failed: {e}")
    except KeyboardInterrupt:
        print("\nOperation stopped by user")
    finally:
        if 'conn' in locals():
            conn.close()
            print("Database connection closed")

if __name__ == "__main__":
    main()