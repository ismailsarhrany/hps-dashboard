# metrics/utils/ssh_client.py
import paramiko
from django.conf import settings

class AIXClient:
    def __init__(self):
        self.host = settings.AIX_HOST
        self.user = settings.AIX_USER
        self.password = settings.AIX_PASSWORD
        
    def execute(self, command):
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(self.host, username=self.user, password=self.password, timeout=10)
            _, stdout, stderr = ssh.exec_command(command)
            if error := stderr.read().decode().strip():
                raise RuntimeError(f"Command failed: {error}")
            return stdout.read().decode().strip()
        finally:
            ssh.close()


