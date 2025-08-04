# #!/usr/bin/env python3
# """
# Debug script to test SSH connections to your servers
# Run this from your Django environment to diagnose connection issues
# """

# import paramiko
# import sys
# import os
# from pathlib import Path

# def test_ssh_connection(host, port, username, password=None, key_path=None):
#     """Test SSH connection with detailed error reporting"""
#     print(f"\n=== Testing connection to {username}@{host}:{port} ===")
    
#     client = paramiko.SSHClient()
#     client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
#     try:
#         # Prepare connection parameters
#         connect_params = {
#             'hostname': host,
#             'port': port,
#             'username': username,
#             'timeout': 15,
#             'banner_timeout': 200,
#             'look_for_keys': False,
#             'allow_agent': False
#         }
        
#         # Add authentication
#         if password:
#             connect_params['password'] = password
#             print(f"Using password authentication")
#         elif key_path:
#             if os.path.exists(key_path):
#                 connect_params['key_filename'] = key_path
#                 print(f"Using key file: {key_path}")
#                 # Check key permissions
#                 stat_info = os.stat(key_path)
#                 permissions = oct(stat_info.st_mode)[-3:]
#                 print(f"Key file permissions: {permissions}")
#                 if permissions != '600':
#                     print(f"WARNING: Key permissions should be 600, not {permissions}")
#             else:
#                 print(f"ERROR: Key file not found: {key_path}")
#                 return False
        
#         print("Attempting connection...")
#         client.connect(**connect_params)
        
#         # Test command execution
#         print("Testing command execution...")
#         stdin, stdout, stderr = client.exec_command('echo "Connection test successful"')
#         result = stdout.read().decode().strip()
#         error = stderr.read().decode().strip()
        
#         if result:
#             print(f"✅ SUCCESS: {result}")
#         if error:
#             print(f"⚠️  stderr: {error}")
            
#         # Test system commands that your monitoring uses
#         test_commands = [
#             'hostname',
#             'uname -a',
#             'vmstat 1 1',
#             'iostat 1 1',
#             'netstat -i',
#             'ps -ef | head -5'
#         ]
        
#         print("\nTesting monitoring commands:")
#         for cmd in test_commands:
#             try:
#                 stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
#                 exit_status = stdout.channel.recv_exit_status()
#                 if exit_status == 0:
#                     print(f"✅ {cmd}: OK")
#                 else:
#                     error_msg = stderr.read().decode().strip()
#                     print(f"❌ {cmd}: Failed (exit {exit_status}) - {error_msg}")
#             except Exception as e:
#                 print(f"❌ {cmd}: Exception - {str(e)}")
        
#         client.close()
#         return True
        
#     except paramiko.AuthenticationException as e:
#         print(f"❌ Authentication failed: {str(e)}")
#         return False
#     except paramiko.SSHException as e:
#         print(f"❌ SSH error: {str(e)}")
#         return False
#     except Exception as e:
#         print(f"❌ Connection error: {str(e)}")
#         return False
#     finally:
#         if client:
#             client.close()

# def main():
#     """Test connections for both servers"""
#     print("SSH Connection Diagnostic Tool")
#     print("=" * 50)
    
#     # Test aix1 (simulated server)
#     success1 = test_ssh_connection(
#         host='localhost',  # Try localhost first
#         port=2222,
#         username='root',
#         key_path='/app/.ssh/id_rsa'  # Adjust path as needed
#     )
    
#     # If localhost fails, try the IP from your config
#     if not success1:
#         print("\nRetrying with configured IP...")
#         success1 = test_ssh_connection(
#             host='10.1.19.30',
#             port=2222,
#             username='root',
#             key_path='/app/.ssh/id_rsa'
#         )
    
#     # Test pcad (real server)
#     success2 = test_ssh_connection(
#         host='10.1.87.2',
#         port=22,
#         username='pcad',
#         password='pca_d01*'
#     )
    
#     print(f"\n=== SUMMARY ===")
#     print(f"aix1 connection: {'✅ SUCCESS' if success1 else '❌ FAILED'}")
#     print(f"pcad connection: {'✅ SUCCESS' if success2 else '❌ FAILED'}")
    
#     if not success1:
#         print(f"\n🔧 TROUBLESHOOTING aix1:")
#         print(f"1. Check if Docker container is running: docker ps")
#         print(f"2. Check if port 2222 is accessible: nc -zv localhost 2222")
#         print(f"3. Verify SSH key exists: ls -la /app/.ssh/id_rsa")
#         print(f"4. Check container logs: docker logs [container_name]")
#         print(f"5. Try SSH manually: ssh -i /app/.ssh/id_rsa -p 2222 root@localhost")

# if __name__ == "__main__":
#     main()



from cryptography.fernet import Fernet

# Generate a secure key
key = Fernet.generate_key()

# Print or store your FIELD_ENCRYPTION_KEY
print(key.decode())
