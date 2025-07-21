# metrics/utils/ssh_client.py
import paramiko
from django.conf import settings
from django.utils import timezone
import time
import logging
from typing import Dict, Optional, Any, List
from dataclasses import dataclass
from django.core.exceptions import ObjectDoesNotExist

logger = logging.getLogger(__name__)


@dataclass
class ServerConfig:
    """Configuration for a server connection."""
    host: str
    user: str
    password: Optional[str] = None
    private_key_path: Optional[str] = None
    port: int = 22
    timeout: int = 15
    banner_timeout: int = 200
    server_id: Optional[str] = None  # Link to Server model


class SSHClient:
    """Generic SSH client that can connect to any server."""
    
    def __init__(self, server_config: ServerConfig, max_retries: int = 3, retry_delay: int = 5):
        self.config = server_config
        self.ssh = None
        self.last_activity = time.time()
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self._server_instance = None
        self._connect()  # Initial connection attempt

    def _update_server_status(self, status: str, update_last_seen: bool = True):
        """Update server status in database if server_id is available."""
        if not self.config.server_id:
            return
            
        try:
            Server = apps.get_model('metrics', 'Server')
            # Import here to avoid circular imports
            from metrics.models import Server
            
            if not self._server_instance:
                self._server_instance = Server.objects.get(id=self.config.server_id)
            
            # Update server status
            if self._server_instance.status != status:
                self._server_instance.status = status
                self._server_instance.save(update_fields=['status'])
                
            # Update last seen timestamp
            if update_last_seen:
                self._server_instance.update_last_seen()
                
        except ObjectDoesNotExist:
            logger.warning(f"Server with ID {self.config.server_id} not found in database")
        except Exception as e:
            logger.error(f"Error updating server status: {e}")

    def _is_connected(self) -> bool:
        """Check if the SSH connection is active."""
        try:
            if self.ssh and self.ssh.get_transport() and self.ssh.get_transport().is_active():
                return True
        except EOFError:
            logger.warning(f"SSH connection check failed (EOFError) for {self.config.host}")
            self._update_server_status('error', update_last_seen=False)
        except Exception as e:
            logger.warning(f"SSH connection check failed for {self.config.host}: {str(e)}")
            self._update_server_status('error', update_last_seen=False)
        return False

    def _connect(self) -> bool:
        """Establish SSH connection with retries."""
        if self._is_connected():
            self._update_server_status('active')
            return True

        attempts = 0
        while attempts < self.max_retries:
            attempts += 1
            logger.info(f"Attempting SSH connection to {self.config.host}:{self.config.port} (Attempt {attempts}/{self.max_retries})...")
            
            try:
                # Close existing inactive/broken connection if any
                if self.ssh:
                    try:
                        self.ssh.close()
                    except Exception:
                        pass
                    self.ssh = None

                self.ssh = paramiko.SSHClient()
                self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                
                # Prepare connection parameters
                connect_params = {
                    'hostname': self.config.host,
                    'port': self.config.port,
                    'username': self.config.user,
                    'timeout': self.config.timeout,
                    'banner_timeout': self.config.banner_timeout,
                    'look_for_keys': False,
                    'allow_agent': False
                }
                
                # Add authentication method
                if self.config.password:
                    connect_params['password'] = self.config.password
                elif self.config.private_key_path:
                    connect_params['key_filename'] = self.config.private_key_path
                else:
                    logger.error(f"No authentication method provided for {self.config.host}")
                    self._update_server_status('error', update_last_seen=False)
                    return False
                
                self.ssh.connect(**connect_params)
                
                # Verify connection immediately after connect() call
                if self._is_connected():
                    logger.info(f"SSH connection to {self.config.host}:{self.config.port} established successfully.")
                    self.last_activity = time.time()
                    self._update_server_status('active')
                    return True
                else:
                    logger.warning(f"SSH connect() to {self.config.host} seemed to succeed but connection is not active.")
                    self.ssh = None

            except paramiko.AuthenticationException:
                logger.error(f"Authentication failed for {self.config.user}@{self.config.host}. Check credentials.")
                self.ssh = None
                self._update_server_status('error', update_last_seen=False)
                return False  # No point retrying auth errors
            except (paramiko.SSHException, TimeoutError, OSError) as e:
                logger.warning(f"SSH connection attempt {attempts} to {self.config.host} failed: {str(e)}")
                self.ssh = None
                self._update_server_status('error', update_last_seen=False)
                if attempts < self.max_retries:
                    logger.info(f"Retrying connection in {self.retry_delay} seconds...")
                    time.sleep(self.retry_delay)
                else:
                    logger.error(f"Failed to establish SSH connection to {self.config.host} after {self.max_retries} attempts.")
                    return False
            except Exception as e:
                logger.error(f"Unexpected error during SSH connection attempt {attempts} to {self.config.host}: {str(e)}")
                self.ssh = None
                self._update_server_status('error', update_last_seen=False)
                if attempts < self.max_retries:
                    time.sleep(self.retry_delay)
                else:
                    return False

        logger.error(f"SSH connection to {self.config.host} could not be established after {self.max_retries} attempts.")
        self._update_server_status('error', update_last_seen=False)
        return False

    def execute(self, command: str, timeout: int = 15) -> str:
        """Execute command with connection check and retries."""
        if not self._connect():
            logger.error(f"Cannot execute command '{command}': Failed to establish/maintain SSH connection to {self.config.host}.")
            raise RuntimeError(f"SSH connection unavailable for host {self.config.host}")

        try:
            logger.debug(f"Executing command on {self.config.host}: {command}")
            channel = self.ssh.get_transport().open_session()
            channel.settimeout(timeout)
            channel.exec_command(command)
            
            # Read stdout and stderr
            stderr_output = channel.recv_stderr(4096).decode(errors='ignore').strip()
            stdout_output = channel.recv(4096).decode(errors='ignore').strip()
            exit_status = channel.recv_exit_status()
            channel.close()
            
            self.last_activity = time.time()
            self._update_server_status('active')  # Update last seen on successful command

            if exit_status != 0:
                error_message = f"Command '{command}' exited with status {exit_status}. Stderr: '{stderr_output}'. Stdout: '{stdout_output[:100]}...'"
                logger.warning(error_message)
                raise RuntimeError(error_message)

            if stderr_output:
                logger.warning(f"Command '{command}' had stderr output despite exit status 0: '{stderr_output}'")

            logger.debug(f"Command '{command}' executed successfully. Output length: {len(stdout_output)}")
            return stdout_output

        except (paramiko.SSHException, TimeoutError, OSError) as e:
            logger.error(f"Error executing command '{command}' on {self.config.host}: {str(e)}")
            self._update_server_status('error', update_last_seen=False)
            self.close()
            raise RuntimeError(f"SSH execution error on {self.config.host}: {str(e)}") from e
        except Exception as e:
            logger.error(f"Unexpected error executing command '{command}' on {self.config.host}: {str(e)}")
            self._update_server_status('error', update_last_seen=False)
            self.close()
            raise RuntimeError(f"Unexpected execution error on {self.config.host}: {str(e)}") from e

    def close(self):
        """Close the SSH connection if open."""
        if self.ssh:
            logger.info(f"Closing SSH connection to {self.config.host}.")
            try:
                transport = self.ssh.get_transport()
                if transport and transport.is_active():
                    self.ssh.close()
            except Exception as e:
                logger.warning(f"Error during SSH connection close: {str(e)}")
            finally:
                self.ssh = None


class ServerManager:
    """Manages server configurations from the database."""
    
    def __init__(self):
        self._load_legacy_config()
    
    def _load_legacy_config(self):
        """Load legacy AIX configuration if it exists."""
        self._legacy_config = None
        try:
            if (hasattr(settings, 'AIX_HOST') and hasattr(settings, 'AIX_USER') and
                hasattr(settings, 'AIX_PASSWORD')):
                self._legacy_config = ServerConfig(
                    host=settings.AIX_HOST,
                    user=settings.AIX_USER,
                    password=settings.AIX_PASSWORD,
                    private_key_path=getattr(settings, 'AIX_PRIVATE_KEY_PATH', None)
                )
        except Exception as e:
            logger.warning(f"Error loading legacy AIX config: {e}")
    
    def get_server_by_id(self, server_id: str) -> Optional[ServerConfig]:
        """Get server configuration by database ID."""
        try:
            from metrics.models import Server
            server = Server.objects.get(id=server_id, status='active', monitoring_enabled=True)
            return self._server_model_to_config(server)
        except ObjectDoesNotExist:
            logger.error(f"Server with ID {server_id} not found or not active")
            return None
        except Exception as e:
            logger.error(f"Error fetching server {server_id}: {e}")
            return None
    
    def get_server_by_hostname(self, hostname: str) -> Optional[ServerConfig]:
        """Get server configuration by hostname."""
        try:
            from metrics.models import Server
            server = Server.objects.get(hostname=hostname, status='active', monitoring_enabled=True)
            return self._server_model_to_config(server)
        except ObjectDoesNotExist:
            logger.error(f"Server with hostname {hostname} not found or not active")
            return None
        except Exception as e:
            logger.error(f"Error fetching server {hostname}: {e}")
            return None
    
    def get_all_active_servers(self) -> List[ServerConfig]:
        """Get all active servers from database."""
        try:
            from metrics.models import Server
            servers = Server.objects.filter(status='active', monitoring_enabled=True)
            return [self._server_model_to_config(server) for server in servers]
        except Exception as e:
            logger.error(f"Error fetching active servers: {e}")
            return []
    
    def get_legacy_server(self) -> Optional[ServerConfig]:
        """Get legacy AIX server configuration."""
        return self._legacy_config
    
    def _server_model_to_config(self, server) -> ServerConfig:
        """Convert Django Server model to ServerConfig."""
        return ServerConfig(
            host=server.ip_address,
            user=server.ssh_username,
            password=server.ssh_password,
            private_key_path=server.ssh_key_path,
            port=server.ssh_port,
            timeout=15,  # Default timeout
            banner_timeout=200,  # Default banner timeout
            server_id=str(server.id)
        )


class ConnectionPool:
    """Thread-safe connection pool for managing SSH connections."""
    
    _instance = None
    
    def __new__(cls):
        if not cls._instance:
            cls._instance = super().__new__(cls)
            cls._pool: Dict[str, SSHClient] = {}
            cls._server_manager = ServerManager()
        return cls._instance
    
    def get_client_by_id(self, server_id: str) -> Optional[SSHClient]:
        """Get SSH client by server database ID."""
        server_config = self._server_manager.get_server_by_id(server_id)
        if not server_config:
            return None
        return self._get_or_create_client(f"id_{server_id}", server_config)
    
    def get_client_by_hostname(self, hostname: str) -> Optional[SSHClient]:
        """Get SSH client by hostname."""
        server_config = self._server_manager.get_server_by_hostname(hostname)
        if not server_config:
            return None
        return self._get_or_create_client(f"host_{hostname}", server_config)
    
    def get_legacy_client(self) -> Optional[SSHClient]:
        """Get legacy AIX client."""
        server_config = self._server_manager.get_legacy_server()
        if not server_config:
            return None
        return self._get_or_create_client("legacy_aix", server_config)
    
    def get_all_active_clients(self) -> Dict[str, SSHClient]:
        """Get clients for all active servers."""
        clients = {}
        active_servers = self._server_manager.get_all_active_servers()
        
        for server_config in active_servers:
            if server_config.server_id:
                client = self._get_or_create_client(f"id_{server_config.server_id}", server_config)
                if client:
                    clients[server_config.server_id] = client
        
        return clients
    
    def _get_or_create_client(self, pool_key: str, server_config: ServerConfig) -> Optional[SSHClient]:
        """Get or create SSH client for the pool."""
        # Check if we have an active connection
        if pool_key in self._pool and self._pool[pool_key]._is_connected():
            return self._pool[pool_key]
        
        # Create new connection
        try:
            client = SSHClient(server_config)
            if client._is_connected():
                self._pool[pool_key] = client
                return client
            else:
                logger.error(f"Failed to establish connection to {server_config.host}")
                return None
        except Exception as e:
            logger.error(f"Error creating SSH client for {server_config.host}: {str(e)}")
            return None
    
    def close_all(self):
        """Close all connections in the pool."""
        for client in self._pool.values():
            client.close()
        self._pool.clear()
    
    def health_check(self) -> Dict[str, Any]:
        """Check health of all connections."""
        health_status = {
            'total_servers': 0,
            'active_connections': 0,
            'failed_connections': 0,
            'servers': {}
        }
        
        try:
            from metrics.models import Server
            all_servers = Server.objects.filter(monitoring_enabled=True)
            health_status['total_servers'] = all_servers.count()
            
            for server in all_servers:
                server_key = str(server.id)
                try:
                    client = self.get_client_by_id(server_key)
                    if client and client._is_connected():
                        health_status['active_connections'] += 1
                        health_status['servers'][server_key] = {
                            'hostname': server.hostname,
                            'status': 'connected',
                            'last_activity': client.last_activity
                        }
                    else:
                        health_status['failed_connections'] += 1
                        health_status['servers'][server_key] = {
                            'hostname': server.hostname,
                            'status': 'disconnected',
                            'last_activity': None
                        }
                except Exception as e:
                    health_status['failed_connections'] += 1
                    health_status['servers'][server_key] = {
                        'hostname': server.hostname,
                        'status': 'error',
                        'error': str(e)
                    }
        except Exception as e:
            logger.error(f"Error during health check: {e}")
            health_status['error'] = str(e)
        
        return health_status


# Legacy compatibility class
class AIXClient(SSHClient):
    """Legacy AIX client for backward compatibility."""
    
    def __init__(self, max_retries: int = 3, retry_delay: int = 5):
        pool = ConnectionPool()
        legacy_config = pool._server_manager.get_legacy_server()
        
        if not legacy_config:
            # Fall back to direct settings access
            if not all([
                hasattr(settings, 'AIX_HOST'),
                hasattr(settings, 'AIX_USER'),
                hasattr(settings, 'AIX_PASSWORD')
            ]):
                raise ValueError("Legacy AIX configuration not found in settings")
            
            legacy_config = ServerConfig(
                host=settings.AIX_HOST,
                user=settings.AIX_USER,
                password=settings.AIX_PASSWORD,
                private_key_path=getattr(settings, 'AIX_PRIVATE_KEY_PATH', None)
            )
        
        super().__init__(legacy_config, max_retries, retry_delay)


# Convenience functions
def get_ssh_client(server_identifier: str, by_hostname: bool = False) -> Optional[SSHClient]:
    """Get SSH client by server ID or hostname."""
    pool = ConnectionPool()
    if by_hostname:
        return pool.get_client_by_hostname(server_identifier)
    else:
        return pool.get_client_by_id(server_identifier)


def get_all_ssh_clients() -> Dict[str, SSHClient]:
    """Get SSH clients for all active servers."""
    pool = ConnectionPool()
    return pool.get_all_active_clients()


def get_legacy_ssh_client() -> Optional[SSHClient]:
    """Get legacy AIX SSH client."""
    pool = ConnectionPool()
    return pool.get_legacy_client()


def ssh_health_check() -> Dict[str, Any]:
    """Check SSH connection health for all servers."""
    pool = ConnectionPool()
    return pool.health_check()