# metrics/utils/ssh_client.py
import paramiko
from django.conf import settings
import time
import logging

logger = logging.getLogger(__name__) # Add logging


class AIXClient:
    def __init__(self, max_retries=3, retry_delay=5): # Add retry parameters
        self.host = settings.AIX_HOST
        self.user = settings.AIX_USER
        self.password = settings.AIX_PASSWORD
        self.ssh = None
        self.last_activity = time.time()
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self._connect() # Initial connection attempt

    def _is_connected(self):
        """Check if the SSH connection is active."""
        try:
            if self.ssh and self.ssh.get_transport() and self.ssh.get_transport().is_active():
                # Optional: Send a keepalive packet or simple command to truly verify
                # self.ssh.send_keepalive() # Requires server support
                return True
        except EOFError:
            logger.warning("SSH connection check failed (EOFError), likely disconnected.")
        except Exception as e:
            logger.warning(f"SSH connection check failed unexpectedly: {str(e)}")
        return False

    def _connect(self):
        """Establish SSH connection with retries."""
        if self._is_connected():
            # logger.debug("SSH connection already active.") # Can be noisy
            return True

        attempts = 0
        while attempts < self.max_retries:
            attempts += 1
            logger.info(f"Attempting SSH connection to {self.host} (Attempt {attempts}/{self.max_retries})...")
            try:
                # Close existing inactive/broken connection if any
                if self.ssh:
                    try:
                        self.ssh.close()
                    except Exception:
                        pass # Ignore errors during close of potentially broken connection
                    self.ssh = None

                self.ssh = paramiko.SSHClient()
                self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                self.ssh.connect(
                    self.host,
                    username=self.user,
                    password=self.password,
                    timeout=15, # Increased timeout slightly
                    banner_timeout=200,
                    look_for_keys=False, # Explicitly disable searching for keys
                    allow_agent=False    # Explicitly disable SSH agent
                )
                # Verify connection immediately after connect() call
                if self._is_connected():
                    logger.info(f"SSH connection to {self.host} established successfully.")
                    self.last_activity = time.time()
                    return True
                else:
                    logger.warning(f"SSH connect() to {self.host} seemed to succeed but connection is not active.")
                    self.ssh = None # Ensure ssh is None if connection failed post-check

            except paramiko.AuthenticationException:
                logger.error(f"Authentication failed for {self.user}@{self.host}. Check credentials.")
                self.ssh = None
                return False # No point retrying auth errors
            except (paramiko.SSHException, TimeoutError, OSError) as e:
                logger.warning(f"SSH connection attempt {attempts} to {self.host} failed: {str(e)}")
                self.ssh = None
                if attempts < self.max_retries:
                    logger.info(f"Retrying connection in {self.retry_delay} seconds...")
                    time.sleep(self.retry_delay)
                else:
                    logger.error(f"Failed to establish SSH connection to {self.host} after {self.max_retries} attempts.")
                    return False
            except Exception as e: # Catch any other unexpected errors
                 logger.error(f"Unexpected error during SSH connection attempt {attempts} to {self.host}: {str(e)}")
                 self.ssh = None
                 if attempts < self.max_retries:
                    time.sleep(self.retry_delay)
                 else:
                    return False

        logger.error(f"SSH connection to {self.host} could not be established after {self.max_retries} attempts.")
        return False # Failed to connect after retries

    def execute(self, command, timeout=15):
        """Execute command with connection check and retries."""
        if not self._connect(): # Ensure connection is active before executing
             # Log the error and return None or raise specific exception
             logger.error(f"Cannot execute command '{command}': Failed to establish/maintain SSH connection to {self.host}.")
             # Depending on the caller's needs, either return None or raise an exception
             # Returning None might be handled by the caller, raising is more explicit
             raise RuntimeError(f"SSH connection unavailable for host {self.host}")

        try:
            logger.debug(f"Executing command on {self.host}: {command}")
            # stdin, stdout, stderr = self.ssh.exec_command(command, timeout=timeout)
            # Using invoke_shell might be more robust for some interactive-like commands or environments
            # For simple commands, exec_command is usually fine.
            channel = self.ssh.get_transport().open_session()
            channel.settimeout(timeout)
            channel.exec_command(command)
            
            # Read stdout and stderr
            # Reading stderr first might sometimes reveal errors faster
            stderr_output = channel.recv_stderr(4096).decode(errors='ignore').strip()
            stdout_output = channel.recv(4096).decode(errors='ignore').strip()
            exit_status = channel.recv_exit_status() # Wait for command to finish
            channel.close()
            
            self.last_activity = time.time() # Update activity time

            if exit_status != 0:
                 error_message = f"Command '{command}' exited with status {exit_status}. Stderr: '{stderr_output}'. Stdout: '{stdout_output[:100]}...'"
                 logger.warning(error_message)
                 # Raise error if exit status is non-zero, common practice
                 raise RuntimeError(error_message)

            # If stderr has content even with exit status 0, log it as warning
            if stderr_output:
                logger.warning(f"Command '{command}' had stderr output despite exit status 0: '{stderr_output}'")

            logger.debug(f"Command '{command}' executed successfully. Output length: {len(stdout_output)}")
            return stdout_output

        except (paramiko.SSHException, TimeoutError, OSError) as e:
            logger.error(f"Error executing command '{command}' on {self.host}: {str(e)}")
            self.close() # Close potentially broken connection
            raise RuntimeError(f"SSH execution error on {self.host}: {str(e)}") from e
        except Exception as e: # Catch other potential errors
            logger.error(f"Unexpected error executing command '{command}' on {self.host}: {str(e)}")
            self.close()
            raise RuntimeError(f"Unexpected execution error on {self.host}: {str(e)}") from e

    def close(self):
        """Close the SSH connection if open."""
        if self.ssh:
            logger.info(f"Closing SSH connection to {self.host}.")
            try:
                transport = self.ssh.get_transport()
                if transport and transport.is_active():
                    self.ssh.close()
            except Exception as e:
                logger.warning(f"Error during SSH connection close: {str(e)}")
            finally:
                self.ssh = None

# ConnectionPool is not used in collect_metrics.py, so no changes needed there for now.
# If it were used, similar robustness checks would be needed.
# class ConnectionPool:
#     _instance = None
#     def __new__(cls):
#         if not cls._instance:
#             cls._instance = super().__new__(cls)
#             cls._pool = {}
#         return cls._instance
#     
#     def get_client(self, host):
#         # Needs similar robustness checks as AIXClient._connect/_is_connected
#         if host not in self._pool or not self._pool[host]._is_connected(): 
#             client = AIXClient() # Assuming AIXClient handles its own connection
#             client.host = host
#             if client._connect(): # Try to connect
#                 self._pool[host] = client
#             else:
#                 # Handle connection failure - maybe return None or raise error
#                 logger.error(f"Failed to get or create connection for host {host} in pool.")
#                 return None # Or raise
#         return self._pool[host]

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