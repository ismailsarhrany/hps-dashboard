#!/usr/bin/env python3
"""
Simple SSH connection test script
Run this outside of Django to isolate the SSH issue
"""

import paramiko
import logging

# Enable debug logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def test_ssh_connection():
    # Your server credentials
    hostname = "10.1.87.2"
    username = "pcad"
    password = "pca_d01*"  # Make sure this matches your database
    port = 22
    
    print(f"Testing SSH connection to {username}@{hostname}:{port}")
    print(f"Username: '{username}' (length: {len(username)})")
    print(f"Password: {'*' * len(password)} (length: {len(password)})")
    
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        connect_params = {
            'hostname': hostname,
            'port': port,
            'username': username,
            'password': password,
            'timeout': 15,
            'look_for_keys': False,
            'allow_agent': False
        }
        
        print("Attempting connection...")
        ssh.connect(**connect_params)
        
        print("✅ Connection successful!")
        
        # Test a simple command
        stdin, stdout, stderr = ssh.exec_command('whoami')
        output = stdout.read().decode().strip()
        error = stderr.read().decode().strip()
        
        print(f"Command output: {output}")
        if error:
            print(f"Command error: {error}")
        
        ssh.close()
        return True
        
    except paramiko.AuthenticationException as e:
        print(f"❌ Authentication failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False

if __name__ == "__main__":
    test_ssh_connection()