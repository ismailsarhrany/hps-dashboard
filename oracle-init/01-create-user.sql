-- Create user in root container (CDB)
CREATE USER testuser IDENTIFIED BY testpass;
GRANT CONNECT, RESOURCE TO testuser;
ALTER USER testuser QUOTA UNLIMITED ON USERS;