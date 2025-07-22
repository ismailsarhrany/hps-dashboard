# # metrics/utils/ssh_client.py
# import paramiko
# from django.conf import settings
# from django.utils import timezone
# import time
# import logging
# from typing import Dict, Optional, Any, List
# from dataclasses import dataclass
# from django.core.exceptions import ObjectDoesNotExist

# logger = logging.getLogger(__name__)


# @dataclass
# class ServerConfig:
#     """Configuration for a server connection."""
#     host: str
#     user: str
#     password: Optional[str] = None
#     private_key_path: Optional[str] = None
#     port: int = 22
#     timeout: int = 15
#     banner_timeout: int = 200
#     server_id: Optional[str] = None  # Link to Server model


# class SSHClient:
#     """Generic SSH client that can connect to any server."""
    
#     def __init__(self, server_config: ServerConfig, max_retries: int = 3, retry_delay: int = 5):
#         self.config = server_config
#         self.ssh = None
#         self.last_activity = time.time()
#         self.max_retries = max_retries
#         self.retry_delay = retry_delay
#         self._server_instance = None
#         self._connect()  # Initial connection attempt

#     def _update_server_status(self, status: str, update_last_seen: bool = True):
#         """Update server status in database if server_id is available."""
#         if not self.config.server_id:
#             return
            
#         try:
#             from metrics.models import Server
#             # Server = get_model('metrics', 'Server')            
#             if not self._server_instance:
#                 self._server_instance = Server.objects.get(id=self.config.server_id)
            
#             # Update server status
#             if self._server_instance.status != status:
#                 self._server_instance.status = status
#                 self._server_instance.save(update_fields=['status'])
                
#             # Update last seen timestamp
#             if update_last_seen:
#                 self._server_instance.update_last_seen()
                
#         except ObjectDoesNotExist:
#             logger.warning(f"Server with ID {self.config.server_id} not found in database")
#         except Exception as e:
#             logger.error(f"Error updating server status: {e}")

#     def _is_connected(self) -> bool:
#         """Check if the SSH connection is active."""
#         try:
#             if self.ssh and self.ssh.get_transport() and self.ssh.get_transport().is_active():
#                 return True
#         except EOFError:
#             logger.warning(f"SSH connection check failed (EOFError) for {self.config.host}")
#             self._update_server_status('error', update_last_seen=False)
#         except Exception as e:
#             logger.warning(f"SSH connection check failed for {self.config.host}: {str(e)}")
#             self._update_server_status('error', update_last_seen=False)
#         return False

#     def _connect(self) -> bool:
#         """Establish SSH connection with retries."""
#         if self._is_connected():
#             self._update_server_status('active')
#             return True

#         attempts = 0
#         while attempts < self.max_retries:
#             attempts += 1
#             logger.info(f"Attempting SSH connection to {self.config.host}:{self.config.port} (Attempt {attempts}/{self.max_retries})...")
            
#             try:
#                 # Close existing inactive/broken connection if any
#                 if self.ssh:
#                     try:
#                         self.ssh.close()
#                     except Exception:
#                         pass
#                     self.ssh = None

#                 self.ssh = paramiko.SSHClient()
#                 self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                
#                 # Prepare connection parameters
#                 connect_params = {
#                     'hostname': self.config.host,
#                     'port': self.config.port,
#                     'username': self.config.user,
#                     'timeout': self.config.timeout,
#                     'banner_timeout': self.config.banner_timeout,
#                     'look_for_keys': False,
#                     'allow_agent': False
#                 }
                
#                 # Add authentication method
#                 if self.config.password:
#                     connect_params['password'] = self.config.password
#                 elif self.config.private_key_path:
#                     connect_params['key_filename'] = self.config.private_key_path
#                 else:
#                     logger.error(f"No authentication method provided for {self.config.host}")
#                     self._update_server_status('error', update_last_seen=False)
#                     return False
                
#                 self.ssh.connect(**connect_params)
                
#                 # Verify connection immediately after connect() call
#                 if self._is_connected():
#                     logger.info(f"SSH connection to {self.config.host}:{self.config.port} established successfully.")
#                     self.last_activity = time.time()
#                     self._update_server_status('active')
#                     return True
#                 else:
#                     logger.warning(f"SSH connect() to {self.config.host} seemed to succeed but connection is not active.")
#                     self.ssh = None

#             except paramiko.AuthenticationException:
#                 logger.error(f"Authentication failed for {self.config.user}@{self.config.host}. Check credentials.")
#                 self.ssh = None
#                 self._update_server_status('error', update_last_seen=False)
#                 return False  # No point retrying auth errors
#             except (paramiko.SSHException, TimeoutError, OSError) as e:
#                 logger.warning(f"SSH connection attempt {attempts} to {self.config.host} failed: {str(e)}")
#                 self.ssh = None
#                 self._update_server_status('error', update_last_seen=False)
#                 if attempts < self.max_retries:
#                     logger.info(f"Retrying connection in {self.retry_delay} seconds...")
#                     time.sleep(self.retry_delay)
#                 else:
#                     logger.error(f"Failed to establish SSH connection to {self.config.host} after {self.max_retries} attempts.")
#                     return False
#             except Exception as e:
#                 logger.error(f"Unexpected error during SSH connection attempt {attempts} to {self.config.host}: {str(e)}")
#                 self.ssh = None
#                 self._update_server_status('error', update_last_seen=False)
#                 if attempts < self.max_retries:
#                     time.sleep(self.retry_delay)
#                 else:
#                     return False

#         logger.error(f"SSH connection to {self.config.host} could not be established after {self.max_retries} attempts.")
#         self._update_server_status('error', update_last_seen=False)
#         return False

#     def execute(self, command: str, timeout: int = 15) -> str:
#         """Execute command with connection check and retries."""
#         if not self._connect():
#             logger.error(f"Cannot execute command '{command}': Failed to establish/maintain SSH connection to {self.config.host}.")
#             raise RuntimeError(f"SSH connection unavailable for host {self.config.host}")

#         try:
#             logger.debug(f"Executing command on {self.config.host}: {command}")
#             channel = self.ssh.get_transport().open_session()
#             channel.settimeout(timeout)
#             channel.exec_command(command)
            
#             # Read stdout and stderr
#             stderr_output = channel.recv_stderr(4096).decode(errors='ignore').strip()
#             stdout_output = channel.recv(4096).decode(errors='ignore').strip()
#             exit_status = channel.recv_exit_status()
#             channel.close()
            
#             self.last_activity = time.time()
#             self._update_server_status('active')  # Update last seen on successful command

#             if exit_status != 0:
#                 error_message = f"Command '{command}' exited with status {exit_status}. Stderr: '{stderr_output}'. Stdout: '{stdout_output[:100]}...'"
#                 logger.warning(error_message)
#                 raise RuntimeError(error_message)

#             if stderr_output:
#                 logger.warning(f"Command '{command}' had stderr output despite exit status 0: '{stderr_output}'")

#             logger.debug(f"Command '{command}' executed successfully. Output length: {len(stdout_output)}")
#             return stdout_output

#         except (paramiko.SSHException, TimeoutError, OSError) as e:
#             logger.error(f"Error executing command '{command}' on {self.config.host}: {str(e)}")
#             self._update_server_status('error', update_last_seen=False)
#             self.close()
#             raise RuntimeError(f"SSH execution error on {self.config.host}: {str(e)}") from e
#         except Exception as e:
#             logger.error(f"Unexpected error executing command '{command}' on {self.config.host}: {str(e)}")
#             self._update_server_status('error', update_last_seen=False)
#             self.close()
#             raise RuntimeError(f"Unexpected execution error on {self.config.host}: {str(e)}") from e

#     def close(self):
#         """Close the SSH connection if open."""
#         if self.ssh:
#             logger.info(f"Closing SSH connection to {self.config.host}.")
#             try:
#                 transport = self.ssh.get_transport()
#                 if transport and transport.is_active():
#                     self.ssh.close()
#             except Exception as e:
#                 logger.warning(f"Error during SSH connection close: {str(e)}")
#             finally:
#                 self.ssh = None


# class ServerManager:
#     """Manages server configurations from the database."""
    
#     def __init__(self):
#         self._load_legacy_config()
    
#     def _load_legacy_config(self):
#         """Load legacy AIX configuration if it exists."""
#         self._legacy_config = None
#         try:
#             if (hasattr(settings, 'AIX_HOST') and hasattr(settings, 'AIX_USER') and
#                 hasattr(settings, 'AIX_PASSWORD')):
#                 self._legacy_config = ServerConfig(
#                     host=settings.AIX_HOST,
#                     user=settings.AIX_USER,
#                     password=settings.AIX_PASSWORD,
#                     private_key_path=getattr(settings, 'AIX_PRIVATE_KEY_PATH', None)
#                 )
#         except Exception as e:
#             logger.warning(f"Error loading legacy AIX config: {e}")
    
#     def get_server_by_id(self, server_id: str) -> Optional[ServerConfig]:
#         """Get server configuration by database ID."""
#         try:
#             from metrics.models import Server
#             server = Server.objects.get(id=server_id, status='active', monitoring_enabled=True)
#             return self._server_model_to_config(server)
#         except ObjectDoesNotExist:
#             logger.error(f"Server with ID {server_id} not found or not active")
#             return None
#         except Exception as e:
#             logger.error(f"Error fetching server {server_id}: {e}")
#             return None
    
#     def get_server_by_hostname(self, hostname: str) -> Optional[ServerConfig]:
#         """Get server configuration by hostname."""
#         try:
#             from metrics.models import Server
#             server = Server.objects.get(hostname=hostname, status='active', monitoring_enabled=True)
#             return self._server_model_to_config(server)
#         except ObjectDoesNotExist:
#             logger.error(f"Server with hostname {hostname} not found or not active")
#             return None
#         except Exception as e:
#             logger.error(f"Error fetching server {hostname}: {e}")
#             return None
    
#     def get_all_active_servers(self) -> List[ServerConfig]:
#         """Get all active servers from database."""
#         try:
#             from metrics.models import Server
#             servers = Server.objects.filter(status='active', monitoring_enabled=True)
#             return [self._server_model_to_config(server) for server in servers]
#         except Exception as e:
#             logger.error(f"Error fetching active servers: {e}")
#             return []
    
#     def get_legacy_server(self) -> Optional[ServerConfig]:
#         """Get legacy AIX server configuration."""
#         return self._legacy_config
    
#     def _server_model_to_config(self, server) -> ServerConfig:
#         """Convert Django Server model to ServerConfig."""
#         return ServerConfig(
#             host=server.ip_address,
#             user=server.ssh_username,
#             password=server.ssh_password,
#             private_key_path=server.ssh_key_path,
#             port=server.ssh_port,
#             timeout=15,  # Default timeout
#             banner_timeout=200,  # Default banner timeout
#             server_id=str(server.id)
#         )


# class ConnectionPool:
#     """Thread-safe connection pool for managing SSH connections."""
    
#     _instance = None
    
#     def __new__(cls):
#         if not cls._instance:
#             cls._instance = super().__new__(cls)
#             cls._pool: Dict[str, SSHClient] = {}
#             cls._server_manager = ServerManager()
#         return cls._instance
    
#     def get_client_by_id(self, server_id: str) -> Optional[SSHClient]:
#         """Get SSH client by server database ID."""
#         server_config = self._server_manager.get_server_by_id(server_id)
#         if not server_config:
#             return None
#         return self._get_or_create_client(f"id_{server_id}", server_config)
    
#     def get_client_by_hostname(self, hostname: str) -> Optional[SSHClient]:
#         """Get SSH client by hostname."""
#         server_config = self._server_manager.get_server_by_hostname(hostname)
#         if not server_config:
#             return None
#         return self._get_or_create_client(f"host_{hostname}", server_config)
    
#     def get_legacy_client(self) -> Optional[SSHClient]:
#         """Get legacy AIX client."""
#         server_config = self._server_manager.get_legacy_server()
#         if not server_config:
#             return None
#         return self._get_or_create_client("legacy_aix", server_config)
    
#     def get_all_active_clients(self) -> Dict[str, SSHClient]:
#         """Get clients for all active servers."""
#         clients = {}
#         active_servers = self._server_manager.get_all_active_servers()
        
#         for server_config in active_servers:
#             if server_config.server_id:
#                 client = self._get_or_create_client(f"id_{server_config.server_id}", server_config)
#                 if client:
#                     clients[server_config.server_id] = client
        
#         return clients
    
#     def _get_or_create_client(self, pool_key: str, server_config: ServerConfig) -> Optional[SSHClient]:
#         """Get or create SSH client for the pool."""
#         # Check if we have an active connection
#         if pool_key in self._pool and self._pool[pool_key]._is_connected():
#             return self._pool[pool_key]
        
#         # Create new connection
#         try:
#             client = SSHClient(server_config)
#             if client._is_connected():
#                 self._pool[pool_key] = client
#                 return client
#             else:
#                 logger.error(f"Failed to establish connection to {server_config.host}")
#                 return None
#         except Exception as e:
#             logger.error(f"Error creating SSH client for {server_config.host}: {str(e)}")
#             return None
    
#     def close_all(self):
#         """Close all connections in the pool."""
#         for client in self._pool.values():
#             client.close()
#         self._pool.clear()
    
#     def health_check(self) -> Dict[str, Any]:
#         """Check health of all connections."""
#         health_status = {
#             'total_servers': 0,
#             'active_connections': 0,
#             'failed_connections': 0,
#             'servers': {}
#         }
        
#         try:
#             from metrics.models import Server
#             all_servers = Server.objects.filter(monitoring_enabled=True)
#             health_status['total_servers'] = all_servers.count()
            
#             for server in all_servers:
#                 server_key = str(server.id)
#                 try:
#                     client = self.get_client_by_id(server_key)
#                     if client and client._is_connected():
#                         health_status['active_connections'] += 1
#                         health_status['servers'][server_key] = {
#                             'hostname': server.hostname,
#                             'status': 'connected',
#                             'last_activity': client.last_activity
#                         }
#                     else:
#                         health_status['failed_connections'] += 1
#                         health_status['servers'][server_key] = {
#                             'hostname': server.hostname,
#                             'status': 'disconnected',
#                             'last_activity': None
#                         }
#                 except Exception as e:
#                     health_status['failed_connections'] += 1
#                     health_status['servers'][server_key] = {
#                         'hostname': server.hostname,
#                         'status': 'error',
#                         'error': str(e)
#                     }
#         except Exception as e:
#             logger.error(f"Error during health check: {e}")
#             health_status['error'] = str(e)
        
#         return health_status


# # Legacy compatibility class
# class AIXClient(SSHClient):
#     """Legacy AIX client for backward compatibility."""
    
#     def __init__(self, max_retries: int = 3, retry_delay: int = 5):
#         pool = ConnectionPool()
#         legacy_config = pool._server_manager.get_legacy_server()
        
#         if not legacy_config:
#             # Fall back to direct settings access
#             if not all([
#                 hasattr(settings, 'AIX_HOST'),
#                 hasattr(settings, 'AIX_USER'),
#                 hasattr(settings, 'AIX_PASSWORD')
#             ]):
#                 raise ValueError("Legacy AIX configuration not found in settings")
            
#             legacy_config = ServerConfig(
#                 host=settings.AIX_HOST,
#                 user=settings.AIX_USER,
#                 password=settings.AIX_PASSWORD,
#                 private_key_path=getattr(settings, 'AIX_PRIVATE_KEY_PATH', None)
#             )
        
#         super().__init__(legacy_config, max_retries, retry_delay)


# # Convenience functions
# def get_ssh_client(server_identifier: str, by_hostname: bool = False) -> Optional[SSHClient]:
#     """Get SSH client by server ID or hostname."""
#     pool = ConnectionPool()
#     if by_hostname:
#         return pool.get_client_by_hostname(server_identifier)
#     else:
#         return pool.get_client_by_id(server_identifier)


# def get_all_ssh_clients() -> Dict[str, SSHClient]:
#     """Get SSH clients for all active servers."""
#     pool = ConnectionPool()
#     return pool.get_all_active_clients()


# def get_legacy_ssh_client() -> Optional[SSHClient]:
#     """Get legacy AIX SSH client."""
#     pool = ConnectionPool()
#     return pool.get_legacy_client()


# def ssh_health_check() -> Dict[str, Any]:
#     """Check SSH connection health for all servers."""
#     pool = ConnectionPool()
#     return pool.health_check()

# metrics/utils/ssh_client.py
import paramiko
from django.conf import settings
from django.utils import timezone
import time
import logging
from typing import Dict, Optional, Any, List, Tuple
from dataclasses import dataclass
from django.core.exceptions import ObjectDoesNotExist
import threading
import uuid
from collections import OrderedDict

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
    server_id: Optional[str] = None

class SSHClient:
    """Enhanced SSH client with robust connection management and detailed logging."""
    
    def __init__(self, server_config: ServerConfig, max_retries: int = 3, retry_delay: int = 5):
        self.config = server_config
        self.ssh = None
        self.last_activity = time.time()
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self._server_instance = None
        self._lock = threading.Lock()
        
        # Log initialization details
        logger.debug(f"Initializing SSHClient for {server_config.user}@{server_config.host}:{server_config.port}")
        if server_config.private_key_path:
            logger.debug(f"Using private key authentication: {server_config.private_key_path}")
        elif server_config.password:
            logger.debug("Using password authentication")
        else:
            logger.warning("No authentication method provided!")
            
        self._connect()

    def _update_server_status(self, status: str, update_last_seen: bool = True):
        """Update server status in database if server_id is available."""
        if not self.config.server_id:
            logger.debug("No server ID available, skipping status update")
            return
            
        try:
            from metrics.models import Server
            if not self._server_instance:
                logger.debug(f"Fetching server instance for ID: {self.config.server_id}")
                self._server_instance = Server.objects.get(id=self.config.server_id)
            
            with self._lock:
                if self._server_instance.status != status:
                    logger.info(f"Updating server status: {self._server_instance.status} -> {status}")
                    self._server_instance.status = status
                    self._server_instance.save(update_fields=['status'])
                
                if update_last_seen:
                    logger.debug("Updating last seen timestamp")
                    self._server_instance.last_seen = timezone.now()
                    self._server_instance.save(update_fields=['last_seen'])
                
        except ObjectDoesNotExist:
            logger.error(f"Server {self.config.server_id} not found in database")
        except Exception as e:
            logger.exception(f"Error updating server status: {str(e)}")

    def _is_connected(self) -> bool:
        """Robust connection check with transport validation."""
        try:
            if self.ssh and self.ssh.get_transport() and self.ssh.get_transport().is_active():
                # Test connection with null command
                logger.debug("Testing connection with null command")
                self.ssh.exec_command("", timeout=2)
                logger.debug("Connection test successful")
                return True
        except Exception as e:
            logger.warning(f"Connection test failed: {str(e)}")
        return False

    def _connect(self) -> bool:
        """Establish SSH connection with exponential backoff and detailed logging."""
        if self._is_connected():
            logger.debug("Already connected, skipping new connection")
            self._update_server_status('active')
            return True

        logger.info(f"Initiating connection to {self.config.host}:{self.config.port}")
        
        for attempt in range(1, self.max_retries + 1):
            try:
                logger.debug(f"Connection attempt {attempt}/{self.max_retries}")
                
                # Cleanup previous connection if exists
                if self.ssh:
                    logger.debug("Cleaning up previous connection")
                    try:
                        self.ssh.close()
                    except Exception as e:
                        logger.warning(f"Error closing previous connection: {str(e)}")
                    finally:
                        self.ssh = None

                # Create new connection
                logger.debug("Creating new SSH client instance")
                self.ssh = paramiko.SSHClient()
                self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                
                auth_params = {}
                if self.config.password:
                    auth_params['password'] = self.config.password
                    logger.debug("Using password authentication")
                if self.config.private_key_path:
                    auth_params['key_filename'] = self.config.private_key_path
                    logger.debug(f"Using private key: {self.config.private_key_path}")
                
                logger.debug(f"Connection parameters: host={self.config.host}, port={self.config.port}, "
                            f"user={self.config.user}, timeout={self.config.timeout}, "
                            f"banner_timeout={self.config.banner_timeout}")
                
                self.ssh.connect(
                    hostname=self.config.host,
                    port=self.config.port,
                    username=self.config.user,
                    timeout=self.config.timeout,
                    banner_timeout=self.config.banner_timeout,
                    look_for_keys=False,
                    allow_agent=False,
                    **auth_params
                )
                
                logger.debug("SSH.connect() completed without exception")
                
                if self._is_connected():
                    logger.info(f"Successfully connected to {self.config.host}")
                    self._update_server_status('active')
                    return True
                else:
                    logger.error("SSH.connect() succeeded but connection is not active")
                    
            except paramiko.AuthenticationException as e:
                logger.exception(f"Authentication failed for {self.config.user}@{self.config.host}")
                self._update_server_status('error', False)
                break  # Don't retry auth errors
            except (paramiko.SSHException, TimeoutError, OSError) as e:
                logger.exception(f"Connection attempt {attempt} failed: {type(e).__name__}: {str(e)}")
                self._update_server_status('error', False)
                if attempt < self.max_retries:
                    sleep_time = self.retry_delay * (2 ** (attempt - 1))
                    logger.info(f"Retrying in {sleep_time}s...")
                    time.sleep(sleep_time)
                else:
                    logger.error(f"Final connection attempt failed after {self.max_retries} retries")
            except Exception as e:
                logger.exception(f"Unexpected connection error: {type(e).__name__}: {str(e)}")
                self._update_server_status('error', False)
                break

        logger.error(f"Connection to {self.config.host} failed after all attempts")
        return False

    def execute(self, command: str, timeout: int = 30) -> Tuple[int, str, str]:
        """Execute command with comprehensive output handling and detailed logging."""
        logger.debug(f"Preparing to execute command: '{command}' with timeout={timeout}")
        
        if not self._connect():
            error_msg = f"SSH connection unavailable for {self.config.host}"
            logger.error(error_msg)
            raise ConnectionError(error_msg)

        try:
            logger.info(f"Executing command on {self.config.host}: {command}")
            stdin, stdout, stderr = self.ssh.exec_command(command, timeout=timeout)
            logger.debug("Command execution started, waiting for exit status")
            
            exit_status = stdout.channel.recv_exit_status()
            logger.debug(f"Command exited with status: {exit_status}")
            
            # Read output efficiently
            stdout_str = stdout.read().decode().strip()
            stderr_str = stderr.read().decode().strip()
            
            logger.debug(f"stdout length: {len(stdout_str)} characters")
            logger.debug(f"stderr length: {len(stderr_str)} characters")
            
            self.last_activity = time.time()
            self._update_server_status('active')
            
            if exit_status != 0:
                logger.warning(f"Command failed (exit {exit_status}): {stderr_str[:500]}")
            elif stderr_str:
                logger.info(f"Command succeeded with stderr: {stderr_str[:500]}")
            
            return exit_status, stdout_str, stderr_str
            
        except paramiko.SSHException as e:
            logger.exception(f"SSH protocol error during execution: {str(e)}")
            self._update_server_status('error', False)
            self.close()
            raise
        except Exception as e:
            logger.exception(f"Unexpected execution error: {type(e).__name__}: {str(e)}")
            self._update_server_status('error', False)
            self.close()
            raise

    def close(self):
        """Safely close connection with error handling and detailed logging."""
        if self.ssh:
            logger.info(f"Closing connection to {self.config.host}")
            try:
                transport = self.ssh.get_transport() if self.ssh else None
                if transport and transport.is_active():
                    logger.debug("Transport is active, closing")
                    self.ssh.close()
                    logger.debug("Connection closed")
                else:
                    logger.debug("Transport not active or already closed")
            except Exception as e:
                logger.exception(f"Error closing connection: {str(e)}")
            finally:
                self.ssh = None
        else:
            logger.debug("No active connection to close")

    def __enter__(self):
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        logger.debug("Context manager exiting, closing connection")
        self.close()


class ServerManager:
    """Manages server configurations with caching and detailed logging."""
    
    def __init__(self):
        self._lock = threading.Lock()
        self._cache = {}
        self._cache_expiry = 60  # seconds
        self._last_refresh = 0
        logger.debug("Initializing ServerManager")
        self._load_legacy_config()

    def _load_legacy_config(self):
        """Load legacy AIX configuration from settings."""
        logger.debug("Loading legacy configuration")
        self._legacy_config = None
        try:
            if all(hasattr(settings, attr) for attr in ['AIX_HOST', 'AIX_USER', 'AIX_PASSWORD']):
                logger.info("Found legacy AIX configuration in settings")
                self._legacy_config = ServerConfig(
                    host=settings.AIX_HOST,
                    user=settings.AIX_USER,
                    password=settings.AIX_PASSWORD,
                    private_key_path=getattr(settings, 'AIX_PRIVATE_KEY_PATH', None)
                )
        except Exception as e:
            logger.exception(f"Error loading legacy config: {str(e)}")

    def _refresh_cache(self):
        """Refresh server cache if expired."""
        current_time = time.time()
        if current_time - self._last_refresh < self._cache_expiry:
            logger.debug("Cache still valid, skipping refresh")
            return
            
        with self._lock:
            if current_time - self._last_refresh < self._cache_expiry:
                return
                
            logger.info("Refreshing server configuration cache")
            try:
                from metrics.models import Server
                servers = Server.objects.filter(status='active', monitoring_enabled=True)
                logger.debug(f"Found {servers.count()} active servers")
                
                new_cache = {}
                for server in servers:
                    config = ServerConfig(
                        host=server.ip_address,
                        user=server.ssh_username,
                        password=server.ssh_password,
                        private_key_path=server.ssh_key_path,
                        port=server.ssh_port,
                        server_id=str(server.id))
                    new_cache[str(server.id)] = config
                    new_cache[server.hostname] = config
                    logger.debug(f"Cached config for {server.hostname} ({server.id})")
                
                self._cache = new_cache
                self._last_refresh = current_time
                logger.info(f"Server cache refreshed with {len(new_cache)} entries")
                
            except Exception as e:
                logger.exception(f"Cache refresh failed: {str(e)}")

    def get_server_by_id(self, server_id: str) -> Optional[ServerConfig]:
        """Get server config by ID with cache support."""
        logger.debug(f"Requesting server config by ID: {server_id}")
        self._refresh_cache()
        config = self._cache.get(server_id)
        if not config:
            logger.warning(f"No configuration found for server ID: {server_id}")
        return config

    def get_server_by_hostname(self, hostname: str) -> Optional[ServerConfig]:
        """Get server config by hostname with cache support."""
        logger.debug(f"Requesting server config by hostname: {hostname}")
        self._refresh_cache()
        config = self._cache.get(hostname)
        if not config:
            logger.warning(f"No configuration found for hostname: {hostname}")
        return config

    def get_all_active_servers(self) -> List[ServerConfig]:
        """Get all active server configs."""
        logger.debug("Requesting all active server configs")
        self._refresh_cache()
        # Return unique configs
        unique_configs = {id(cfg): cfg for cfg in self._cache.values()}.values()
        logger.debug(f"Returning {len(unique_configs)} unique configurations")
        return list(unique_configs)

    def get_legacy_server(self) -> Optional[ServerConfig]:
        """Get legacy server config."""
        logger.debug("Requesting legacy server config")
        return self._legacy_config


class ConnectionPool:
    """Thread-safe connection pool with LRU eviction and detailed logging."""
    
    _instance = None
    _lock = threading.Lock()
    MAX_POOL_SIZE = 50
    CONNECTION_TIMEOUT = 300  # seconds
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                logger.debug("Creating new ConnectionPool instance")
                cls._instance = super().__new__(cls)
                cls._instance.pool = OrderedDict()
                cls._instance.manager = ServerManager()
        return cls._instance

    def _cleanup_idle_connections(self):
        """Remove connections that have been idle too long."""
        current_time = time.time()
        logger.debug("Checking for idle connections to cleanup")
        
        to_remove = []
        for key, (client, last_used) in self.pool.items():
            idle_time = current_time - last_used
            if idle_time > self.CONNECTION_TIMEOUT:
                logger.info(f"Evicting idle connection ({idle_time:.1f}s): {key}")
                to_remove.append(key)
                
        for key in to_remove:
            client, _ = self.pool.pop(key)
            try:
                client.close()
            except Exception as e:
                logger.warning(f"Error closing idle connection: {str(e)}")

    def get_client(self, key: str, config: ServerConfig) -> SSHClient:
        """Get or create client with LRU management."""
        logger.debug(f"Requesting client with key: {key}")
        self._cleanup_idle_connections()
        
        if key in self.pool:
            logger.debug(f"Found existing connection for {key}")
            client, _ = self.pool.pop(key)
            if client._is_connected():
                logger.debug("Connection is active, returning to pool")
                self.pool[key] = (client, time.time())
                return client
            else:
                logger.warning("Connection is inactive, closing")
                try:
                    client.close()
                except Exception:
                    pass
        
        # Create new client
        logger.info(f"Creating new SSHClient for {config.user}@{config.host}:{config.port}")
        client = SSHClient(config)
        
        # Apply LRU eviction if pool full
        if len(self.pool) >= self.MAX_POOL_SIZE:
            oldest_key = next(iter(self.pool))
            logger.warning(f"Pool full ({len(self.pool)}), evicting oldest: {oldest_key}")
            old_client, _ = self.pool.pop(oldest_key)
            try:
                old_client.close()
            except Exception as e:
                logger.warning(f"Error closing evicted connection: {str(e)}")
        
        logger.debug(f"Adding new connection to pool with key: {key}")
        self.pool[key] = (client, time.time())
        return client

    def get_client_by_id(self, server_id: str) -> Optional[SSHClient]:
        """Get client by server ID."""
        logger.debug(f"Requesting client by ID: {server_id}")
        config = self.manager.get_server_by_id(server_id)
        if not config:
            logger.error(f"No configuration found for server ID: {server_id}")
            return None
        return self.get_client(f"id:{server_id}", config)

    def get_client_by_hostname(self, hostname: str) -> Optional[SSHClient]:
        """Get client by hostname."""
        logger.debug(f"Requesting client by hostname: {hostname}")
        config = self.manager.get_server_by_hostname(hostname)
        if not config:
            logger.error(f"No configuration found for hostname: {hostname}")
            return None
        return self.get_client(f"host:{hostname}", config)

    def get_legacy_client(self) -> Optional[SSHClient]:
        """Get legacy client."""
        logger.debug("Requesting legacy client")
        config = self.manager.get_legacy_server()
        if not config:
            logger.warning("No legacy configuration available")
            return None
        return self.get_client("legacy", config)

    def get_all_active_clients(self) -> Dict[str, SSHClient]:
        """Get all active clients."""
        logger.debug("Requesting all active clients")
        clients = {}
        for config in self.manager.get_all_active_servers():
            if config.server_id:
                logger.debug(f"Getting client for server ID: {config.server_id}")
                client = self.get_client_by_id(config.server_id)
                if client:
                    clients[config.server_id] = client
        logger.info(f"Returning {len(clients)} active clients")
        return clients

    def close_all(self):
        """Close all connections in pool."""
        logger.info("Closing all connections in pool")
        for key, (client, _) in list(self.pool.items()):
            logger.debug(f"Closing connection: {key}")
            try:
                client.close()
            except Exception as e:
                logger.warning(f"Error closing connection {key}: {str(e)}")
            del self.pool[key]
        logger.info("All connections closed")

    def health_check(self) -> Dict[str, Any]:
        """Comprehensive health check of all servers with detailed logging."""
        logger.info("Performing SSH health check")
        health = {
            'timestamp': timezone.now().isoformat(),
            'total_servers': 0,
            'connected': 0,
            'disconnected': 0,
            'servers': {}
        }
        
        try:
            from metrics.models import Server
            servers = Server.objects.filter(monitoring_enabled=True)
            health['total_servers'] = servers.count()
            logger.debug(f"Found {health['total_servers']} servers to check")
            
            for server in servers:
                server_id = str(server.id)
                server_info = {
                    'hostname': server.hostname,
                    'status': server.status,
                    'last_seen': server.last_seen.isoformat() if server.last_seen else None
                }
                
                try:
                    logger.debug(f"Checking health for server: {server.hostname} ({server_id})")
                    client = self.get_client_by_id(server_id)
                    if client and client._is_connected():
                        logger.debug(f"Server {server.hostname} is connected")
                        health['connected'] += 1
                        server_info['connection_status'] = 'active'
                        server_info['last_activity'] = client.last_activity
                    else:
                        logger.warning(f"Server {server.hostname} is not connected")
                        health['disconnected'] += 1
                        server_info['connection_status'] = 'inactive'
                except Exception as e:
                    logger.exception(f"Health check failed for {server.hostname}: {str(e)}")
                    health['disconnected'] += 1
                    server_info['connection_status'] = 'error'
                    server_info['error'] = str(e)
                
                health['servers'][server_id] = server_info
                
            logger.info(f"Health check completed: {health['connected']} connected, "
                       f"{health['disconnected']} disconnected")
                
        except Exception as e:
            error_msg = f"Health check failed: {str(e)}"
            logger.exception(error_msg)
            health['error'] = error_msg
        
        return health


# Public interface functions
def get_ssh_client(server_identifier: str, by_hostname: bool = False) -> Optional[SSHClient]:
    """Public method to get SSH client with logging."""
    logger.debug(f"Getting SSH client for identifier: {server_identifier}, by_hostname={by_hostname}")
    pool = ConnectionPool()
    return (
        pool.get_client_by_hostname(server_identifier) 
        if by_hostname 
        else pool.get_client_by_id(server_identifier)
    )

def get_all_ssh_clients() -> Dict[str, SSHClient]:
    """Get all active SSH clients with logging."""
    logger.debug("Getting all active SSH clients")
    return ConnectionPool().get_all_active_clients()

def get_legacy_ssh_client() -> Optional[SSHClient]:
    """Get legacy SSH client with logging."""
    logger.debug("Getting legacy SSH client")
    return ConnectionPool().get_legacy_client()

def ssh_health_check() -> Dict[str, Any]:
    """Public health check method with logging."""
    logger.debug("Performing public SSH health check")
    return ConnectionPool().health_check()

def close_all_connections():
    """Close all connections in pool (for cleanup) with logging."""
    logger.info("Closing all SSH connections")
    ConnectionPool().close_all()