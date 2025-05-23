# metrics/utils/ssh_client.py
import paramiko
from django.conf import settings
import time

class AIXClient:
    def __init__(self):
        self.host = settings.AIX_HOST
        self.user = settings.AIX_USER
        self.password = settings.AIX_PASSWORD
        self.ssh = None
        self.last_activity = time.time()
        
    def _ensure_connection(self):
        if not self.ssh or not self.ssh.get_transport().is_active():
            self.ssh = paramiko.SSHClient()
            self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            self.ssh.connect(
                self.host, 
                username=self.user, 
                password=self.password, 
                timeout=10,
                banner_timeout=200
            )
        self.last_activity = time.time()

    def execute(self, command):
        try:
            self._ensure_connection()
            _, stdout, stderr = self.ssh.exec_command(command, timeout=15)
            output = stdout.read().decode().strip()
            error = stderr.read().decode().strip()
            
            if error:
                raise RuntimeError(f"Command failed: {error}")
            return output
        except paramiko.SSHException as e:
            self.close()
            raise RuntimeError(f"SSH connection error: {str(e)}") from e
            
    def close(self):
        if self.ssh:
            self.ssh.close()
            self.ssh = None

class ConnectionPool:
    _instance = None
    def __new__(cls):
        if not cls._instance:
            cls._instance = super().__new__(cls)
            cls._pool = {}
        return cls._instance
    
    def get_client(self, host):
        if host not in self._pool or not self._pool[host].ssh.get_transport().is_active():
            client = AIXClient()
            client.host = host
            client._ensure_connection()
            self._pool[host] = client
        return self._pool[host]